"""Isolated Unsloth worker process for LLM fine-tuning jobs.

Protocol contract:
- stdout: JSONL only, one event per line
- stderr: redirected to a persistent log file
- events: status | progress | complete | error

This module must run in a subprocess and should never be imported by the
main FastAPI process for heavyweight GPU runtime imports.
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import sys
import tempfile
import time
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_LOG_PATH = Path(tempfile.gettempdir()) / "mely-unsloth-worker.log"
SUPPORTED_EVENTS = {"status", "progress", "complete", "error"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class WorkerConfigError(Exception):
    """Config parse/validation failed before worker can start."""


class WorkerRuntimeError(Exception):
    """Known runtime failure with user-facing message."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool = False,
        status: str = "failed",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status


class WorkerCancelled(WorkerRuntimeError):
    """Cancellation triggered by sentinel."""

    def __init__(self, message: str = "训练已取消") -> None:
        super().__init__(
            code="canceled_by_user",
            message=message,
            retryable=True,
            status="canceled",
        )


def _normalize_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        return path.resolve()
    return path


def _to_int(raw: Any, *, field: str, minimum: int = 1) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise WorkerConfigError(f"配置字段 {field} 必须是整数") from exc
    if value < minimum:
        raise WorkerConfigError(f"配置字段 {field} 必须 >= {minimum}")
    return value


def _to_float(raw: Any, *, field: str, minimum: float | None = None) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise WorkerConfigError(f"配置字段 {field} 必须是数字") from exc
    if minimum is not None and value < minimum:
        raise WorkerConfigError(f"配置字段 {field} 必须 >= {minimum}")
    return value


