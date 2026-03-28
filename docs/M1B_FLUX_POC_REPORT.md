# M1B — FLUX 模型 PoC 与默认模型决策（3070 8GB）

日期：2026-03-27  
负责人：M1B

## 1. 本次目标与完成标准

### 本线程目标
在 **RTX 3070 8GB VRAM** 约束下，对 `FLUX-dev Q4` 与 `FLUX-schnell` 做最小可验证对比，并给出能直接交付给 M1E 的默认模型与训练模式决策。

### 我为自己定义的完成标准
1. 对两模型给出明确结论：能否跑、显存是否超限、是否可作为 M1 默认。
2. 给出 `轻量 / 标准 / 精细` 三档建议与降级条件。
3. 给出后端配置生成必须遵守的硬边界（可直接编码）。
4. 若实机实验无法完成，明确写出卡点并给出可执行替代结论（不留空白）。

## 2. 最小可验证实验（实际执行）

## 2.1 本地环境自检（已执行）

执行结果：
- `nvidia-smi`：命令不存在。
- `python3 -c "import torch ..."`：`ModuleNotFoundError: No module named 'torch'`。
- `python3 -c "import importlib.util ..."`：`ai_toolkit=False, toolkit=False, kohya_ss=False`。
- 系统信息：`macOS 26.3 (arm64)`，非 RTX 3070 机器。

结论：当前工作区 **不具备** 3070 + CUDA + AI-Toolkit 的实机训练条件，无法在本线程完成“真机跑通”型 PoC。

## 2.2 上游一手证据（用于替代验证）

基于官方/上游文档核对到的关键事实：
- AI-Toolkit README 明确写明：**训练 FLUX.1 当前需要至少 24GB VRAM**，且“仍然非常实验性”。
- AI-Toolkit 对 `FLUX.1-dev` 与 `FLUX.1-schnell` 都给出了 `train_lora_flux_24gb*.yaml` 示例。
- `FLUX.1-dev` 示例中 `quantize: true` 注释为 **8bit mixed precision**，不是 Q4 默认路径。
- `FLUX.1-schnell` 训练需要额外 `assistant_lora_path: ostris/FLUX.1-schnell-training-adapter`。
- Hugging Face 模型卡：
  - `FLUX.1-dev`：`flux-1-dev-non-commercial-license`（非商用）。
  - `FLUX.1-schnell`：`apache-2.0`（可商用），并强调 1–4 steps 生成。

## 3. 对比结论（按你要求的维度）

| 维度 | FLUX-dev Q4 | FLUX-schnell |
|---|---|---|
| 能不能跑通（3070 8GB） | **未证实可跑通，风险极高**。当前仓库与官方示例都无 8GB 可复现实证。 | **未证实可跑通，风险极高**。官方训练示例仍以 24GB 为基线。 |
| 显存是否超限 | 大概率超限。即便官方 8bit 量化仍以 24GB 为前提。 | 大概率超限。且 schnell 训练需 adapter，低显存模式会更慢。 |
| 基本训练可行性 | 在 8GB 条件下不可作为稳定默认路径；且 Q4 在当前主线工具链不是标准配置。 | 在 8GB 条件下不可作为稳定默认路径；但工具链支持更明确（有官方训练 adapter）。 |
| 采样/训练速度 | 采样步骤通常更高（dev 示例 20 步，HF 参考 50 步），预览更慢。训练本身仍重。 | 采样明显更快（1–4 步），更适合“每20%采样图”场景；训练本身仍重。 |
| 质量是否足以做 M1 默认 | 画质潜力更高，但在本项目受制于 8GB 与许可证，不适合做默认。 | 质量足够做 M1 默认候选（特别是采样预览），但 **仅在显存达标时**。 |

> 说明：上表中“质量”判断来自模型卡描述与训练链路复杂度推断；非本机实测。

## 4. 明确决策（不模糊）

## 4.1 M1 默认模型选型
- **默认模型（策略默认）**：`FLUX-schnell`
- **不选 FLUX-dev Q4 作为默认的原因**：
  1. `FLUX-dev` 许可证为非商用，不适合作为产品默认。
  2. 当前主线工具链（AI-Toolkit）默认量化路径是 8bit，`Q4` 不是标准主路径，工程不确定性更高。
  3. schnell 在采样速度上更适配 M1 的“训练中预览图”体验。

## 4.2 备选方案
- **备选一（推荐实际落地）**：`SDXL`（仅用于 8GB 设备训练执行层）
  - 理由：在 8GB 上更可控，能先保证 M1 训练闭环交付。
- **备选二（实验开关）**：`FLUX-dev Q4` 仅实验模式可选，不作为默认。

## 4.3 降级/回退触发条件
1. 用户设备 `VRAM < 24GB` 且选择 FLUX 训练：
   - 自动降级到 `SDXL`（保留“轻量/标准/精细”模式语义）。
