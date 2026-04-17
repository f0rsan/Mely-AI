# Windows LLM GPU Runtime Seed Package

This directory defines the standalone runtime artifact for Windows LLM training.
It is intentionally separated from the backend sidecar bundle.

## Locked target matrix

- OS: Windows (`win_amd64`)
- CUDA wheel source: `cu121` index
- Python ABI for wheels: `cp311`
- Runtime roots: `torch`, `unsloth`, `datasets`, `transformers`, `trl`

## Source files

- `requirements.windows-py311-cu121.lock`
  - Full transitive lockfile for the runtime roots.
- `runtime-manifest.template.json`
  - Contract template for runtime install/readiness.
- `tools/bootstrap_runtime.py`
  - First-launch install / repair helper.
- `tools/verify_import_chain.py`
  - Import-chain smoke validator.

## Build commands

Regenerate lockfile after `backend/uv.lock` updates:

```bash
python scripts/generate_windows_llm_runtime_lock.py
```

Build runtime seed package and stage into Tauri resources:

```bash
python scripts/build_windows_llm_runtime.py \
  --runtime-python "C:/Python311/python.exe" \
  --output-dir build/windows-llm-runtime \
  --stage-dir src-tauri/resources/llm-runtime
```

## Expected runtime seed structure

```text
llm-runtime/
  python-runtime/
  wheelhouse/
  tools/
    unsloth_worker.py
    bootstrap_runtime.py
    verify_import_chain.py
    prepare_hf_snapshot.py
  requirements-lock.txt
  manifest.json
  SHA256SUMS.txt
```
