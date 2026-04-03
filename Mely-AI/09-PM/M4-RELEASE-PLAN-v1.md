# M4 Release Plan v1（Mely AI）

Updated: 2026-03-23 11:28 (Asia/Shanghai)

## 1) 目标
在 M1~M3 已完成的基础上，完成对外可用的发布与演示打包：
- 发布说明可直接外发
- 演示脚本可一遍走通
- 回滚预案可执行且已验证

## 2) 范围（P0）
1. 发布说明（Release Notes）定稿
2. 演示脚本 v2（含开场、主链路、异常兜底话术）
3. 回滚预案复核（触发条件、步骤、验证）
4. 发布门禁证据归档（CI 3连、smoke、RBAC）

## 3) 输入材料
- `09-PM/M3-ACCEPTANCE-CHECKLIST.md`
- `09-PM/RC-RELEASE-CHECKLIST-M3.md`
- `08-QA/QA-REPORT-M3-RC-REGRESSION.md`
- `09-PM/M3-DEMO-SCRIPT-v1.md`

## 4) 交付物
- `09-PM/M4-ACCEPTANCE-CHECKLIST.md`
- `09-PM/M4-DEMO-SCRIPT-v2.md`
- `09-PM/RELEASE-NOTES-v0.1-rc.1.md`

## 5) 风险与应对
- 风险：演示环境网络波动
  - 应对：准备本地 fallback 环境与备用讲解路径
- 风险：临场数据不稳定
  - 应对：准备固定演示账号与预置数据

## 6) 完成定义（DoD）
- 演示脚本按时序可执行（主链路 + 异常兜底）
- 发布说明可直接粘贴至 PR/公告
- 回滚步骤在文档中可执行并有验证项
- M4 验收清单达成 100%
