# QA Report - M3 RC Regression (Mely AI)

Updated: 2026-03-20 11:56 (Asia/Shanghai)

## 执行范围
- `09-PM/smoke-phase-b.sh`
- `08-QA/qa-rbac-m3.sh`

## 执行结果
- smoke-phase-b: **FAIL**
- qa-rbac-m3: **FAIL**

## 失败摘要
1. smoke-phase-b
   - 失败步骤：`[1/11] health`
   - 错误：`curl: (22) The requested URL returned error: 502`
   - 日志：`/tmp/mely-smoke-phase-b-20260320.log`

2. qa-rbac-m3
   - 失败步骤：`[1/4] login as viewer`
   - 错误：`curl: (22) The requested URL returned error: 502`
   - 日志：`/tmp/mely-qa-rbac-m3-20260320.log`

## 初步判断
- 阻塞来自联调环境/网关不可用（502）
- 不是接口契约或权限逻辑本身的直接失败证据

## 建议动作
1. 恢复服务可用性（health=200）
2. 立即复跑 smoke + RBAC
3. 若复跑全绿，再切换 M3 为 Go

## 当前结论
- **M3 RC 回归门禁未通过（No-Go）**
