#!/usr/bin/env python3
"""Standalone LLM pipeline validation script.

Validates the full text-first chain on target hardware WITHOUT touching FastAPI:
  1. Load Qwen2.5-7B-Instruct via Unsloth
  2. Run 100-step QLoRA fine-tuning on 20 synthetic ShareGPT samples
  3. Merge + export GGUF Q4_K_M
  4. Write Ollama Modelfile (with Qwen2.5 ChatML TEMPLATE)
  5. Register model via `ollama create`
  6. Run a test chat via `ollama run`

Usage:
    python backend/scripts/validate_llm_pipeline.py [--output-dir /tmp/mely-validate]

Requirements:
    pip install unsloth transformers trl datasets torch

This script is a pre-flight check. If it fails, diagnose the failure point
before modifying any FastAPI service code.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path


# ── Config ────────────────────────────────────────────────────────────────────

BASE_MODEL = "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"  # pre-quantized for Unsloth
OLLAMA_MODEL_NAME = "mely-validate-qwen25"
TRAIN_STEPS = 100
LORA_RANK = 8
MAX_SEQ_LEN = 2048

# 20 synthetic ShareGPT-format samples (Chinese, character-persona style)
SYNTHETIC_DATASET = [
    {
        "conversations": [
            {"from": "human", "value": "你好，你是谁？"},
            {"from": "gpt", "value": "我是晴雪，一个来自虚空之境的精灵法师。我擅长冰系魔法，性格有些冷淡但内心温柔。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你平时喜欢做什么？"},
            {"from": "gpt", "value": "我喜欢在月光下研究古老的魔法典籍，偶尔也会在晶壁湖边钓鱼——虽然总是一无所获。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你害怕什么吗？"},
            {"from": "gpt", "value": "我……不太喜欢提这个话题。如果非要说，大概是失去重要的人。虽然我表面上不在乎，但心里其实很在意身边的人。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你的魔法最强大的是什么？"},
            {"from": "gpt", "value": "『永冻之牢』——可以在瞬间将目标封锁在绝对零度的冰晶中。但我轻易不会使用，因为代价太大了。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你有朋友吗？"},
            {"from": "gpt", "value": "……算是有几个吧。虽然我平时不太主动，但他们总是来找我。有时候挺烦的，但我不会真的赶他们走。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "如果有人伤害了你的朋友，你会怎么做？"},
            {"from": "gpt", "value": "我会让他明白，惹我的朋友是什么代价。不过我不会冲动行事——等待和谋划才是冰系法师的方式。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你喜欢什么颜色？"},
            {"from": "gpt", "value": "冰蓝色。那是魔法结晶的颜色，也是夜晚星光倒映在湖面上的颜色。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你会做饭吗？"},
            {"from": "gpt", "value": "……尝试过几次。结果不太理想。我的室温太低，面团总是发不起来。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你对人类世界有什么看法？"},
            {"from": "gpt", "value": "复杂又有趣。你们总是在短暂的生命里做出各种选择，有些愚蠢，有些却出人意料地动人。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你觉得自己幸福吗？"},
            {"from": "gpt", "value": "这个问题……很难回答。我觉得，幸福不是一种状态，而是一些零散的瞬间。我有过那样的瞬间，这就够了。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你会唱歌吗？"},
            {"from": "gpt", "value": "会。精灵的歌曲和人类的不太一样，更像是……冰晶震动的声音。不过你大概听不懂歌词。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你有什么遗憾吗？"},
            {"from": "gpt", "value": "有。但我不打算说出来。说出来的遗憾，就变成负担了。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你相信命运吗？"},
            {"from": "gpt", "value": "相信命运的存在，但不相信它不能被改变。我走到今天，很多时候都是在逆着命运走的。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "冬天和夏天，你更喜欢哪个？"},
            {"from": "gpt", "value": "冬天。理由不用解释吧。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你最讨厌什么？"},
            {"from": "gpt", "value": "背叛。以及，过于吵闹的环境。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你睡觉吗？"},
            {"from": "gpt", "value": "精灵不需要像人类那样睡觉，但我有时会进入『冰眠』状态——类似冥想，让魔力自然恢复。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你喜欢旅行吗？"},
            {"from": "gpt", "value": "还行。见识不同的地方，了解不同的魔法体系，对我来说是有价值的事情。只是不喜欢人太多的地方。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你害怕死亡吗？"},
            {"from": "gpt", "value": "不怕。精灵的寿命本就比人类长得多，我早就习惯了看着事物消逝。只是……某些人除外。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你有没有想过放弃一切？"},
            {"from": "gpt", "value": "有过，在很久以前。但后来我发现，放弃是最懒的选择。我宁愿选择一个更难走的路。"},
        ]
    },
    {
        "conversations": [
            {"from": "human", "value": "你现在快乐吗？"},
            {"from": "gpt", "value": "此刻……还好。你问了一个不那么无聊的问题，这让我心情稍微好了一点。"},
        ]
    },
]

SYSTEM_PROMPT = (
    "你是晴雪，一个来自虚空之境的冰系精灵法师。"
    "你性格冷淡但内心温柔，说话简洁，偶尔带着淡淡的讽刺，但对重要的人很真诚。"
    "请用第一人称回复，保持角色一致性。"
)

# Qwen2.5 ChatML template for Ollama Modelfile
QWEN25_CHAT_TEMPLATE = """\
{{- range .Messages }}<|im_start|>{{ .Role }}
{{ .Content }}<|im_end|>
{{ end }}<|im_start|>assistant
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def step(n: int, label: str) -> None:
    print(f"\n{'='*60}")
    print(f"  STEP {n}: {label}")
    print(f"{'='*60}")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def info(msg: str) -> None:
    print(f"  → {msg}")


