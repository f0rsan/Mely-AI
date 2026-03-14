import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ModelInfo, Project, SessionExportInfo, SessionInfo } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "mely-ai.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  capabilities TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_export (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('jsonl','csv','txt')),
  file_uri TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES chat_session(id)
);
`);

function seedIfEmpty() {
  const now = new Date().toISOString();
  const projectCount = Number((db.prepare("SELECT COUNT(*) as c FROM project").get() as { c?: number } | undefined)?.c ?? 0);
  const modelCount = Number((db.prepare("SELECT COUNT(*) as c FROM model").get() as { c?: number } | undefined)?.c ?? 0);
  const sessionCount = Number((db.prepare("SELECT COUNT(*) as c FROM chat_session").get() as { c?: number } | undefined)?.c ?? 0);

  if (projectCount === 0) {
    const stmt = db.prepare(
      "INSERT INTO project (id, name, description, updated_at) VALUES (?, ?, ?, ?)"
    );
    stmt.run("proj_001", "Mely AI Core", "Core orchestration and model routing", now);
    stmt.run("proj_002", "Mely AI Playground", "Prompt and workflow experimentation", now);
  }

  if (modelCount === 0) {
    const stmt = db.prepare(
      "INSERT INTO model (id, provider, name, capabilities) VALUES (?, ?, ?, ?)"
    );
    stmt.run("gpt-4.1-mini", "openai", "GPT-4.1 mini", JSON.stringify(["chat", "reasoning"]));
    stmt.run("claude-3-5-sonnet", "anthropic", "Claude 3.5 Sonnet", JSON.stringify(["chat", "analysis"]));
    stmt.run("gemini-2.0-flash", "google", "Gemini 2.0 Flash", JSON.stringify(["chat", "multimodal"]));
  }

  if (sessionCount === 0) {
    db.prepare(
      "INSERT INTO chat_session (id, project_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("sess_001", "proj_001", "Initial architecture discussion", "active", now);
  }
}

seedIfEmpty();

export function listProjects(): Project[] {
  const rows = db
    .prepare("SELECT id, name, description, updated_at FROM project ORDER BY updated_at DESC")
    .all() as Array<{ id: string; name: string; description: string | null; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    updatedAt: row.updated_at,
  }));
}

export function listModels(): ModelInfo[] {
  const rows = db
    .prepare("SELECT id, provider, name, capabilities FROM model ORDER BY name ASC")
    .all() as Array<{ id: string; provider: string; name: string; capabilities: string }>;

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    capabilities: JSON.parse(row.capabilities) as string[],
  }));
}

export function listSessions(projectId?: string): SessionInfo[] {
  const rows = (projectId
    ? db
        .prepare(
          "SELECT id, project_id, title, status, created_at FROM chat_session WHERE project_id = ? ORDER BY created_at DESC"
        )
        .all(projectId)
    : db
        .prepare("SELECT id, project_id, title, status, created_at FROM chat_session ORDER BY created_at DESC")
        .all()) as Array<{ id: string; project_id: string; title: string; status: "active" | "archived"; created_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function projectExists(projectId: string): boolean {
  const row = db.prepare("SELECT 1 as ok FROM project WHERE id = ? LIMIT 1").get(projectId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function sessionExists(sessionId: string): boolean {
  const row = db.prepare("SELECT 1 as ok FROM chat_session WHERE id = ? LIMIT 1").get(sessionId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function createSession(input: { projectId: string; title?: string }): SessionInfo {
  const createdAt = new Date().toISOString();
  const row = db
    .prepare("SELECT COUNT(*) as c FROM chat_session")
    .get() as { c: number | bigint };
  const next = Number(row.c) + 1;

  const session: SessionInfo = {
    id: `sess_${String(next).padStart(3, "0")}`,
    projectId: input.projectId,
    title: input.title?.trim() || "Untitled Session",
    status: "active",
    createdAt,
  };

  db.prepare(
    "INSERT INTO chat_session (id, project_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(session.id, session.projectId, session.title, session.status, session.createdAt);

  return session;
}

export function listSessionExports(sessionId: string): SessionExportInfo[] {
  const rows = db
    .prepare(
      "SELECT id, session_id, format, file_uri, sample_count, created_at FROM session_export WHERE session_id = ? ORDER BY created_at DESC"
    )
    .all(sessionId) as Array<{
    id: string;
    session_id: string;
    format: "jsonl" | "csv" | "txt";
    file_uri: string;
    sample_count: number;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    format: row.format,
    fileUri: row.file_uri,
    sampleCount: row.sample_count,
    createdAt: row.created_at,
  }));
}

export function createSessionExport(input: { sessionId: string; format: "jsonl" | "csv" | "txt" }): SessionExportInfo {
  const createdAt = new Date().toISOString();
  const row = db.prepare("SELECT COUNT(*) as c FROM session_export").get() as { c: number | bigint };
  const next = Number(row.c) + 1;
  const id = `exp_${String(next).padStart(3, "0")}`;
  const fileUri = `/exports/${input.sessionId}/${id}.${input.format}`;
  const sampleCount = 10;

  db.prepare(
    "INSERT INTO session_export (id, session_id, format, file_uri, sample_count, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, input.sessionId, input.format, fileUri, sampleCount, createdAt);

  return {
    id,
    sessionId: input.sessionId,
    format: input.format,
    fileUri,
    sampleCount,
    createdAt,
  };
}
