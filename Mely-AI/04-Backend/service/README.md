# Mely AI Backend Service

Node.js + TypeScript + Fastify 的最小后端骨架。

## 已实现 API

- `GET /health` 健康检查
- `GET /auth/me` mock 当前用户信息
- `GET /projects` 项目列表
- `GET /models` 模型列表
- `GET /sessions` 会话列表
- `POST /sessions` 创建会话

## 环境要求

- Node.js >= 20
- npm >= 9

## 安装与运行

```bash
npm install
npm run dev
```

默认监听：`http://0.0.0.0:3000`

### 生产构建运行

```bash
npm run build
npm run start
```

## 示例请求

```bash
# health
curl http://127.0.0.1:3000/health

# mock user
curl http://127.0.0.1:3000/auth/me

# list projects
curl http://127.0.0.1:3000/projects

# list models
curl http://127.0.0.1:3000/models

# list sessions
curl http://127.0.0.1:3000/sessions

# create session
curl -X POST http://127.0.0.1:3000/sessions \
  -H 'content-type: application/json' \
  -d '{"projectId":"proj_001","title":"New Session"}'
```

## 项目结构

```text
service/
  src/
    app.ts        # Fastify app + routes
    server.ts     # entrypoint
    data.ts       # in-memory mock data
    types.ts      # shared types
  package.json
  tsconfig.json
  README.md
```

> 当前数据存储为内存 mock，重启服务后会重置。
