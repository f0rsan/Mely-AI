# MiroFish Sprint Backlog v1（12 周）

- 目标：把规划转成可执行迭代
- 节奏：双周 Sprint，共 6 个 Sprint
- 角色缩写：PM/UX/FE/BE/AI/QA/DevOps

---

## Sprint 1（周1-2）基础骨架

### 目标
- 项目可编译、可部署、可登录

### 用户故事
- 作为创作者，我可以注册登录并创建项目空间

### 任务
1. Monorepo 初始化（FE+BE）
2. CI Pipeline（DevOps）
3. Auth（邮箱登录）与会话（BE）
4. Web Console 三栏骨架（FE+UX）
5. Postgres/Redis/S3 本地开发环境（DevOps）
6. 基础埋点 SDK（FE+BE）

### 验收
- 登录可用
- 创建项目可用
- 主干 CI 全绿

---

## Sprint 2（周3-4）生成主链路

### 目标
- 用户可完成首个生成任务

### 用户故事
- 作为创作者，我输入需求后能获得可编辑输出

### 任务
1. `POST /generation/run`（BE）
2. Orchestrator v1（AI+BE）
3. Prompt Editor + Output Panel（FE）
4. Run History 列表页（FE）
5. 错误处理与重试（BE）
6. E2E：登录→生成→保存（QA）

### 验收
- 端到端生成成功率 ≥ 95%（内测环境）

---

## Sprint 3（周5-6）Persona + Memory

### 目标
- 个性化可感知

### 用户故事
- 作为创作者，我能配置个人风格并让系统记住偏好

### 任务
1. Persona CRUD API（BE）
2. Memory 导入/检索 API（BE+AI）
3. Memory 命中展示 UI（FE）
4. Prompt 组装策略（AI）
5. 数据迁移与审计字段（BE）
6. 回归测试（QA）

### 验收
- 风格一致性评分提升（对照组 +10%）

---

## Sprint 4（周7-8）计费与风控

### 目标
- 初步可商用

### 用户故事
- 作为平台，我可以对用户进行套餐计费并控制风险

### 任务
1. Basic/Pro 套餐模型（PM+BE）
2. 配额/限流中间件（BE）
3. Safety pre/post check（AI+BE）
4. 风险标签展示（FE）
5. 计费事件对账（BE+DevOps）
6. 安全回归测试（QA）

### 验收
- 配额生效
- 风险策略可阻断高危请求

---

## Sprint 5（周9-10）微调闭环

### 目标
- 支持 LoRA 训练并部署

### 用户故事
- 作为创作者，我能上传数据并生成我的微调模型

### 任务
1. `POST /finetune/jobs`（BE）
2. BullMQ 队列 + Worker（BE+AI）
3. 训练工件存储与版本化（AI+BE）
4. 评测脚本（风格/事实/安全）（AI）
5. 任务状态 UI（FE）
6. 失败恢复机制（BE+DevOps）

### 验收
- 至少 1 个 LoRA job 端到端成功

---

## Sprint 6（周11-12）Hub 邀请制上线

### 目标
- 模型包可发布、可购买（邀请制）

### 用户故事
- 作为创作者，我能上架模型包并获得交易收入

### 任务
1. 模型包数据模型与发布 API（BE）
2. 审核状态机（BE+PM）
3. Hub 列表与详情页（FE+UX）
4. 订单与分账流水（BE）
5. 侵权申诉入口（FE+BE）
6. 发布灰度与回滚预案（DevOps+QA）

### 验收
- 完成首笔内测交易闭环

---

## 共性任务（每个 Sprint 必做）

1. 技术债清单更新
2. 指标看板更新（留存/成功率/成本）
3. 风险评审（合规/稳定性/性能）
4. 发布复盘（事故与优化）

---

## Definition of Done（DoD）

- 需求有验收标准
- 代码有测试
- 有监控埋点
- 文档同步更新
- 安全检查通过
- 可回滚

---

## 负责人建议（RACI 简版）

- PM：需求边界、优先级、验收
- UX：信息架构、交互与视觉一致性
- FE：Console 与交互实现
- BE：业务 API、数据模型、队列
- AI：提示词系统、路由、训练评测
- QA：功能回归、链路稳定性
- DevOps：发布、监控、成本与容量
