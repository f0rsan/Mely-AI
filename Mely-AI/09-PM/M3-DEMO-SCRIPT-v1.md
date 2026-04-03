# M3 Demo Script v1 (Mely AI)

Updated: 2026-03-20 11:55 (Asia/Shanghai)

## 流程 1：登录与项目/会话主链路
### 前置条件
- 后端服务可用（`/health`=200）
- 测试账号可登录（demo/viewer）

### 演示步骤
1. 登录（`POST /auth/login`）
2. 打开项目列表（`GET /projects`）
3. 进入 `proj_001` 查看会话（`GET /sessions?projectId=proj_001`）
4. 创建新会话（`POST /sessions`）

### 预期结果
- 登录成功返回 token
- 项目和会话可正常读取
- 新会话创建成功并可见

### 失败兜底话术
- 「当前环境网关异常（502），逻辑已完成，待网关恢复后可立即复跑验证。」

---

## 流程 2：Session 导出
### 演示步骤
1. 创建导出（`POST /sessions/{id}/exports`）
2. 查询导出列表（`GET /sessions/{id}/exports`）
3. 展示导出产物（jsonl/csv/txt）

### 预期结果
- 导出任务创建成功
- 产物列表可查、可下载
- 权限边界生效

### 失败兜底话术
- 「导出接口已在 M2 验收通过，当前仅受联调环境 502 影响，恢复后即刻可演示。」

---

## 流程 3：Tune 创建 / 状态 / 日志
### 演示步骤
1. 创建 Tune 任务（`POST /tune/tasks`）
2. 查询任务状态（`GET /tune/tasks/{id}`）
3. 查询日志（`GET /tune/tasks/{id}/logs`）
4. RBAC 边界验证（viewer 对 `proj_001` 403）

### 预期结果
- Tune 主链路完整跑通
- Viewer 越权访问返回 403

### 失败兜底话术
- 「M3 已补齐 RBAC 代码与 QA 脚本；当前阻塞点是环境 502，不是功能缺失。」