def _pick(raw: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in raw:
            return raw[key]
    return default


@dataclass(slots=True)
class WorkerConfig:
    job_id: str
    mode: str
    base_model: str
    unsloth_model_name: str
    dataset_paths: list[Path]
    output_dir: Path
    adapter_output_dir: Path
    checkpoint_dir: Path
    gguf_output_dir: Path
    cancel_sentinel_path: Path
    log_path: Path
    max_steps: int
    checkpoint_every_steps: int
    max_seq_len: int
    lora_rank: int
    learning_rate: float
    per_device_train_batch_size: int
    gradient_accumulation_steps: int
    warmup_steps: int
    weight_decay: float
    seed: int
    export_quantization: str
    dry_run: bool
    dry_run_step_delay_seconds: float
    random_loss_seed: int

    @classmethod
    def from_payload(
        cls,
        payload: dict[str, Any],
        *,
        force_dry_run: bool = False,
    ) -> WorkerConfig:
        if not isinstance(payload, dict):
            raise WorkerConfigError("配置必须是 JSON 对象")

        job_id = str(_pick(payload, "jobId", "job_id", default="")).strip()
        if not job_id:
            raise WorkerConfigError("配置缺少 jobId")

        mode = str(_pick(payload, "mode", default="standard")).strip() or "standard"
        base_model = str(_pick(payload, "baseModel", "base_model", default="")).strip()
        unsloth_model_name = str(
            _pick(payload, "unslothModelName", "unsloth_model_name", default=base_model)
        ).strip()
        if not unsloth_model_name:
            raise WorkerConfigError("配置缺少 unslothModelName/baseModel")

        raw_dataset_paths = _pick(payload, "datasetPaths", "dataset_paths", default=[])
        if not isinstance(raw_dataset_paths, list):
            raise WorkerConfigError("配置字段 datasetPaths 必须是数组")
        dataset_paths = [_normalize_path(str(item)) for item in raw_dataset_paths if str(item).strip()]
        if not dataset_paths:
            raise WorkerConfigError("配置字段 datasetPaths 不能为空")

        output_dir = _normalize_path(str(_pick(payload, "outputDir", "output_dir", default="./outputs")))
        adapter_output_dir = _normalize_path(
            str(
                _pick(
                    payload,
                    "adapterOutputDir",
                    "adapter_output_dir",
                    default=output_dir / "adapter",
                )
            )
        )
        checkpoint_dir = _normalize_path(
            str(_pick(payload, "checkpointDir", "checkpoint_dir", default=output_dir / "checkpoints"))
        )
        gguf_output_dir = _normalize_path(
            str(_pick(payload, "ggufOutputDir", "gguf_output_dir", default=output_dir / "gguf"))
        )
        cancel_sentinel_path = _normalize_path(
            str(_pick(payload, "cancelSentinelPath", "cancel_sentinel_path", default=output_dir / "cancel.sentinel"))
        )
        log_path = _normalize_path(
            str(_pick(payload, "logPath", "log_path", default=output_dir / "worker.stderr.log"))
        )

        dry_run = bool(_pick(payload, "dryRun", "dry_run", default=False)) or force_dry_run

        return cls(
            job_id=job_id,
            mode=mode,
            base_model=base_model,
            unsloth_model_name=unsloth_model_name,
            dataset_paths=dataset_paths,
            output_dir=output_dir,
            adapter_output_dir=adapter_output_dir,
            checkpoint_dir=checkpoint_dir,
            gguf_output_dir=gguf_output_dir,
            cancel_sentinel_path=cancel_sentinel_path,
            log_path=log_path,
            max_steps=_to_int(_pick(payload, "maxSteps", "max_steps", default=400), field="maxSteps"),
            checkpoint_every_steps=_to_int(
                _pick(payload, "checkpointEverySteps", "checkpoint_every_steps", default=100),
                field="checkpointEverySteps",
            ),
            max_seq_len=_to_int(_pick(payload, "maxSeqLen", "max_seq_len", default=4096), field="maxSeqLen"),
            lora_rank=_to_int(_pick(payload, "loraRank", "lora_rank", default=16), field="loraRank"),
            learning_rate=_to_float(
                _pick(payload, "learningRate", "learning_rate", default=2e-4),
                field="learningRate",
                minimum=1e-8,
            ),
            per_device_train_batch_size=_to_int(
                _pick(payload, "perDeviceTrainBatchSize", "per_device_train_batch_size", default=1),
                field="perDeviceTrainBatchSize",
            ),
            gradient_accumulation_steps=_to_int(
                _pick(payload, "gradientAccumulationSteps", "gradient_accumulation_steps", default=4),
                field="gradientAccumulationSteps",
            ),
            warmup_steps=_to_int(_pick(payload, "warmupSteps", "warmup_steps", default=10), field="warmupSteps", minimum=0),
            weight_decay=_to_float(
                _pick(payload, "weightDecay", "weight_decay", default=0.01),
                field="weightDecay",
                minimum=0.0,
            ),
            seed=_to_int(_pick(payload, "seed", default=42), field="seed", minimum=0),
            export_quantization=str(
                _pick(payload, "exportQuantization", "export_quantization", default="q4_k_m")
            ).strip().lower(),
            dry_run=dry_run,
            dry_run_step_delay_seconds=_to_float(
                _pick(
                    payload,
                    "dryRunStepDelaySeconds",
                    "dry_run_step_delay_seconds",
                    default=0.01,
                ),
                field="dryRunStepDelaySeconds",
                minimum=0.0,
            ),
            random_loss_seed=_to_int(
                _pick(payload, "randomLossSeed", "random_loss_seed", default=42),
                field="randomLossSeed",
                minimum=0,
            ),
        )

    def prepare_dirs(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.adapter_output_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        self.gguf_output_dir.mkdir(parents=True, exist_ok=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.cancel_sentinel_path.parent.mkdir(parents=True, exist_ok=True)


class ProtocolEmitter:
    """Write strict JSONL protocol events to stdout."""

    def __init__(self, *, job_id: str) -> None:
        self._job_id = job_id
        self._out = sys.__stdout__

    def emit(self, event: str, **payload: Any) -> None:
        if event not in SUPPORTED_EVENTS:
            raise ValueError(f"unsupported protocol event: {event}")
        record = {
            "event": event,
            "jobId": self._job_id,
            "timestamp": _utc_now(),
            **payload,
        }
        self._out.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._out.flush()

    def status(self, *, status: str, message: str | None = None, **extra: Any) -> None:
        payload: dict[str, Any] = {"status": status}
        if message:
            payload["message"] = message
        payload.update(extra)
        self.emit("status", **payload)

    def progress(
        self,
        *,
        status: str,
        step: int,
        total_steps: int,
        loss: float | None = None,
        eta_seconds: int | None = None,
        checkpoint_path: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "status": status,
            "step": int(step),
            "totalSteps": int(total_steps),
            "progress": 0.0 if total_steps <= 0 else max(0.0, min(1.0, step / total_steps)),
        }
        if loss is not None:
            payload["loss"] = round(float(loss), 6)
        if eta_seconds is not None:
            payload["etaSeconds"] = int(max(0, eta_seconds))
        if checkpoint_path:
            payload["checkpointPath"] = checkpoint_path
        self.emit("progress", **payload)

    def complete(
        self,
        *,
        adapter_path: str,
        gguf_path: str,
        final_loss: float | None = None,
        log_path: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "status": "completed",
            "adapterPath": adapter_path,
            "ggufPath": gguf_path,
        }
        if final_loss is not None:
            payload["finalLoss"] = round(float(final_loss), 6)
        if log_path:
            payload["logPath"] = log_path
        self.emit("complete", **payload)

    def error(
        self,
        *,
        status: str,
        code: str,
        message: str,
        retryable: bool,
        log_path: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "status": status,
            "code": code,
            "message": message,
            "retryable": retryable,
        }
        if log_path:
            payload["logPath"] = log_path
        self.emit("error", **payload)


def _check_cancel(config: WorkerConfig) -> None:
    if config.cancel_sentinel_path.exists():
        raise WorkerCancelled("检测到取消标记，训练已停止")


def _load_payload(config_path: str | None) -> dict[str, Any]:
    if config_path:
        raw = Path(config_path).read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    if not raw.strip():
        raise WorkerConfigError("未读取到配置 JSON")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerConfigError(f"配置 JSON 解析失败: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise WorkerConfigError("配置必须是 JSON 对象")
    return payload


def _write_checkpoint_stub(config: WorkerConfig, step: int, loss: float) -> str:
    checkpoint_path = config.checkpoint_dir / f"checkpoint-{step}"
    checkpoint_path.mkdir(parents=True, exist_ok=True)
    state = {
        "step": step,
        "totalSteps": config.max_steps,
        "loss": loss,
        "timestamp": _utc_now(),
    }
    (checkpoint_path / "trainer_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return str(checkpoint_path)


def _find_first_file(base_dir: Path, pattern: str) -> Path | None:
    for path in sorted(base_dir.glob(pattern)):
        if path.is_file():
            return path
    return None


def _merge_sharegpt_dataset(config: WorkerConfig) -> Path:
    merged_path = config.output_dir / "merged_sharegpt.jsonl"
    with merged_path.open("w", encoding="utf-8") as output_file:
        for dataset_path in config.dataset_paths:
            if not dataset_path.exists():
                raise WorkerRuntimeError(
                    code="dataset_not_found",
                    message=f"训练数据集不存在: {dataset_path}",
                    retryable=False,
                )
            with dataset_path.open("r", encoding="utf-8") as input_file:
                for line_number, raw_line in enumerate(input_file, start=1):
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise WorkerRuntimeError(
                            code="dataset_invalid_json",
                            message=f"训练数据格式错误: {dataset_path.name} 第 {line_number} 行",
                            retryable=False,
                        ) from exc
                    conversations = record.get("conversations")
                    if not isinstance(conversations, list) or not conversations:
                        raise WorkerRuntimeError(
                            code="dataset_invalid_format",
                            message=f"训练数据格式错误: {dataset_path.name} 第 {line_number} 行缺少 conversations",
                            retryable=False,
                        )
                    output_file.write(json.dumps(record, ensure_ascii=False) + "\n")
    return merged_path


def _run_dry(config: WorkerConfig, emitter: ProtocolEmitter) -> None:
    random.seed(config.random_loss_seed)
    emitter.status(status="preparing", message="Dry-run: 校验配置与数据集")
    _check_cancel(config)

    for dataset_path in config.dataset_paths:
        if not dataset_path.exists():
            raise WorkerRuntimeError(
                code="dataset_not_found",
                message=f"训练数据集不存在: {dataset_path}",
                retryable=False,
            )

    emitter.status(
        status="training",
        message="Dry-run: 模拟训练中",
        totalSteps=config.max_steps,
    )

    start = time.monotonic()
    final_loss = 0.0
    for step in range(1, config.max_steps + 1):
        _check_cancel(config)
        base_loss = max(0.02, 1.8 - (step / max(config.max_steps, 1)) * 1.3)
        jitter = random.uniform(-0.03, 0.03)
        loss = max(0.01, base_loss + jitter)
        final_loss = loss
        elapsed = time.monotonic() - start
        eta = int((elapsed / step) * (config.max_steps - step)) if step > 0 else None
        checkpoint_path: str | None = None
        if step % config.checkpoint_every_steps == 0 or step == config.max_steps:
            checkpoint_path = _write_checkpoint_stub(config, step, loss)
        emitter.progress(
            status="training",
            step=step,
            total_steps=config.max_steps,
            loss=loss,
            eta_seconds=eta,
            checkpoint_path=checkpoint_path,
        )
        if config.dry_run_step_delay_seconds > 0:
            time.sleep(config.dry_run_step_delay_seconds)

    emitter.status(status="exporting", message="Dry-run: 模拟导出 GGUF")
    _check_cancel(config)

    adapter_path = config.adapter_output_dir / "adapter_model.safetensors"
    adapter_path.write_text("dry-run adapter", encoding="utf-8")
    gguf_path = config.gguf_output_dir / "model-q4_k_m.gguf"
    gguf_path.write_text("dry-run gguf", encoding="utf-8")

    emitter.complete(
        adapter_path=str(adapter_path),
        gguf_path=str(gguf_path),
        final_loss=final_loss,
        log_path=str(config.log_path),
    )


def _run_unsloth_training(config: WorkerConfig, emitter: ProtocolEmitter) -> None:
    try:
        import torch
        from datasets import load_dataset
        from transformers import TrainerCallback, TrainingArguments
        from trl import SFTTrainer
        from unsloth import FastLanguageModel
        from unsloth.chat_templates import get_chat_template
    except ImportError as exc:
        missing = getattr(exc, "name", None) or str(exc)
        raise WorkerRuntimeError(
            code="missing_dependency",
            message=f"训练环境缺少依赖：{missing}",
            retryable=False,
        ) from exc

    _check_cancel(config)
    emitter.status(status="preparing", message="正在准备训练环境")

    dataset_path = _merge_sharegpt_dataset(config)
    _check_cancel(config)

    emitter.status(status="training", message="正在加载基础模型")
    try:
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=config.unsloth_model_name,
            max_seq_length=config.max_seq_len,
            dtype=None,
            load_in_4bit=True,
        )
    except RuntimeError as exc:
        error_text = str(exc).lower()
        if "out of memory" in error_text or "cuda" in error_text and "memory" in error_text:
            raise WorkerRuntimeError(
                code="out_of_memory",
                message="显存不足，请尝试轻量模式或关闭其他程序",
                retryable=True,
            ) from exc
        raise

    model = FastLanguageModel.get_peft_model(
        model,
        r=config.lora_rank,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=config.lora_rank,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=config.seed,
        use_rslora=False,
    )

    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")
    raw_dataset = load_dataset("json", data_files=str(dataset_path), split="train")

    def to_chatml(batch: dict[str, list[Any]]) -> dict[str, list[str]]:
        texts: list[str] = []
        for conversations in batch["conversations"]:
            messages: list[dict[str, str]] = []
            for turn in conversations:
                role = str(turn.get("from", "")).strip().lower()
                content = str(turn.get("value", ""))
                if role == "human":
                    mapped_role = "user"
                elif role == "gpt":
                    mapped_role = "assistant"
                elif role in {"user", "assistant", "system"}:
                    mapped_role = role
                else:
                    mapped_role = "user"
                messages.append({"role": mapped_role, "content": content})
            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
            )
            texts.append(text)
        return {"text": texts}

    dataset = raw_dataset.map(to_chatml, batched=True)

    class WorkerProgressCallback(TrainerCallback):
        def __init__(self) -> None:
            self._last_loss: float | None = None
            self._start_time = time.monotonic()

        def on_log(self, args, state, control, logs=None, **kwargs):  # type: ignore[override]
            if logs and "loss" in logs:
                self._last_loss = float(logs["loss"])

        def on_step_end(self, args, state, control, **kwargs):  # type: ignore[override]
            _check_cancel(config)
            step = int(state.global_step)
            if step <= 0:
                return control
            elapsed = max(1e-6, time.monotonic() - self._start_time)
            eta_seconds = int((elapsed / step) * max(config.max_steps - step, 0))
            checkpoint_path: str | None = None
            if step % config.checkpoint_every_steps == 0:
                checkpoint_path = str(config.checkpoint_dir / f"checkpoint-{step}")
            emitter.progress(
                status="training",
                step=step,
                total_steps=config.max_steps,
                loss=self._last_loss,
                eta_seconds=eta_seconds,
                checkpoint_path=checkpoint_path,
            )
            return control

    training_args = TrainingArguments(
        output_dir=str(config.checkpoint_dir),
        num_train_epochs=1,
        max_steps=config.max_steps,
        per_device_train_batch_size=config.per_device_train_batch_size,
        gradient_accumulation_steps=config.gradient_accumulation_steps,
        warmup_steps=config.warmup_steps,
        learning_rate=config.learning_rate,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=1,
        save_strategy="steps",
        save_steps=config.checkpoint_every_steps,
        save_total_limit=3,
        optim="adamw_8bit",
        weight_decay=config.weight_decay,
        lr_scheduler_type="linear",
        seed=config.seed,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=config.max_seq_len,
        dataset_num_proc=1,
        args=training_args,
        callbacks=[WorkerProgressCallback()],
    )

    try:
        trainer.train()
    except WorkerCancelled:
        raise
    except RuntimeError as exc:
        error_text = str(exc).lower()
        if "out of memory" in error_text or "cuda" in error_text and "memory" in error_text:
            raise WorkerRuntimeError(
                code="out_of_memory",
                message="显存不足，请尝试轻量模式或关闭其他程序",
                retryable=True,
            ) from exc
        raise

    _check_cancel(config)
    model.save_pretrained(str(config.adapter_output_dir))
    tokenizer.save_pretrained(str(config.adapter_output_dir))
    adapter_file = _find_first_file(config.adapter_output_dir, "*.safetensors")
    adapter_path = adapter_file if adapter_file is not None else config.adapter_output_dir

    emitter.status(status="exporting", message="正在导出 GGUF")
    _check_cancel(config)
    try:
        model.save_pretrained_gguf(
            str(config.gguf_output_dir),
            tokenizer,
            quantization_method=config.export_quantization,
        )
    except RuntimeError as exc:
        error_text = str(exc).lower()
        if "out of memory" in error_text or "memory" in error_text:
            raise WorkerRuntimeError(
                code="gguf_export_oom",
                message="GGUF 导出失败：内存不足，请关闭其他程序后重试",
                retryable=True,
            ) from exc
        raise WorkerRuntimeError(
            code="gguf_export_failed",
            message="GGUF 导出失败，请查看日志后重试",
            retryable=True,
        ) from exc

    gguf_file = _find_first_file(config.gguf_output_dir, "*.gguf")
    if gguf_file is None:
        raise WorkerRuntimeError(
            code="gguf_export_failed",
            message="GGUF 导出失败：未找到导出文件",
            retryable=True,
        )

    final_loss: float | None = None
    for log_item in reversed(getattr(trainer.state, "log_history", [])):
        if isinstance(log_item, dict) and "loss" in log_item:
            try:
                final_loss = float(log_item["loss"])
                break
            except (TypeError, ValueError):
                continue

    emitter.complete(
        adapter_path=str(adapter_path),
        gguf_path=str(gguf_file),
        final_loss=final_loss,
        log_path=str(config.log_path),
    )


def _run(config: WorkerConfig, emitter: ProtocolEmitter) -> None:
    config.prepare_dirs()
    if config.cancel_sentinel_path.exists():
        try:
            config.cancel_sentinel_path.unlink()
        except OSError:
            pass

    if config.dry_run:
        _run_dry(config, emitter)
        return

    _run_unsloth_training(config, emitter)


def _configure_logging(log_file) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(log_file)],
        force=True,
    )
    logging.getLogger("transformers").setLevel(logging.WARNING)
    logging.getLogger("datasets").setLevel(logging.WARNING)
    logging.getLogger("trl").setLevel(logging.WARNING)


def _protocol_error_exit(
    *,
    job_id: str,
    code: str,
    message: str,
    status: str,
    retryable: bool,
    log_path: str | None = None,
) -> int:
    emitter = ProtocolEmitter(job_id=job_id)
    emitter.error(
        status=status,
        code=code,
        message=message,
        retryable=retryable,
        log_path=log_path,
    )
    return 1 if status != "canceled" else 130


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mely LLM Unsloth worker")
    parser.add_argument(
        "config",
        nargs="?",
        help="Path to JSON config file. If omitted, read JSON payload from stdin.",
    )
    parser.add_argument(
        "--config",
        dest="config_flag",
        help="Path to JSON config file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Force dry-run mode regardless of config.dryRun",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    config_source = args.config_flag or args.config

    try:
        payload = _load_payload(config_source)
    except WorkerConfigError as exc:
        return _protocol_error_exit(
            job_id="unknown",
            code="invalid_config",
            message=str(exc),
            status="failed",
            retryable=False,
            log_path=str(DEFAULT_LOG_PATH),
        )

    fallback_job_id = str(payload.get("jobId") or payload.get("job_id") or "unknown")
    fallback_log_path = str(
        _normalize_path(
            str(
                payload.get("logPath")
                or payload.get("log_path")
                or DEFAULT_LOG_PATH
            )
        )
    )

    try:
        config = WorkerConfig.from_payload(payload, force_dry_run=bool(args.dry_run))
    except WorkerConfigError as exc:
        return _protocol_error_exit(
            job_id=fallback_job_id,
            code="invalid_config",
            message=str(exc),
            status="failed",
            retryable=False,
            log_path=fallback_log_path,
        )

    emitter = ProtocolEmitter(job_id=config.job_id)
    config.prepare_dirs()

    with config.log_path.open("a", encoding="utf-8") as log_file:
        _configure_logging(log_file)
        with redirect_stdout(log_file), redirect_stderr(log_file):
            logging.info("worker_start job_id=%s dry_run=%s", config.job_id, config.dry_run)
            try:
                _run(config, emitter)
                logging.info("worker_complete job_id=%s", config.job_id)
                return 0
            except WorkerRuntimeError as exc:
                logging.exception(
                    "worker_runtime_error job_id=%s code=%s",
                    config.job_id,
                    exc.code,
                )
                emitter.error(
                    status=exc.status,
                    code=exc.code,
                    message=exc.message,
                    retryable=exc.retryable,
                    log_path=str(config.log_path),
                )
                return 130 if exc.status == "canceled" else 1
            except Exception:
                logging.exception("worker_crash job_id=%s", config.job_id)
                emitter.error(
                    status="failed",
                    code="worker_crash",
                    message="训练进程异常退出，请查看日志后重试",
                    retryable=True,
                    log_path=str(config.log_path),
                )
                return 1


if __name__ == "__main__":
    raise SystemExit(main())
