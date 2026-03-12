# MiroFish 全量实施蓝图（从大到小）v1

- 版本：v1.0
- 日期：2026-03-12
- 目标：把 MiroFish 从原型风格升级为可交付、可上线、可增长、可治理、可交易的完整产品工程。

---

## 0. 总体结构（L0）

1. 战略与产品
2. 商业化与增长
3. 体验与设计系统
4. 技术架构与工程
5. AI 能力与数据闭环
6. 安全、合规、治理
7. 运维、SRE、质量体系
8. 组织、流程、预算
9. 分阶段里程碑与验收

---

## 1. 战略与产品（L1-L3）

## 1.1 产品定位
- 私人模型资产平台（Create → Train → Deploy → Trade）
- 核心用户：独立创作者 / 工作室 / IP 运营方
- 核心价值：像你、懂你、属于你、能赚钱

## 1.2 产品范围
- In Scope：
  - 创作工作台
  - Persona + Memory
  - RAG + LoRA 微调
  - 模型包发布与交易
  - 质量评分与风险治理
- Out of Scope（首版）：
  - 全自动无人值守社交代理网络
  - 无审核开放发布
  - 高风险内容能力

## 1.3 用户旅程（全链路）
- 注册/登录 → 创建项目 → 导入素材 → 配置 Persona → 首次生成 → 评分迭代 → 微调部署 → 发布模型包 → 交易结算 → 持续优化

## 1.4 功能地图（Feature Map）
- Studio（创作）
- Memory（记忆）
- Train（训练）
- Hub（市场）
- Safety（治理）
- Billing（计费）
- Analytics（分析）

---

## 2. 商业化与增长（L1-L4）

## 2.1 收费模型
- 订阅：Basic / Pro / Studio
- 交易：模型包抽佣（15%-30%）
- 增值：专属训练、白标、团队协作包

## 2.2 单位经济模型（UE）
- 收入项：订阅收入 + 交易抽成 + 服务费
- 成本项：推理、训练、存储、审核、人力
- 指标：
  - 每任务毛利
  - 每用户毛利
  - CAC/LTV

## 2.3 增长飞轮
- 模板效果好 → 创作者产出好 → 上架模型包 → 用户购买 → 收益反哺创作者 → 平台供给增加

## 2.4 上线策略
- 阶段 1：邀请制内测（50-100 创作者）
- 阶段 2：半开放（白名单）
- 阶段 3：公开 beta（分地区）

---

## 3. 体验与设计系统（L1-L4）

## 3.1 风格继承规范（基于现有原型）
- 深色空间感 + 玻璃拟态 + 柔光渐变
- 字体：Inter + JetBrains Mono + Noto Sans SC
- 交互动效：微弹性、光泽扫描、卡片悬浮

## 3.2 IA 信息架构
- 一级导航：Console / Memory / Models / Hub / Billing / Settings
- 二级结构：
  - Console：Editor、Compare、Run History
  - Models：Base、Fine-tuned、Deployed
  - Hub：Discover、Publish、Orders

## 3.3 设计系统资产
- Tokens：颜色、间距、圆角、阴影、动效
- Components：按钮、卡片、输入框、模型标签、评分条
- Patterns：三栏创作台、发布流程向导、审核状态机 UI

## 3.4 可用性标准
- 首次任务 3 分钟内完成
- 核心路径最多 5 步
- P95 页面交互响应 < 200ms（前端）

---

## 4. 技术架构与工程（L1-L5）

## 4.1 Monorepo 结构
- `apps/web`（Next.js）
- `apps/api`（NestJS/Fastify）
- `services/orchestrator`
- `services/trainer`
- `services/safety`
- `packages/ui`
- `packages/types`
- `packages/sdk`
- `infra/terraform`
- `ops/`（脚本、迁移、应急）

## 4.2 系统分层
- Presentation：Web Console
- BFF/API Gateway：鉴权、聚合
- Domain Services：Persona/Memory/Generation/Train/Hub/Billing/Safety
- Data：Postgres/Redis/Object Storage/Vector DB
- AI：模型路由 + 推理服务 + 微调任务

## 4.3 关键技术选型
- 前端：Next.js + TS + Tailwind + TanStack Query + Playwright
- 后端：NestJS + Prisma + BullMQ
- 数据：Postgres + Redis + S3 + pgvector
- 推理：第三方 API + vLLM（自托管）
- 观测：OpenTelemetry + Prometheus + Grafana + Loki

## 4.4 API 契约（首批）
- Auth：`/auth/*`
- Persona：`/personas/*`
- Memory：`/memory/*`
- Generation：`/generation/*`
- Fine-tune：`/finetune/*`
- Hub：`/hub/*`
- Safety：`/safety/*`
- Billing：`/billing/*`

## 4.5 非功能指标（NFR）
- 可用性：99.9%
- 生成接口 P95：< 2.5s（轻任务）
- 训练任务排队可观测
- 审计日志完整性：100%

---

## 5. AI 能力与数据闭环（L1-L5）

## 5.1 Prompt 系统
- 模板版本化（SemVer）
- 模板变量约束与校验
- 任务类型模板（写作/改写/脚本/分镜）

## 5.2 Memory 体系
- 短期记忆：会话上下文
- 长期记忆：用户知识库与偏好
- 检索策略：关键词 + 向量 + 权重融合

