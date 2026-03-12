# MiroFish MVP 任务拆解（Jira 导入草案）

## Epic A：基础工程
- A1 初始化 monorepo（web/api/packages）
- A2 CI 流程（lint/test/build）
- A3 环境管理（dev/staging/prod）
- A4 监控与日志

## Epic B：账号与项目空间
- B1 登录/注册/会话
- B2 团队与角色权限
- B3 项目空间创建/切换

## Epic C：创作 Console
- C1 三栏布局（导航/工作区/评分面板）
- C2 Prompt 输入与版本管理
- C3 输出区与多候选比较
- C4 风格保持 UI 组件（玻璃卡片/渐变按钮）

## Epic D：Persona & Memory
- D1 Persona CRUD
- D2 Memory 数据导入
- D3 Memory 检索接口
- D4 记忆命中可视化

## Epic E：Generation
- E1 生成任务提交接口
- E2 模型路由策略 v1
- E3 结果评分（风格一致性/事实性）
- E4 失败重试与超时处理

## Epic F：计费与订阅
- F1 套餐定义（Basic/Pro）
- F2 额度与限流
- F3 订阅状态同步

## Epic G：质量与风控
- G1 安全策略引擎
- G2 内容审核 API
- G3 审计日志页面

## Epic H：测试与上线
- H1 核心链路 E2E
- H2 压测（生成接口）
- H3 灰度发布与回滚

---

## 优先级建议
- P0：A/B/C/D/E（MVP 关键）
- P1：F/G（可商用）
- P2：H（发布质量）
