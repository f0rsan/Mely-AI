import Fastify from "fastify";
import { createSession, listModels, listProjects, listSessions, projectExists } from "./db.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return { status: "ok", service: "mely-ai-backend", timestamp: new Date().toISOString() };
  });

  app.get("/auth/me", async () => {
    return {
      id: "user_mock_001",
      name: "Mely Demo User",
      email: "demo@mely.ai",
      role: "owner",
    };
  });

  app.get("/projects", async () => {
    const items = listProjects();
    return { items, total: items.length };
  });

  app.get("/models", async () => {
    const items = listModels();
    return { items, total: items.length };
  });

  app.get("/sessions", async () => {
    const items = listSessions();
    return { items, total: items.length };
  });

  app.post<{ Body: { projectId: string; title?: string } }>("/sessions", async (request, reply) => {
    const { projectId, title } = request.body ?? {};

    if (!projectId) {
      reply.code(400);
      return { error: { code: "BAD_REQUEST", message: "projectId is required", details: {} } };
    }

    if (!projectExists(projectId)) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: `project ${projectId} not found`, details: {} } };
    }

    const newSession = createSession({ projectId, title });
    reply.code(201);
    return newSession;
  });

  return app;
}
