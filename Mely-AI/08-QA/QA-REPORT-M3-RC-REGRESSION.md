# QA Report - M3 RC Regression (Mely AI)

Updated: 2026-03-23 11:15 (Asia/Shanghai)

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

## CI 首轮稳定性证据（GitHub Actions 连续 3 次）
- Workflow：`M3 CI Gate`
- Run #1：PASS  
  - URL: https://github.com/f0rsan/Mely-AI/actions/runs/23419798046
  - SHA: `918ebd8`
- Run #2：PASS  
  - URL: https://github.com/f0rsan/Mely-AI/actions/runs/23419800614
  - SHA: `0b808e1`
- Run #3：PASS  
  - URL: https://github.com/f0rsan/Mely-AI/actions/runs/23419801413
  - SHA: `27e18e5`

结论：CI 首轮稳定性观察达标（3/3 全绿）。

## 本地回归补充（替代证据归档）
- Run #1（PORT=3311）：PASS
  - 日志：`/tmp/mely-m3-gate-port3311-20260323.log`
- Run #2（PORT=3312）：PASS
  - 日志：`/tmp/mely-m3-gate-port3312-20260323.log`
- Run #3（PORT=3313）：PASS
  - 日志：`/tmp/mely-m3-gate-port3313-20260323.log`

附：CI 首轮失败根因已定位并修复（工作流 Node 版本需支持 `node:sqlite`；门禁脚本补齐日志目录创建）。
## 备注
- 本轮复跑前曾遇到联调环境 502；当前已恢复，不再阻塞 RC 门禁。

## 当前结论
- **M3 RC 回归门禁通过（Go）**
- **稳定性状态：本地 3 连回归 PASS + CI 3 连 PASS（达标）。**
