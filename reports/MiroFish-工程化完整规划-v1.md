# MiroFish 项目工程化完整规划 v1

- 目标：将现有原型（https://666ghj.github.io/mirofish-demo/console）的产品风格保留，并升级为可上线、可扩展、可商业化的工程系统。
- 文档定位：可直接进入立项评审、技术评审与迭代排期。
- 版本：v1.0（2026-03-12）

---

## 0. 执行摘要（给明早 8 点快速检查）

本规划将 MiroFish 拆为三层能力：
1. **创作体验层**（保留原型视觉风格 + Console 交互）
2. **个性化智能层**（Persona、Memory、RAG、LoRA 微调）
3. **平台交易层**（模型包发布、分发、结算、治理）

建议采用 **Monorepo + API First + 可替换模型路由** 架构，分三阶段交付：
- Phase 1（0-6 周）：MVP 可用
- Phase 2（7-12 周）：个性化与微调闭环
- Phase 3（13-24 周）：模型分发与交易上线

---

## 1. 产品北极星与边界

## 1.1 北极星
- 让每个创作者拥有“可持续进化、可商业变现、可治理”的私人模型。

## 1.2 非目标（强约束）
- 不以“越狱”作为能力卖点。
- 不提供违法或高风险内容分发能力。
- 不做无治理的开放模型交易市场。

## 1.3 成功指标（首版）
- W4 创作者留存 ≥ 30%
- 首月付费转化 ≥ 8%
- 单任务毛利为正
- 违规率 ≤ 1.5%

---

## 2. 保留原型风格的前端设计规范

基于原型页面可观察到的特征（深色、玻璃质感、渐变金属按钮、JetBrains Mono + Inter）制定如下规范：

### 2.1 Design Tokens（首版）
- 字体：JetBrains Mono / Inter / Noto Sans SC
- 基础底色：#0B0D12 / #11131A
- 前景文字：#E5E7EB / #9CA3AF
- 交互高亮：#7C8CFF / #A78BFA / #34D399
- 卡片样式：`bg-white/5 + border-white/10 + backdrop-blur`
- 交互动效：`cubic-bezier(0.4,0,0.2,1)`，过渡 200~350ms

### 2.2 Console 信息架构
- 左侧：导航（Studio / Memory / Models / Hub / Billing / Settings）
- 中间：创作工作区（Prompt + Context + Output + Compare）
- 右侧：质量与风格面板（Consistency / Factuality / Risk）

### 2.3 前端技术栈
- Next.js 15（App Router）
- TypeScript
- TailwindCSS + shadcn/ui（定制成原型风格）
- Zustand（本地状态） + TanStack Query（服务端状态）
- Playwright（E2E）

---

## 3. 系统架构（可实现）

## 3.1 总体拓扑
1. **Web App（Console）**
2. **API Gateway（BFF）**
3. **Core Services**
   - Auth & Tenant
   - Persona Service
   - Memory Service
   - Generation Orchestrator
   - Fine-tune Service
   - Hub/Marketplace Service
   - Billing Service
   - Trust & Safety Service
4. **Data Layer**
   - Postgres（业务数据）
   - Redis（会话缓存/队列状态）
   - Object Storage（素材、模型包、评测结果）
   - Vector DB（pgvector / Weaviate，二选一）
5. **Model Layer**
   - 第三方模型 API（可路由）
   - 自托管开源模型推理（vLLM）
   - LoRA 训练任务（异步）

## 3.2 架构原则
- API First：所有能力先定义 OpenAPI
- 可替换模型：路由层可按任务类型切换模型
- 数据权限分离：用户数据、模型参数、审计日志隔离
- 任务异步化：训练与评测全部入队列

## 3.3 推荐后端栈
- Node.js + NestJS（或 Fastify）
- Postgres + Prisma
- Redis + BullMQ
- S3 兼容对象存储
- OpenTelemetry + Prometheus + Grafana

---

## 4. 核心模块与 API（MVP 范围）

## 4.1 Auth & Tenant
- 登录：邮箱/SSO
- 多租户：Creator / Studio 两级权限
- API：
  - `POST /auth/login`
  - `GET /me`
  - `POST /teams`

## 4.2 Persona & Memory
- Persona：语气、风格、禁忌、偏好
- Memory：短期会话记忆 + 长期知识记忆
- API：
  - `POST /personas`
  - `PATCH /personas/:id`
  - `POST /memory/items`
  - `POST /memory/search`

## 4.3 Generation Orchestrator
- 输入：任务类型 + Persona + Context
- 输出：候选内容 + 评分 + 风险标签
- API：
  - `POST /generation/run`
  - `POST /generation/compare`

