# Step 3 联调报告：Auth → Project → Session → Export → Tune

日期：2026-03-20  
目标地址：`http://127.0.0.1:3000`

## 执行方式
- 采用脚本：`bash Mely-AI/09-PM/smoke-phase-b.sh`
- 覆盖链路：
  1. `/health`
  2. `/auth/login`
  3. `/projects`
  4. `POST /sessions`
  5. `GET /sessions?projectId=...`
  6. `POST /sessions/:id/exports`
  7. `GET /sessions/:id/exports`
  8. `POST /tune/tasks`
  9. `GET /tune/tasks/:id` + `GET /tune/tasks?projectId=...`
  10. `GET /tune/tasks/:id/logs`
  11. 异常路径：未授权 401、不存在资源 404

## 结果
- 主链路：通过（输出 `SMOKE_OK`）
- 鉴权边界：通过（401/404 行为正确）
- 回归结论：通过

## 本步修复关联
- 前端新增会话恢复（`/auth/me`）与 BASE_URL 兜底策略，避免环境切换导致链路失败。
