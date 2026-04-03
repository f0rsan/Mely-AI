# RC Release Checklist (M3) - Mely AI

Updated: 2026-03-20 11:56 (Asia/Shanghai)

## 1) 版本信息
- Candidate: `v0.1-rc.1`
- 范围：Auth / Project / Session / Export / Tune / Project-scope RBAC
- 参考提交：`c5bbe13`

## 2) 发布门禁
- [x] M1 验收通过（100%）
- [x] M2 验收通过（100%）
- [x] M3 RBAC 代码与边界脚本就绪
- [x] RC 回归全绿（smoke + RBAC）
- [x] Go/No-Go 评审签字（Go）

## 3) 已知问题
- 无 P0 阻塞问题。

## 4) 回滚触发条件
- RC 回归存在 P0 失败
- 演示主链路任一关键步骤不可执行
- 网关健康检查持续异常（>= 15 分钟）

## 5) 回滚步骤
1. 暂停 RC 发布评审，标记 `No-Go`
2. 回退到最近稳定提交（建议：`56fde80`）
3. 重启服务并校验 `/health`
4. 复跑：`09-PM/smoke-phase-b.sh` + `08-QA/qa-rbac-m3.sh`

## 6) 回滚后验证
- `/health` 返回 200
- Auth / Project / Session / Export / Tune 主链路可执行
- 权限边界（viewer 403）维持正确

## 7) 当前结论
- **Go（可作为今日可交付演示版）**
- 说明：联调服务已恢复（health=200），smoke 与 RBAC 回归复跑全绿。