## 4.4 Fine-tune
- 数据集上传
- LoRA 任务调度
- 评测结果回传
- API：
  - `POST /finetune/jobs`
  - `GET /finetune/jobs/:id`
  - `POST /finetune/jobs/:id/deploy`

## 4.5 Hub / Marketplace
- 模型包发布、审核、上架
- 授权与分成
- API：
  - `POST /hub/packages`
  - `POST /hub/packages/:id/submit`
  - `POST /hub/packages/:id/purchase`

## 4.6 Trust & Safety
- 文本风险分级
- 模型包审核状态机
- 审计日志
- API：
  - `POST /safety/check`
  - `GET /audit/logs`

---

## 5. 数据模型（最小可用）

核心表（Postgres）：
- `users`
- `teams`
- `personas`
- `memory_items`
- `generation_tasks`
- `finetune_jobs`
- `models`
- `model_packages`
- `orders`
- `payouts`
- `audit_logs`
- `policy_events`

关键约束：
- 所有资源绑定 `owner_id` 与 `team_id`
- 审计日志不可硬删除，仅可归档
- 模型包版本化（`package_id + semver`）

---

## 6. 安全、合规与治理（工程落地点）

- 上传数据强制来源声明（原创/授权/公开许可）
- 发布前“双阶段审核”：机器审核 + 抽样人工
- 高风险请求默认阻断并记录 `policy_events`
- 训练与推理日志脱敏（PII masking）
- 支持用户导出与删除（DSR 流程）

---

## 7. 交付计划（24 周）

## Phase 1：MVP（0-6 周）
目标：创作者可用 + 可付费
- Console 基础版
- Persona + Memory + Generation
- 基础订阅计费（Basic / Pro）
- 指标看板 v1

里程碑：
- M1（第2周）：UI 框架 + 登录 + 项目空间
- M2（第4周）：生成链路打通
- M3（第6周）：内测上线

## Phase 2：个性化闭环（7-12 周）
目标：微调可用 + 质量可衡量
- LoRA 训练任务系统
- 输出评分体系（风格一致性/事实性）
- 模型版本管理

里程碑：
- M4（第9周）：首个 LoRA Job 完成并部署
- M5（第12周）：A/B 比较与回滚机制上线

## Phase 3：交易平台（13-24 周）
目标：发布与变现闭环
- 模型包发布审核
- 购买、分成、结算
- 审计追踪、侵权处理流程

里程碑：
- M6（第16周）：邀请制上架
- M7（第20周）：首笔成交
- M8（第24周）：公开 beta

---

## 8. 团队配置（最小可执行）

- PM：1
- 设计：1
- 前端：2
- 后端：3
- AI 工程：2
- 测试：1
- DevOps：1（可兼职）
- 法务/合规：0.5（兼职支持）

---

## 9. 风险清单与缓解

1. **成本失控**：
   - 缓解：模型路由分层 + 缓存 + 限流 + 异步训练配额
2. **留存不足**：
   - 缓解：首日引导完成“首个可发布成果” + 模板市场
3. **合规事故**：
   - 缓解：默认安全策略、审计追溯、分级治理
4. **交易冷启动失败**：
   - 缓解：先官方模板和头部创作者邀请制

---

## 10. 工程启动清单（本周即可开干）

- [ ] 初始化 Monorepo（apps/web, apps/api, services/*, packages/*）
- [ ] 定义 OpenAPI v1（Auth/Persona/Generation）
- [ ] 建立 CI（lint/test/build）
- [ ] 配置 observability（日志、指标、追踪）
- [ ] 建立种子数据与 demo 场景
- [ ] 输出 UI token 与组件库基线

---

## 11. 关于“缺少技能自动安装”的执行情况

我已尝试通过 ClawHub 安装架构相关技能，但当前遇到 **registry rate limit**，安装命令返回 `Rate limit exceeded`。 
已完成：
- `clawhub search "software architecture"`（可检索）
- `clawhub install software-architect`（受限流失败）

建议：
- 稍后重试安装
- 或先按本规划直接开工（不阻塞工程实施）

---

## 12. 明早 8 点检查建议（你可按这个顺序验收）

1. 是否保留原型风格并给出明确 UI 规范
2. 是否有可落地技术栈与模块边界
3. 是否有分阶段里程碑与量化指标
4. 是否覆盖合规、风控、交易闭环
5. 是否可直接转 Jira 任务执行

> 结论：本规划已达到“可以拉团队开工”的工程化深度；下一步建议立刻进入 Repo 初始化与 API 契约冻结。
