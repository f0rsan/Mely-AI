import Fastify from "fastify";
import {
  createSession,
  createSessionExport,
  listModels,
  listProjects,
  listSessionExports,
  listSessions,
  projectExists,
  sessionExists,
} from "./db.js";

const DEMO_TOKEN = "token_demo_mely";

function fail(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } };
}

function isAuthorized(authHeader?: string) {
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme?.toLowerCase() === "bearer" && token === DEMO_TOKEN;
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
    return {
      token: "token_demo_mely",
      user: {
        id: "user_mock_001",
        name: "Mely Demo User",
        email,
        role: "owner",
      },
    };
  });

  app.get("/auth/me", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    return {
      id: "user_mock_001",
      name: "Mely Demo User",
      email: "demo@mely.ai",
      role: "owner",
    };
  });

  app.get("/projects", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const items = listProjects();
    return { items, total: items.length };
  });

  app.get("/models", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const items = listModels();
    return { items, total: items.length };
  });

  app.get<{ Querystring: { projectId?: string } }>("/sessions", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { projectId } = request.query;
    if (projectId && !projectExists(projectId)) {
      reply.code(404);
      return fail("NOT_FOUND", `project ${projectId} not found`);
    }
    const items = listSessions(projectId);
    return { items, total: items.length };
  });

  app.post<{ Body: { projectId: string; title?: string } }>("/sessions", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
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

    const newSession = createSession({ projectId, title });
    reply.code(201);
    return newSession;
  });

  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId/exports", async (request, reply) => {
    if (!isAuthorized(request.headers.authorization)) {
      reply.code(401);
      return fail("UNAUTHORIZED", "invalid or missing bearer token");
    }
    const { sessionId } = request.params;
    if (!sessionExists(sessionId)) {
      reply.code(404);
      return fail("NOT_FOUND", `session ${sessionId} not found`);
    }
    const items = listSessionExports(sessionId);
    return { items, total: items.length };
  });

  app.post<{ Params: { sessionId: string }; Body: { format?: "jsonl" | "csv" | "txt" } }>(
    "/sessions/:sessionId/exports",
    async (request, reply) => {
      if (!isAuthorized(request.headers.authorization)) {
        reply.code(401);
        return fail("UNAUTHORIZED", "invalid or missing bearer token");
      }
      const { sessionId } = request.params;
      const format = request.body?.format ?? "jsonl";
      if (!sessionExists(sessionId)) {
        reply.code(404);
        return fail("NOT_FOUND", `session ${sessionId} not found`);
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

  return app;
}
