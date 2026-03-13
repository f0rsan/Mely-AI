# Mely AI 技术架构图与时序（Mermaid）v1

- 版本：v1.0
- 日期：2026-03-13
- 用途：技术评审、研发对齐、实现指导

---

## 1) 系统组件图（C4-Container 简化）

```mermaid
flowchart TB
  U[Creator/User] --> W[Web Console\nNext.js]
  W --> G[API Gateway/BFF\nNestJS]

  G --> A[Auth & Tenant Service]
  G --> P[Persona Service]
  G --> M[Memory Service]
  G --> O[Generation Orchestrator]
  G --> F[Fine-tune Service]
  G --> H[Hub/Marketplace Service]
  G --> B[Billing Service]
  G --> S[Trust & Safety Service]

  A --> PG[(Postgres)]
  P --> PG
  M --> PG
  H --> PG
  B --> PG
  S --> PG

  M --> V[(Vector DB\npgvector)]
  O --> R[(Redis/BullMQ)]
  F --> R

  O --> L1[Model Router]
  L1 --> X1[3rd-party Model APIs]
  L1 --> X2[vLLM Self-hosted]

  F --> T[Training Workers\nLoRA]
  T --> OBJ[(Object Storage S3)]
  T --> PG

  O --> OBJ
  H --> OBJ
  S --> AUD[(Audit Log Store)]
```

---

## 2) 运行时请求链路（生成任务）

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant W as Web Console
  participant G as API Gateway
  participant S as Safety Service
  participant M as Memory Service
  participant O as Orchestrator
  participant R as Model Router
  participant L as LLM Provider
  participant DB as Postgres

  U->>W: 输入任务+上下文
  W->>G: POST /generation/run
  G->>S: pre-check(request)
  S-->>G: allow + risk tags
  G->>M: memory search(user,query)
  M-->>G: memory snippets
  G->>O: assemble prompt(persona+memory+task)
  O->>R: route(task_type,budget,latency)
  R->>L: inference request
  L-->>R: candidates
  R-->>O: outputs + token usage
  O->>S: post-check(outputs)
  S-->>O: quality/risk score
  O->>DB: persist task/result/metrics
  O-->>G: response payload
  G-->>W: content + score + citations
  W-->>U: 展示结果与评分
```

---

## 3) 微调任务时序（LoRA）

```mermaid
sequenceDiagram
  autonumber
  participant U as Creator
  participant W as Console
  participant G as API
  participant F as Fine-tune Service
  participant Q as Queue(BullMQ)
  participant T as Trainer Worker
  participant O as Object Storage
  participant E as Evaluator
  participant DB as Postgres

  U->>W: 上传数据集+参数
  W->>G: POST /finetune/jobs
  G->>F: create job
  F->>DB: save job(PENDING)
  F->>Q: enqueue(job_id)
  F-->>W: job accepted

  Q->>T: consume job
  T->>O: read dataset
  T->>T: train LoRA adapters
  T->>O: upload artifacts
  T->>E: run evaluation suite
  E-->>T: scores(style/factuality/safety)
  T->>DB: update job(SUCCEEDED/FAILED)
  T->>DB: write model version + metrics

  U->>W: 查看任务状态
  W->>G: GET /finetune/jobs/:id
  G->>DB: query
  DB-->>G: status + metrics
  G-->>W: render status
```

---

## 4) 发布与交易流程（模型包）

```mermaid
flowchart LR
  A[Creator Publish Package] --> B[Auto Policy Scan]
  B -->|Pass| C[Human Spot Check]
  B -->|Fail| X[Reject + Feedback]
  C -->|Pass| D[List in Hub]
  C -->|Fail| X
  D --> E[Buyer Purchase]
  E --> F[Payment Confirmed]
  F --> G[License Issued]
  G --> H[Revenue Split]
  H --> I[Payout Ledger]
```

---

## 5) 关键数据流与存储边界

```mermaid
flowchart TB
  subgraph Client
    C1[Prompt/Input]
    C2[Generated Output]
  end

  subgraph Services
    S1[Gateway]
    S2[Orchestrator]
    S3[Safety]
    S4[Memory]
  end

  subgraph Storage
    D1[(Postgres)]
    D2[(Vector DB)]
    D3[(Object Storage)]
    D4[(Audit Logs)]
  end

  C1 --> S1 --> S2
  S2 --> S3
  S2 --> S4
  S4 --> D2
  S2 --> D1
  S2 --> D3
  S3 --> D4
  S2 --> C2
```

---

## 6) 服务 SLO 与告警阈值

- Gateway：可用性 99.9%，P95 < 250ms（不含模型推理）
- Generation API：P95 < 2.5s（轻任务），错误率 < 1%
- Fine-tune Queue：排队等待 P95 < 5min
- Payment Callback 成功率 > 99.95%
- 审核漏检率（月）< 0.5%

---

## 7) 落地建议（从图到代码）

1. 先锁定 OpenAPI（Auth/Persona/Generation/Finetune）
2. Orchestrator 先跑“单模型路由”，再扩展多模型策略
3. Safety 先做规则引擎 + 黑白名单，后续迭代分类器
4. Fine-tune 先支持单一 LoRA 模板，避免训练矩阵爆炸
5. Hub 先邀请制上架，降低审核与纠纷压力
