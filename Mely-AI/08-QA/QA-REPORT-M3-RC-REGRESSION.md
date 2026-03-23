# QA Report - M3 RC Regression (Mely AI)

Updated: 2026-03-23 10:20 (Asia/Shanghai)

## 执行范围
- `09-PM/smoke-phase-b.sh`
- `08-QA/qa-rbac-m3.sh`

## 最终执行结果（复跑）
- smoke-phase-b: **PASS**
- qa-rbac-m3: **PASS**

## 关键证据
1. health 检查
   - `GET /health` => 200
2. smoke 结果
   - 日志结尾：`SMOKE_OK`
   - 日志文件：`/tmp/mely-smoke-phase-b-20260320-rerun.log`
3. RBAC 结果
   - 日志结尾：`QA_RBAC_M3_OK`
   - 日志文件：`/tmp/mely-qa-rbac-m3-20260320-rerun.log`

## CI 首轮稳定性补充（本地替代证据）
> 说明：当前仓库尚未配置 Git 远端（`git remote -v` 为空），无法生成 GitHub Actions Run 链接；先补充同脚本本地连续 3 次门禁结果作为稳定性替代证据。

- Run #1（PORT=3311）：PASS
  - 日志：`/tmp/mely-m3-gate-port3311-20260323.log`
  - 结论：`SMOKE_OK` + `QA_RBAC_M3_OK` + `ALL_GREEN`
- Run #2（PORT=3312）：PASS
  - 日志：`/tmp/mely-m3-gate-port3312-20260323.log`
  - 结论：`SMOKE_OK` + `QA_RBAC_M3_OK` + `ALL_GREEN`
- Run #3（PORT=3313）：PASS
  - 日志：`/tmp/mely-m3-gate-port3313-20260323.log`
  - 结论：`SMOKE_OK` + `QA_RBAC_M3_OK` + `ALL_GREEN`

附：本次执行中在默认端口 `3301` 出现一次 `EADDRINUSE`（端口占用）导致单次失败，已通过隔离端口复跑验证非功能缺陷。

## 备注
- 本轮复跑前曾遇到联调环境 502；当前已恢复，不再阻塞 RC 门禁。
- 待仓库绑定 GitHub 远端并触发工作流后，将补充 CI run URL/截图，替换本地替代证据。

## 当前结论
- **M3 RC 回归门禁通过（Go）**
- **稳定性状态：本地 3 连回归 PASS，CI 3 连待远端绑定后补齐。**
