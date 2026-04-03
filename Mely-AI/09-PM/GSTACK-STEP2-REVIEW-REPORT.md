# Mely AI · gstack Step 2 Review（P0/P1/P2）

日期：2026-03-20
范围：`03-Frontend/app`、`04-Backend/service`

## P0（必须立即修复）

### P0-1 前端 API 基地址在非 5173 场景不稳（已修复）
- 文件：`03-Frontend/app/src/api/httpApi.js:1-5`
- 问题：此前默认硬编码 `:3000`，在代理/同源部署时容易导致错误目标地址。
- 影响：登录和全链路调用可能直接失败（环境相关，高影响）。
- 处理：改为「dev(5173)→3000；其他场景走 `window.location.origin`」。

### P0-2 token 恢复后未主动拉取 /auth/me（已修复）
- 文件：`03-Frontend/app/src/App.jsx:62-77`、`03-Frontend/app/src/api/httpApi.js:38-40`
- 问题：刷新页面后若 localStorage 仍有 token，`user` 可能为 null，且无统一校验流程。
- 影响：用户信息不一致；失效 token 反馈不清晰。
- 处理：boot 阶段并发请求 `authApi.me()+projects`，401 时自动 logout 并清理状态。

## P1（应尽快修复）

### P1-1 Session 判空逻辑有重复检查（未改，建议后续整理）
- 文件：`04-Backend/service/src/app.ts:195-198`、`218-221`
- 问题：`getSessionById` 后再次调用 `sessionExists`，语义重复。
- 影响：可读性下降、维护成本增加（功能不受损）。
- 建议：统一为一次查询判空，减少分支噪音。

## P2（可排期优化）

### P2-1 modelsApi.listByProject 签名与实现不一致（未改）
- 文件：`03-Frontend/app/src/App.jsx:83`、`03-Frontend/app/src/api/httpApi.js:57-65`
- 问题：调用端传 projectId，但实现未使用该参数（目前后端 /models 也未按项目过滤）。
- 影响：可读性与意图一致性一般，后续扩展时容易误解。
- 建议：要么删参数，要么后端支持按项目过滤并透传。

---

## 本步自动修复清单
1. `httpApi.js`：BASE_URL fallback 策略修正。
2. `httpApi.js`：新增 `authApi.me()`。
3. `App.jsx`：boot 增加会话恢复与失效 token 处理。