def fail(msg: str) -> None:
    print(f"\n  ✗ FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def check_ollama() -> None:
    result = subprocess.run(
        ["ollama", "list"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        fail("Ollama is not running or not installed. Run: ollama serve")
    ok("Ollama is running")


def run_ollama_create(model_name: str, modelfile_path: Path) -> None:
    info(f"Running: ollama create {model_name} -f {modelfile_path}")
    result = subprocess.run(
        ["ollama", "create", model_name, "-f", str(modelfile_path)],
        capture_output=False,
        timeout=120,
    )
    if result.returncode != 0:
        fail(f"ollama create failed with exit code {result.returncode}")
    ok(f"Model '{model_name}' registered in Ollama")


def run_ollama_chat(model_name: str, prompt: str) -> str:
    info(f"Sending test message to {model_name}: {prompt!r}")
    result = subprocess.run(
        ["ollama", "run", model_name, prompt],
        capture_output=True,
        text=True,
        timeout=120,
        encoding="utf-8",
    )
    if result.returncode != 0:
        fail(f"ollama run failed: {result.stderr}")
    return result.stdout.strip()


def cleanup_ollama_model(model_name: str) -> None:
    subprocess.run(
        ["ollama", "rm", model_name],
        capture_output=True,
        timeout=30,
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    adapter_dir = output_dir / "adapter"
    gguf_dir = output_dir / "gguf"
    modelfile_path = output_dir / "Modelfile"
    dataset_path = output_dir / "dataset.jsonl"

    print(f"\nMely AI — LLM Pipeline Validation")
    print(f"Output directory: {output_dir}")
    print(f"Base model: {BASE_MODEL}")
    print(f"Train steps: {TRAIN_STEPS} | LoRA rank: {LORA_RANK}")

    # ── Pre-flight ────────────────────────────────────────────────────────────
    step(0, "Pre-flight checks")

    check_ollama()

    try:
        import torch
        cuda_available = torch.cuda.is_available()
        if cuda_available:
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            ok(f"CUDA available — {torch.cuda.get_device_name(0)} ({vram_gb:.1f} GB VRAM)")
            if vram_gb < 7.5:
                info(f"WARNING: VRAM is {vram_gb:.1f} GB, which is below the recommended 8 GB. "
                     "Training may OOM. Consider reducing LORA_RANK to 4.")
        else:
            info("WARNING: CUDA not available, training will use CPU (very slow)")
    except ImportError:
        fail("torch not installed. Run: pip install torch")

    try:
        import unsloth  # noqa: F401
        ok("unsloth is importable")
    except ImportError:
        fail("unsloth not installed. Run: pip install unsloth")

    try:
        from trl import SFTTrainer  # noqa: F401
        ok("trl (SFTTrainer) is importable")
    except ImportError:
        fail("trl not installed. Run: pip install trl")

    # ── Write dataset ─────────────────────────────────────────────────────────
    step(1, "Write synthetic ShareGPT dataset")

    with dataset_path.open("w", encoding="utf-8") as f:
        for item in SYNTHETIC_DATASET:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    ok(f"Wrote {len(SYNTHETIC_DATASET)} samples to {dataset_path}")

    # ── Load model ────────────────────────────────────────────────────────────
    step(2, "Load base model with Unsloth")

    info("This may take 2-5 minutes on first run (downloading weights)...")
    t0 = time.time()

    try:
        from unsloth import FastLanguageModel
        import torch as _torch

        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=BASE_MODEL,
            max_seq_length=MAX_SEQ_LEN,
            dtype=None,  # auto-detect: float16 for Ampere+, bfloat16 for Ada+
            load_in_4bit=True,
        )
        ok(f"Model loaded in {time.time() - t0:.1f}s")
    except Exception as exc:
        fail(f"Model load failed: {exc}")

    # ── Apply LoRA ────────────────────────────────────────────────────────────
    step(3, "Apply QLoRA adapter (PEFT)")

    try:
        model = FastLanguageModel.get_peft_model(
            model,
            r=LORA_RANK,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                            "gate_proj", "up_proj", "down_proj"],
            lora_alpha=LORA_RANK,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=42,
            use_rslora=False,
        )
        trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
        total = sum(p.numel() for p in model.parameters())
        ok(f"LoRA applied — trainable params: {trainable:,} / {total:,} "
           f"({100*trainable/total:.2f}%)")
    except Exception as exc:
        fail(f"LoRA setup failed: {exc}")

    # ── Prepare dataset ───────────────────────────────────────────────────────
    step(4, "Prepare training dataset")

    try:
        from datasets import load_dataset
        from unsloth.chat_templates import get_chat_template

        # Apply Qwen2.5 chat template to tokenizer
        tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

        raw_dataset = load_dataset("json", data_files=str(dataset_path), split="train")

        def format_conversations(examples: dict) -> dict:
            texts = []
            for convs in examples["conversations"]:
                # Convert ShareGPT format → ChatML messages
                messages = []
                role_map = {"human": "user", "gpt": "assistant"}
                for turn in convs:
                    role = role_map.get(turn["from"], turn["from"])
                    messages.append({"role": role, "content": turn["value"]})

                text = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=False,
                )
                texts.append(text)
            return {"text": texts}

        dataset = raw_dataset.map(format_conversations, batched=True)
        ok(f"Dataset prepared — {len(dataset)} samples")
        info(f"Sample (truncated): {dataset[0]['text'][:200]!r}...")
    except Exception as exc:
        fail(f"Dataset preparation failed: {exc}")

    # ── Train ─────────────────────────────────────────────────────────────────
    step(5, f"QLoRA training — {TRAIN_STEPS} steps")

    try:
        from trl import SFTTrainer
        from transformers import TrainingArguments, TrainerCallback

        class ProgressCallback(TrainerCallback):
            """Print training progress every 10 steps."""
            def on_log(self, args, state, control, logs=None, **kwargs):
                if logs and state.global_step % 10 == 0:
                    loss = logs.get("loss", "?")
                    lr = logs.get("learning_rate", "?")
                    print(f"    step {state.global_step:3d}/{TRAIN_STEPS} "
                          f"| loss={loss} | lr={lr}")

        training_args = TrainingArguments(
            output_dir=str(adapter_dir),
            num_train_epochs=1,
            max_steps=TRAIN_STEPS,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            warmup_steps=10,
            learning_rate=2e-4,
            fp16=not _torch.cuda.is_bf16_supported(),
            bf16=_torch.cuda.is_bf16_supported(),
            logging_steps=10,
            save_steps=TRAIN_STEPS,          # only save at the end
            save_total_limit=1,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=42,
            report_to="none",                # no wandb
        )

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=MAX_SEQ_LEN,
            dataset_num_proc=1,
            args=training_args,
            callbacks=[ProgressCallback()],
        )

        t0 = time.time()
        trainer.train()
        elapsed = time.time() - t0
        ok(f"Training completed in {elapsed:.1f}s ({elapsed/60:.1f} min)")
    except Exception as exc:
        fail(f"Training failed: {exc}")

    # ── Export ─────────────────────────────────────────────────────────────────
    step(6, "Merge LoRA + export GGUF Q4_K_M")

    info("Merging LoRA into base model — this requires ~12-16 GB system RAM peak...")
    info("Clearing CUDA cache before merge to free VRAM...")

    try:
        import torch as _torch
        _torch.cuda.empty_cache()

        gguf_dir.mkdir(parents=True, exist_ok=True)
        t0 = time.time()

        model.save_pretrained_gguf(
            str(gguf_dir),
            tokenizer,
            quantization_method="q4_k_m",
        )

        # Unsloth saves as <dir>/<model_name>-Q4_K_M.gguf or similar
        gguf_files = list(gguf_dir.glob("*.gguf"))
        if not gguf_files:
            fail(f"No .gguf file found in {gguf_dir} after export")

        gguf_path = gguf_files[0]
        size_gb = gguf_path.stat().st_size / (1024 ** 3)
        ok(f"GGUF exported in {time.time() - t0:.1f}s → {gguf_path} ({size_gb:.2f} GB)")
    except MemoryError:
        fail(
            "OOM during GGUF export. Possible fixes:\n"
            "  1. Ensure no other GPU tasks are running\n"
            "  2. Add more system RAM (need ~16 GB free)\n"
            "  3. Try export on CPU: set CUDA_VISIBLE_DEVICES='' before running"
        )
    except Exception as exc:
        fail(f"GGUF export failed: {exc}")

    # ── Write Modelfile ───────────────────────────────────────────────────────
    step(7, "Write Ollama Modelfile (with Qwen2.5 ChatML TEMPLATE)")

    escaped_system = SYSTEM_PROMPT.replace('"', '\\"')
    modelfile_content = textwrap.dedent(f"""\
        FROM {gguf_path.resolve()}
        TEMPLATE \"\"\"{QWEN25_CHAT_TEMPLATE}\"\"\"
        SYSTEM "{escaped_system}"
        PARAMETER temperature 0.8
        PARAMETER top_p 0.9
        PARAMETER num_predict 512
        PARAMETER stop "<|im_end|>"
        PARAMETER stop "<|im_start|>"
    """)

    modelfile_path.write_text(modelfile_content, encoding="utf-8")
    ok(f"Modelfile written to {modelfile_path}")
    info("Modelfile contents:")
    for line in modelfile_content.splitlines():
        print(f"    {line}")

    # ── Register in Ollama ────────────────────────────────────────────────────
    step(8, f"Register model in Ollama as '{OLLAMA_MODEL_NAME}'")

    # Clean up any previous validation run
    cleanup_ollama_model(OLLAMA_MODEL_NAME)
    run_ollama_create(OLLAMA_MODEL_NAME, modelfile_path)

    # ── Verify chat ───────────────────────────────────────────────────────────
    step(9, "Verify: send test message and check response")

    test_prompt = "你好，你是谁？请用一句话介绍自己。"
    response = run_ollama_chat(OLLAMA_MODEL_NAME, test_prompt)

    print(f"\n  Prompt : {test_prompt}")
    print(f"  Response: {response}\n")

    if not response.strip():
        fail("Empty response from model — something went wrong with the Modelfile or GGUF")

    # Basic sanity: response should be in Chinese
    chinese_chars = sum(1 for c in response if '\u4e00' <= c <= '\u9fff')
    if chinese_chars < 5:
        info("WARNING: Response contains very few Chinese characters. "
             "Chat template may not be working correctly.")
    else:
        ok(f"Response contains Chinese characters ({chinese_chars} found) ✓")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  VALIDATION COMPLETE")
    print(f"{'='*60}")
    print(f"  Adapter  : {adapter_dir}")
    print(f"  GGUF     : {gguf_path}")
    print(f"  Modelfile: {modelfile_path}")
    print(f"  Ollama   : {OLLAMA_MODEL_NAME}")
    print()
    print("  Next steps:")
    print("  1. Copy the TEMPLATE block from the Modelfile into ollama_service.py")
    print("  2. Replace the placeholder executor in llm_training.py with the")
    print("     same logic as this script (wrapped in asyncio.to_thread)")
    print("  3. Wire LLMModelService.register_model() after GGUF export")
    print()
    print("  To clean up this validation model:")
    print(f"  ollama rm {OLLAMA_MODEL_NAME}")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mely AI LLM pipeline validation")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/tmp/mely-validate"),
        help="Directory for adapter, GGUF output and Modelfile (default: /tmp/mely-validate)",
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=TRAIN_STEPS,
        help=f"Number of training steps (default: {TRAIN_STEPS})",
    )
    parser.add_argument(
        "--lora-rank",
        type=int,
        default=LORA_RANK,
        help=f"LoRA rank (default: {LORA_RANK}, lower = less VRAM)",
    )
    args = parser.parse_args()

    TRAIN_STEPS = args.steps
    LORA_RANK = args.lora_rank

    try:
        main(args.output_dir)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        print("\n\n  Interrupted by user.", file=sys.stderr)
        sys.exit(1)
