import Fastify from "fastify";
import { models, projects, sessions } from "./data.js";
import type { SessionInfo } from "./types.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    return { status: "ok", service: "melt-ai-backend", timestamp: new Date().toISOString() };
  });

  app.get("/auth/me", async () => {
    return {
      id: "user_mock_001",
      name: "Melt Demo User",
      email: "demo@melt.ai",
      role: "owner",
    };
  });

  app.get("/projects", async () => {
    return { items: projects, total: projects.length };
  });

  app.get("/models", async () => {
    return { items: models, total: models.length };
  });

  app.get("/sessions", async () => {
    return { items: sessions, total: sessions.length };
  });

  app.post<{ Body: { projectId: string; title?: string } }>("/sessions", async (request, reply) => {
    const { projectId, title } = request.body ?? {};

    if (!projectId) {
      reply.code(400);
      return { error: "projectId is required" };
    }

    const newSession: SessionInfo = {
      id: `sess_${String(sessions.length + 1).padStart(3, "0")}`,
      projectId,
      title: title?.trim() || "Untitled Session",
      status: "active",
      createdAt: new Date().toISOString(),
    };

    sessions.unshift(newSession);
    reply.code(201);
    return newSession;
  });

  return app;
}
