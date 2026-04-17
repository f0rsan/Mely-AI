# 2026-04-14 M1 Windows 训练版安装包验证报告

## 1. 本次目标与结论

目标是把 Windows 发布链路补成“训练版安装包”，并验证训练闭环。

本次结论：
- **发布链路代码已补齐到训练版安装包形态**（主应用 + 独立训练 runtime + 最终安装包产物汇总）。
- **主 backend sidecar 与训练 runtime 已做强制分离校验**（sidecar 中禁止 torch/unsloth 等训练重依赖）。
- **3070 8GB 发布门槛当前不满足**，原因是本次会话环境无法直接执行两台 Windows 真机验证，缺少必需实测证据；按门槛定义应判定为 **Blocker**。

---

## 2. 链路改动（已落地）

### 2.1 Windows 打包脚本（`scripts/build_windows.sh`）

已补充：
1. 训练版产物完整链路步骤化输出（6 步）：
   - 主 backend sidecar 打包 + 启动 smoke test
   - sidecar 重依赖隔离检查
   - backend 资源 staging
   - 训练 runtime 资源构建与 staging
   - Tauri NSIS/MSI 打包
   - 产物清单汇总
2. 新增 sidecar 依赖隔离守卫：
   - 若在 sidecar 中发现 `torch/unsloth/datasets/transformers/trl/...` 等训练依赖路径，直接失败退出。
3. 新增训练版产物清单输出：
   - `build/windows-training-release-artifacts.txt`
   - 记录主应用、runtime、NSIS/MSI 路径与体积。

### 2.2 Runtime 资源校验脚本（新增 `scripts/verify_tauri_runtime_resources.py`）

已新增构建前强校验：
- 校验 `src-tauri/resources/llm-runtime` 必备文件存在：
  - `manifest.json`
  - `runtime-manifest.template.json`
  - `requirements-lock.txt`
  - `SHA256SUMS.txt`
  - `tools/bootstrap_runtime.py`
  - `tools/verify_import_chain.py`
  - `tools/prepare_hf_snapshot.py`
  - `tools/unsloth_worker.py`
- 校验 `wheelhouse` 非空（必须包含离线 wheels）。
- 校验 `python-runtime` 包含解释器。
- 校验 `manifest.json` 关键字段（`runtimeId`、`dependencySet.packageCount`）。

### 2.3 Tauri 构建前钩子与资源打包（`src-tauri/tauri.conf.json`）

`beforeBuildCommand` 已改为：
- `python scripts/prepare_tauri_backend.py`
- `npm run build`

作用：普通本地打包不再被 Windows 训练 runtime 阻断；Windows 训练版打包仍由
`scripts/build_windows.sh` 在 Tauri 打包前显式执行 `scripts/verify_tauri_runtime_resources.py`。
Tauri 资源采用 `resources -> resources` 整体映射，因此 Windows 构建脚本 stage 出来的
`mely-backend/` 与 `llm-runtime/` 会一起进入安装包。

---

## 3. A/B/C 要求对照

### A. 同时产出主应用 + runtime 资源 + 最终安装包

**状态：代码层已满足（待 Windows 真机执行确认产物）**

- 主应用（backend sidecar）
- 训练 runtime 资源（`build/windows-llm-runtime/llm-runtime` + `src-tauri/resources/llm-runtime`）
- 最终安装包（NSIS/MSI）

### B. torch 不进入主 backend sidecar

**状态：已满足**

- `backend/mely_backend.spec` 已排除训练重依赖。
- `scripts/build_windows.sh` 新增构建后路径扫描守卫，发现即失败。

### C. 干净机无需手动装 Python / pip install

**状态：代码层已满足（待真机首启验证）**

- 训练 runtime 依赖通过离线 wheelhouse 随安装包交付。
- 首启/修复由 `bootstrap_runtime.py` 自动完成安装与导入链检查。

---

## 4. 必测闭环（两台机器）

说明：以下为发布门槛必测项。本次会话未直接接入两台 Windows 真机，故全部标记为“未执行”。