## 5.3 RAG 管线
- 上传 → 清洗 → 分块 → 向量化 → 索引
- 命中阈值与召回上限控制
- 引用片段可追踪

## 5.4 微调体系（LoRA）
- 数据集管理：版本、标签、授权状态
- 任务编排：排队、资源配额、失败重试
- 评测：风格一致性、事实性、毒性风险
- 部署：灰度发布、回滚、一键下线

## 5.5 模型路由策略
- 轻任务：低成本模型
- 重任务：高质量模型
- 敏感任务：安全策略先行
- 成本守护：超预算自动降级

---

## 6. 安全、合规、治理（L1-L5）

## 6.1 账号与访问控制
- RBAC：Owner/Admin/Editor/Viewer
- 关键操作二次确认（发布/下架/结算）

## 6.2 数据安全
- 传输加密（TLS）
- 存储加密（KMS）
- 脱敏日志（PII Masking）
- DSR（导出/删除）流程

## 6.3 内容治理
- 请求前策略检查
- 输出后审核评分
- 发布前机器审核 + 人工抽检
- 违规闭环：告警 → 限制 → 下架 → 复核

## 6.4 知识产权
- 训练数据来源声明
- 模型包 license 模板化
- 侵权申诉与响应 SLA

## 6.5 审计与追溯
- 全链路 trace id
- 关键事件不可篡改日志
- 版本签名与水印

---

## 7. 运维、SRE、质量体系（L1-L5）

## 7.1 环境分层
- local / dev / staging / prod
- 配置中心 + Secret 管理

## 7.2 CI/CD
- PR 检查：lint + unit + typecheck
- 主干合并：集成测试
- 发布：蓝绿/金丝雀

## 7.3 质量保障
- 单元测试覆盖率目标：> 70%
- 集成测试覆盖核心路径
- E2E 覆盖 10 条核心业务流
- 性能压测：峰值并发、队列堆积

## 7.4 监控告警
- RED + USE 指标
- 业务告警：成功率、支付异常、违规率
- 值班制度与故障升级路径

## 7.5 应急预案
- 推理供应商故障切换
- 训练队列积压清理
- 安全事件处置（24h）

---

## 8. 组织、流程、预算（L1-L4）

## 8.1 团队配置（首发）
- PM 1
- 设计 1
- FE 2
- BE 3
- AI 2
- QA 1
- DevOps 1（可兼职）
- 法务/合规 0.5

## 8.2 研发流程
- 双周迭代（Sprint）
- 周一计划、周三风险同步、周五评审
- 需求冻结点 + 发布冻结点

## 8.3 决策机制
- 架构评审委员会（每两周）
- 风控评审（每周）
- 上线 Go/No-Go 清单

## 8.4 预算框架（百分比）
- 推理与训练：40%
- 人力：35%
- 基础设施：15%
- 审核与合规：10%

---

## 9. 分阶段计划（L1-L5）

## Phase 1（0-6 周）MVP 可用
- 目标：创作者可在 Console 完成可发布内容
- 交付：
  - Auth/Team/Project
  - Persona/Memory/Generation
  - 订阅与额度
  - 基础监控

验收：
- 100 名内测用户可完成端到端创作
- 任务成功率 ≥ 70%

## Phase 2（7-12 周）个性化闭环
- 目标：支持微调、评测、部署、回滚
- 交付：
  - LoRA 任务系统
  - 评测面板
  - 模型版本管理

验收：
- 首批 20 个微调模型上线
- A/B 提升显著（风格一致性 +15%）

## Phase 3（13-24 周）交易上线
- 目标：模型分发、交易、结算可运行
- 交付：
  - 发布审核流程
  - 支付/订单/分账
  - 侵权申诉流程

验收：
- 首笔交易完成
- 交易纠纷可在 SLA 内处理

---

## 10. 最细执行清单（本周启动）

### Day 1-2
- [ ] 建 repo 与目录
- [ ] 定义 OpenAPI 首版
- [ ] 设计 token 冻结

### Day 3-4
- [ ] 搭建 Auth + Team + Project
- [ ] 搭建 Console 骨架（三栏）
- [ ] 接入基础生成接口

### Day 5-7
- [ ] Persona CRUD
- [ ] Memory 导入与检索
- [ ] Run History 页面

### Day 8-10
- [ ] 评分面板（风格/事实/风险）
- [ ] 配额与计费基础
- [ ] 监控告警初版

### Day 11-14
- [ ] E2E 回归
- [ ] 内测账号发放
- [ ] 收集首轮反馈并排期 v0.2

---

## 11. 关键风险门槛（必须每天盯）

- 成本阈值：单任务成本 > 预算上限立即告警
- 风险阈值：违规率上升超过 0.5pp 触发策略收紧
- 稳定性阈值：生成成功率 < 98% 触发发布冻结
- 交易阈值：纠纷率 > 3% 触发人工复核加强

---

## 12. 产出物目录（建议你明早检查）

- 产品：PRD + 原型规范 + 用户旅程
- 技术：架构图 + API 契约 + 数据模型
- 工程：Monorepo + CI/CD + 测试计划
- 运营：定价 + 增长计划 + 结算策略
- 风控：审核策略 + 审计与申诉流程

> 结论：以上蓝图已覆盖“从战略到任务级执行”的全栈细化，可直接用于组建项目战时执行。
