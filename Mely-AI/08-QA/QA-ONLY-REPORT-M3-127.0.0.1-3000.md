# Step 4 QA-Only 报告（只读，不改代码）

日期：2026-03-20  
目标：`http://127.0.0.1:3000`

## 范围
- API 服务可用性
- Auth/RBAC
- 主链路抽检

## 执行
- `bash Mely-AI/09-PM/smoke-phase-b.sh`
- `bash Mely-AI/08-QA/qa-rbac-m3.sh`

## 结果摘要
- `smoke-phase-b.sh`：**PASS**（`SMOKE_OK`）
- `qa-rbac-m3.sh`：**PASS**（`QA_RBAC_M3_OK`）

## 观察到的问题（只记录，不改）
1. 历史数据累积较多（sessions/exports/tune tasks），会让回归输出变长，不影响正确性。
2. `fileUri` 字段存在历史新旧格式并存（绝对路径 + `/exports/...` 相对路径），兼容性目前可接受，建议后续统一规范。

## 发版建议
- 可发版（API 侧主链路与 RBAC 通过）。
- 建议在发布前补一次数据清理脚本（可选）。
