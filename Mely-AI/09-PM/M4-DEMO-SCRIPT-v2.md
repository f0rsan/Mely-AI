# M4 Demo Script v2 (Mely AI)

Updated: 2026-03-23 13:49 (Asia/Shanghai)
Audience: 外部评审 / 潜在合作方 / 内部发布会
Duration target: 8-10 分钟

## 0) 开场（30s）
- 「Mely AI 是面向创作者的模型资产平台：能创作、能进化、可治理、可交易。」
- 「今天演示的是 v0.1-rc.1，主链路与权限边界已完成并通过 CI 稳定性验证。」

## 1) 环境确认（30s）
1. `GET /health` 返回 200
2. 打开 CI 证据链接（3 连 PASS）：
   - https://github.com/f0rsan/Mely-AI/actions/runs/23419798046
   - https://github.com/f0rsan/Mely-AI/actions/runs/23419800614
   - https://github.com/f0rsan/Mely-AI/actions/runs/23419801413

话术：
- 「先看稳定性证据：CI 连续 3 次通过，意味着当前演示不是一次性成功。」

## 2) 主链路 A：登录 → 项目 → 会话（2 分钟）
1. 登录：`POST /auth/login`
2. 拉取项目：`GET /projects`
3. 拉取会话：`GET /sessions?projectId=proj_001`
4. 创建会话：`POST /sessions`

预期：
- 登录拿到 token
- 项目和会话可读
- 新会话创建成功

## 3) 主链路 B：导出（2 分钟）
1. 创建导出：`POST /sessions/{id}/exports`
2. 查询导出：`GET /sessions/{id}/exports`
3. 展示产物：jsonl/csv/txt

预期：
- 导出可创建、可列出、可获取产物

## 4) 主链路 C：Tune + RBAC（3 分钟）
1. 创建 tune：`POST /tune/tasks`
2. 查询状态：`GET /tune/tasks/{id}`
3. 查询日志：`GET /tune/tasks/{id}/logs`
4. viewer 越权验证：访问 `proj_001` 返回 403

预期：
- tune 生命周期完整
- RBAC 边界有效（越权被阻断）

## 5) 失败兜底与切换话术（1 分钟）
- 若健康检查失败：
  - 「当前演示环境异常，我切换到本地回归证据与 CI 运行记录继续说明，功能已验收通过。」
- 若网关抖动：
  - 「这是环境层问题，不是功能缺失；我们已有 smoke + RBAC + CI 3 连证据。」
- 若单接口超时：
  - 「先继续后续链路，结束后回放该接口日志。」

## 6) 收尾（30s）
- 「v0.1-rc.1 已达到发布候选质量，当前进入 M4 发布与演示打包阶段。」
- 「下一步将补齐外发材料与演示彩排记录，进入正式发布窗口。」