2. FLUX-schnell 训练启动失败（adapter 拉取失败 / OOM / baseline sample 长时间卡住）：
   - 立即回退 `SDXL 标准模式`，并提示中文原因。
3. 用户强制选择 FLUX-dev：
   - 必须弹出“非商用许可继承风险”确认；未确认不启动。

## 5. 给 M1E 的可直接输入（可编码约定）

## 5.1 默认值
- `defaultModel`: `flux-schnell`
- `defaultMode`: `standard`
- `effectiveRuntimeModelOn8GB`: `sdxl`

## 5.2 模式建议（3070 8GB 视角）
- `轻量`：优先走 `sdxl`（8GB 安全余量最大）。
- `标准`：优先走 `sdxl`，目标满足 M1 “<40min”验收。
- `精细`：
  - `sdxl` 需 >=12GB；
  - `flux-*` 暂按 >=24GB（当前上游事实）处理。

## 5.3 显存风险说明（用户可见）
- 3070 8GB 选择 FLUX 时统一提示：
  - 「当前显存不足以稳定运行 FLUX 训练，已自动切换到兼容模式（SDXL）。」
- 精细模式显存不足提示：
  - 「显存不足，精细模式需要更高显存。已为你切换到标准模式。」

## 5.4 配置生成硬边界（必须遵守）
1. 禁止在 `VRAM < 24GB` 时直接下发 FLUX 训练作业。
2. `flux-schnell` 作业必须附带 `assistant_lora_path`。
3. `flux-dev` 作业必须要求许可证确认（非商用）。
4. 训练任务创建前必须先做显存预检并落库（用于追踪自动降级原因）。
5. 自动降级必须是确定性逻辑（同一输入同一结果），禁止“试错后再降级”。

## 6. 当前阻塞与风险

1. **硬阻塞**：本线程运行环境不是 RTX 3070 + CUDA，无法给出“实机跑通证据”。
2. **规格冲突风险**：项目既定“8GB 默认训练”与上游“FLUX 训练至少 24GB”冲突，若不先明确“8GB 走 SDXL 执行层”，M1E 会反复返工。
3. **许可证风险**：若默认用 FLUX-dev，商业路径会被非商用许可卡住。

## 7. 建议给 M1A 的下一步

1. 在有 3070 8GB 实机的线程执行补充验证：
   - 同数据集、同步数下跑 `flux-schnell`（实验）与 `sdxl`（基线）最小对比，记录显存峰值与时间。
2. M1A 立即确认“策略默认 vs 执行默认”两层定义：
   - 策略默认：`flux-schnell`
   - 3070 执行默认：`sdxl`
3. 若 M1A 不接受双层默认，则应立即改写里程碑目标，避免 M1E 按 FLUX 8GB 强行实现后返工。

## 8. 参考来源

- AI-Toolkit README（FLUX 训练显存要求、许可证说明）：  
  https://github.com/ostris/ai-toolkit
- AI-Toolkit FLUX dev 示例配置（24GB、8bit quantize）：  
  https://raw.githubusercontent.com/ostris/ai-toolkit/main/config/examples/train_lora_flux_24gb.yaml
- AI-Toolkit FLUX schnell 示例配置（训练 adapter、4 步采样）：  
  https://raw.githubusercontent.com/ostris/ai-toolkit/main/config/examples/train_lora_flux_schnell_24gb.yaml
- Hugging Face FLUX.1-dev 模型卡（非商用许可）：  
  https://huggingface.co/black-forest-labs/FLUX.1-dev
- Hugging Face FLUX.1-schnell 模型卡（Apache-2.0、1–4 steps）：  
  https://huggingface.co/black-forest-labs/FLUX.1-schnell

## 9. 流程补正复核

本节是对前一轮结论做的流程校正，不是重新扩张范围。

- 已重新对照 `using-superpowers` 和 `verification-before-completion` 的要求，确认当前这份报告的结论必须以“证据复核后再收口”的方式表达。
- 这次补正只做证据复核和结论确认，没有进入新的方案设计，也没有进入实现拆解，因此不需要额外扩展到 `brainstorming` 或 `writing-plans`。
- 重新核对的事实没有变化：当前工作区不是 3070 8GB CUDA 机器，`nvidia-smi` 不存在，`torch` 未安装，`ai_toolkit` 未安装，官方上游文档仍指向 FLUX 训练至少 24GB VRAM。
- 因此，本报告的核心结论保持不变：
  - `FLUX-schnell` 仍是策略默认模型。
  - `SDXL` 仍是 3070 8GB 的执行层默认。
  - `FLUX-dev` 仍只保留实验选项。
  - `VRAM < 24GB` 时仍不能直接下发 FLUX 训练。
- 仍然没有完成的部分也没有变化：3070 8GB 真机最小实测仍待补，这一项不能被当前环境自检替代。
