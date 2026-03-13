# Mely AI Frontend Skeleton (Mock API)

该目录提供一个可运行的前端工程骨架，优先打通数据流：

- auth（登录/登出）
- projects（列表/创建）
- models（按项目查询）
- sessions（列表/创建/发消息）

> 使用本地 `localStorage` 作为 mock 数据库，无需后端即可联调页面状态流转。

## 目录

```text
app/
  src/
    api/
      mockData.js
      mockApi.js
    App.jsx
    main.jsx
    styles.css
  index.html
  package.json
  vite.config.js
  start.sh
```

## 快速启动

```bash
cd Mely-AI/03-Frontend/app
./start.sh
```

或手动：

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5173`

## Demo 账号

- Email: `demo@mely.ai`
- Password: `123456`

## 说明

- UI 仅做基础骨架，不追求视觉还原。
- 核心是可跑通前端状态与 mock API 数据流。
- 所有 mock 数据保存在浏览器 `localStorage`（key: `mely-ai-mock-db`）。
