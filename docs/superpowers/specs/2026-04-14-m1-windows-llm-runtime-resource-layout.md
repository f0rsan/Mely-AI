# 2026-04-14 M1 Windows LLM Runtime 资源目录规范（执行版）

## 1. 目标

在 Windows 构建机上产出可直接打进 Tauri/NSIS 的独立训练 runtime 资源目录，满足：

1. 不把 `torch/unsloth` 打进主 sidecar。
2. 训练依赖离线化（wheelhouse）。
3. 训练 worker 可脱离源码工作区调用。
4. 产物自带 `manifest.json` 与 `SHA256SUMS.txt`，可做完整性校验与修复。

## 2. 构建命令

```bash
python scripts/generate_windows_llm_runtime_lock.py

python scripts/build_windows_llm_runtime.py \
  --runtime-python "C:/Python311/python.exe" \
  --output-dir build/windows-llm-runtime \
  --stage-dir src-tauri/resources/llm-runtime
```

> `--runtime-python` 要求指向独立 Python 3.11 解释器，不与主 sidecar Python 强绑定。

## 3. 资源目录结构

```text
src-tauri/resources/llm-runtime/
  python-runtime/
  wheelhouse/
  tools/
    unsloth_worker.py
    bootstrap_runtime.py
    verify_import_chain.py
    prepare_hf_snapshot.py
  requirements-lock.txt
  runtime-manifest.template.json
  manifest.json
  SHA256SUMS.txt
```

## 4. 运行时安装入口

首启/修复阶段调用：

```bash
python tools/bootstrap_runtime.py \
  --seed-root "src-tauri/resources/llm-runtime" \
  --target-root "%USERPROFILE%/.mely/runtimes/llm/llm-win-cu121-py311-v1"
```

安装完成后生成：

```text
%USERPROFILE%/.mely/runtimes/llm/llm-win-cu121-py311-v1/manifest.runtime.json
```

其中必须包含：

- `python.exePath`（独立 runtime 的解释器路径）
- `worker.entryScript`（runtime worker 路径）
- `readiness.state = READY`

## 5. 最小 smoke test

构建脚本内置以下最小校验：

1. 离线安装 lockfile 到临时 venv
2. 验证 `import torch/unsloth/datasets/transformers/trl`
3. 使用 runtime 内 `tools/unsloth_worker.py` 做 dry-run 启动

任一步失败即构建失败（阻断）。
