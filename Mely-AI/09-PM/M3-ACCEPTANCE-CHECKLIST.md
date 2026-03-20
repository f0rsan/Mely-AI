# M3 Acceptance Checklist (Mely AI)

> Milestone: 发布候选（RC）与演示包（M3）
> Updated: 2026-03-20 11:58 (Asia/Shanghai)

## A. 权限与边界（RBAC）
- [x] 项目级权限边界已在后端实现（project-scope）
- [x] Viewer 越权访问被拦截（403）逻辑已落地
- [x] QA 脚本已提供：`08-QA/qa-rbac-m3.sh`

## B. P0 回归门禁
- [x] P0 冒烟回归全绿（`09-PM/smoke-phase-b.sh`）
- [x] RBAC 边界回归全绿（`08-QA/qa-rbac-m3.sh`）
- [x] 联调环境可用性稳定（健康检查通过）

## C. 发布与演示材料
- [x] 演示脚本 v1 已落盘（`09-PM/M3-DEMO-SCRIPT-v1.md`）
- [x] 发布清单 + 回滚方案已落盘（`09-PM/RC-RELEASE-CHECKLIST-M3.md`）
- [x] 回归执行报告已落盘（`08-QA/QA-REPORT-M3-RC-REGRESSION.md`）

## D. Go/No-Go
- [x] Go（可发布）
- [ ] No-Go（当前）

## 当前通过率
- 已完成：13
- 待完成：0
- **M3 完成度：100%**
