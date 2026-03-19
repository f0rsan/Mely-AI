import Fastify from "fastify";
import {
  createSession,
  createSessionExport,
  createTuneTask,
  getSessionById,
  getTuneTask,
  getTuneTaskLogs,
  listModels,
  listProjects,
  listSessionExports,
  listSessions,
  listTuneTasks,
  modelExists,
  projectExists,
  sessionExists,
} from "./db.js";

type DemoUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "owner" | "member" | "viewer";
  token: string;
  projectIds: string[];
};

const DEMO_USERS: DemoUser[] = [
  {
    id: "user_owner_001",
    name: "Mely Owner",
    email: "demo@mely.ai",
    password: "123456",
    role: "owner",
    token: "token_demo_mely",
    projectIds: ["proj_001", "proj_002"],
  },
  {
    id: "user_viewer_001",
    name: "Mely Viewer",
    email: "viewer@mely.ai",
    password: "123456",
    role: "viewer",
    token: "token_viewer_mely",
    projectIds: ["proj_002"],
  },
];

function fail(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } };
}

function getAuthedUser(authHeader?: string): DemoUser | undefined {
  if (!authHeader) return undefined;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return DEMO_USERS.find((u) => u.token === token);
}

function hasProjectAccess(user: DemoUser, projectId: string) {
  return user.projectIds.includes(projectId);
}

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return { status: "ok", service: "mely-ai-backend", timestamp: new Date().toISOString() };
  });

  app.post<{ Body: { email?: string; password?: string } }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      reply.code(400);
      return fail("BAD_REQUEST", "email and password are required");
    }

    const user = DEMO_USERS.find((u) => u.email === email && u.password === password);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid email or password");
    }

    return {
      token: user.token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        projectIds: user.projectIds,
      },
    };
  });

  app.get("/auth/me", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      projectIds: user.projectIds,
    };
  });

  app.get("/projects", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const items = listProjects().filter((p) => hasProjectAccess(user, p.id));
    return { items, total: items.length };
  });

  app.get("/models", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const items = listModels();
    return { items, total: items.length };
  });

  app.get<{ Querystring: { projectId?: string } }>("/sessions", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { projectId } = request.query;
    if (projectId && !projectExists(projectId)) {
      reply.code(404);
      return fail("NOT_FOUND", `project ${projectId} not found`);
    }
    if (projectId && !hasProjectAccess(user, projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to project ${projectId}`);
    }

    const items = (projectId ? listSessions(projectId) : listSessions()).filter((s) => hasProjectAccess(user, s.projectId));
    return { items, total: items.length };
  });

  app.post<{ Body: { projectId: string; title?: string } }>("/sessions", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { projectId, title } = request.body ?? {};

    if (!projectId) {
      reply.code(400);
      return fail("BAD_REQUEST", "projectId is required");
    }

    if (!projectExists(projectId)) {
      reply.code(404);
      return fail("NOT_FOUND", `project ${projectId} not found`);
    }

    if (!hasProjectAccess(user, projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to project ${projectId}`);
    }

    const newSession = createSession({ projectId, title });
    reply.code(201);
    return newSession;
  });

  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/exports", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { sessionId } = request.params;
    const session = getSessionById(sessionId);
    if (!session || !sessionExists(sessionId)) {
      reply.code(404);
      return fail("NOT_FOUND", `session ${sessionId} not found`);
    }
    if (!hasProjectAccess(user, session.projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to session ${sessionId}`);
    }
    const items = listSessionExports(sessionId);
    return { items, total: items.length };
  });

  app.post<{ Params: { sessionId: string }; Body: { format?: "jsonl" | "csv" | "txt" } }>(
    "/sessions/:sessionId/exports",
    async (request, reply) => {
      const user = getAuthedUser(request.headers.authorization);
      if (!user) {
        reply.code(401);
        return fail("UNAUTHORIZED", "invalid or missing bearer token");
      }
      const { sessionId } = request.params;
      const format = request.body?.format ?? "jsonl";
      const session = getSessionById(sessionId);
      if (!session || !sessionExists(sessionId)) {
        reply.code(404);
        return fail("NOT_FOUND", `session ${sessionId} not found`);
      }
      if (!hasProjectAccess(user, session.projectId)) {
        reply.code(403);
        return fail("FORBIDDEN", `no access to session ${sessionId}`);
      }
      if (!["jsonl", "csv", "txt"].includes(format)) {
        reply.code(400);
        return fail("BAD_REQUEST", "format must be one of: jsonl, csv, txt");
      }
      const item = createSessionExport({ sessionId, format });
      reply.code(201);
      return item;
    }
  );

  app.get<{ Querystring: { projectId?: string } }>("/tune/tasks", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { projectId } = request.query;
    if (projectId && !projectExists(projectId)) {
      reply.code(404);
      return fail("NOT_FOUND", `project ${projectId} not found`);
    }
    if (projectId && !hasProjectAccess(user, projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to project ${projectId}`);
    }
    const items = listTuneTasks(projectId).filter((t) => hasProjectAccess(user, t.projectId));
    return { items, total: items.length };
  });

  app.post<{ Body: { projectId?: string; modelId?: string; name?: string } }>("/tune/tasks", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { projectId, modelId, name } = request.body ?? {};
    if (!projectId || !modelId) {
      reply.code(400);
      return fail("BAD_REQUEST", "projectId and modelId are required");
    }
    if (!projectExists(projectId)) {
      reply.code(404);
      return fail("NOT_FOUND", `project ${projectId} not found`);
    }
    if (!hasProjectAccess(user, projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to project ${projectId}`);
    }
    if (!modelExists(modelId)) {
      reply.code(404);
      return fail("NOT_FOUND", `model ${modelId} not found`);
    }
    const item = createTuneTask({ projectId, modelId, name });
    reply.code(201);
    return item;
  });

  app.get<{ Params: { taskId: string } }>("/tune/tasks/:taskId", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const item = getTuneTask(request.params.taskId);
    if (!item) {
      reply.code(404);
      return fail("NOT_FOUND", `task ${request.params.taskId} not found`);
    }
    if (!hasProjectAccess(user, item.projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to task ${request.params.taskId}`);
    }
    return item;
  });

  app.get<{ Params: { taskId: string } }>("/tune/tasks/:taskId/logs", async (request, reply) => {
    const user = getAuthedUser(request.headers.authorization);
    if (!user) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const task = getTuneTask(request.params.taskId);
    if (!task) {
      reply.code(404);
      return fail("NOT_FOUND", `task ${request.params.taskId} not found`);
    }
    if (!hasProjectAccess(user, task.projectId)) {
      reply.code(403);
      return fail("FORBIDDEN", `no access to task ${request.params.taskId}`);
    }
    const items = getTuneTaskLogs(request.params.taskId) ?? [];
    return { items, total: items.length };
  });

  return app;
}