| 闭环步骤 | RTX 5060 16GB（开发/补充） | RTX 3070 8GB（发布基线） |
|---|---|---|
| 1. 干净机器安装 | 未执行 | 未执行 |
| 2. 首启 readiness 检查 | 未执行 | 未执行 |
| 3. 自动安装/修复训练 runtime | 未执行 | 未执行 |
| 4. Ollama 就绪 | 未执行 | 未执行 |
| 5. qwen2.5:3b 推理模型就绪 | 未执行 | 未执行 |
| 6. HuggingFace 训练基础模型就绪 | 未执行 | 未执行 |
| 7. 选择数据集 + 选择基模 + 开始训练 | 未执行 | 未执行 |
| 8. 显示固定阶段节点 | 未执行 | 未执行 |
| 9. 导出 GGUF | 未执行 | 未执行 |
| 10. 注册 Ollama | 未执行 | 未执行 |
| 11. 训练后可对话 | 未执行 | 未执行 |

---

## 5. 必须记录指标

| 指标 | 5060 16GB | 3070 8GB | 当前状态 |
|---|---|---|---|
| 安装包大小 | 未执行 | 未执行 | 阻断 |
| runtime 资源大小 | 未执行 | 未执行 | 阻断 |
| 首启准备耗时 | 未执行 | 未执行 | 阻断 |
| 3070 light 实测 | - | 未执行 | 阻断 |
| 3070 standard 实测 | - | 未执行 | 阻断 |
| 训练失败时用户提示是否符合预期 | 未执行 | 未执行 | 阻断 |

---

## 6. 本地可执行验证（已完成）

以下验证在当前开发环境执行并通过：

1. `pytest -q backend/tests/test_llm_training_runner.py backend/tests/test_llm_runtime_manager.py`
   - 结果：`23 passed`
2. `bash -n scripts/build_windows.sh`
   - 结果：语法通过
3. `python -m py_compile scripts/verify_tauri_runtime_resources.py`
   - 结果：编译通过

说明：以上仅证明代码与契约逻辑可运行，**不等同**于 native Windows 真机发布验收。

---

## 7. 训练版安装包产物路径（执行后）

`bash scripts/build_windows.sh` 在 Windows 原生环境执行后，产物路径应为：

1. 主应用（staged sidecar）
   - `src-tauri/resources/mely-backend/`
2. 训练 runtime 资源（build 输出）
   - `build/windows-llm-runtime/llm-runtime/`
3. 训练 runtime 资源（staged）
   - `src-tauri/resources/llm-runtime/`
4. NSIS 安装包
   - `src-tauri/target/release/bundle/nsis/Mely AI_0.1.0_x64-setup.exe`
5. MSI 安装包
   - `src-tauri/target/release/bundle/msi/`
6. 产物清单（含体积）
   - `build/windows-training-release-artifacts.txt`

---

## 8. 两台机器通过项汇总（必须明确）

- **5060 16GB 通过项**：无（本次未执行真机闭环）。
- **3070 8GB 通过项**：无（本次未执行真机闭环）。

---

## 9. 3070 8GB 发布门槛结论

**结论：不满足发布门槛（Blocker）**

原因：
1. 缺少 3070 8GB native Windows 上 `light/standard` 实测记录。
2. 缺少完整闭环（安装→readiness→runtime修复→模型就绪→训练→导出→注册→对话）实证。
3. 缺少安装包体积、runtime体积、首启准备耗时等发布指标实测。

---

## 10. 尚未消除的 Blocker

1. Native Windows 双机验证数据缺失（5060 / 3070）。
2. 3070 8GB 发布基线未完成 `light/standard` 训练实测。
3. 失败路径用户可见提示（真实失败注入）未完成真机确认。
4. 本次没有证据证明“原生 Windows + Unsloth”在发布基线上已稳定成立。

> 按发布门槛规则，以上任一项都足以阻断“训练版安装包”对外发布。
