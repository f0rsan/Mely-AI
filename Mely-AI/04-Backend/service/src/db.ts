import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ModelInfo, Project, SessionExportInfo, SessionInfo, SessionMessageInfo, TuneTaskInfo } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const EXPORT_DIR = path.join(DATA_DIR, "exports");
const DB_PATH = path.join(DATA_DIR, "mely-ai.sqlite");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

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

CREATE TABLE IF NOT EXISTS session_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES chat_session(id)
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

CREATE TABLE IF NOT EXISTS tune_task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  logs TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES project(id),
  FOREIGN KEY(model_id) REFERENCES model(id)
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

  const messageCount = Number((db.prepare("SELECT COUNT(*) as c FROM session_message").get() as { c?: number } | undefined)?.c ?? 0);
  if (messageCount === 0) {
    db.prepare("INSERT INTO session_message (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "msg_001",
      "sess_001",
      "assistant",
      "Welcome to Mely AI. Start by creating a project-specific session objective.",
      now
    );
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


export function getSessionById(sessionId: string): SessionInfo | undefined {
  const row = db
    .prepare("SELECT id, project_id, title, status, created_at FROM chat_session WHERE id = ? LIMIT 1")
    .get(sessionId) as
    | { id: string; project_id: string; title: string; status: "active" | "archived"; created_at: string }
    | undefined;

  if (!row) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function projectExists(projectId: string): boolean {
  const row = db.prepare("SELECT 1 as ok FROM project WHERE id = ? LIMIT 1").get(projectId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function sessionExists(sessionId: string): boolean {
  const row = db.prepare("SELECT 1 as ok FROM chat_session WHERE id = ? LIMIT 1").get(sessionId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function modelExists(modelId: string): boolean {
  const row = db.prepare("SELECT 1 as ok FROM model WHERE id = ? LIMIT 1").get(modelId) as { ok: number } | undefined;
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

export function listSessionMessages(input: { sessionId: string; page?: number; pageSize?: number }): {
  items: SessionMessageInfo[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;

  const total = Number(
    (db.prepare("SELECT COUNT(*) as c FROM session_message WHERE session_id = ?").get(input.sessionId) as { c?: number } | undefined)?.c ?? 0
  );

  const rows = db
    .prepare(
      "SELECT id, session_id, role, content, created_at FROM session_message WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
    )
    .all(input.sessionId, pageSize, offset) as Array<{
    id: string;
    session_id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }>;

  return {
    items: rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    })),
    total,
    page,
    pageSize,
  };
}

export function createSessionMessage(input: { sessionId: string; role: "user" | "assistant" | "system"; content: string }): SessionMessageInfo {
  const createdAt = new Date().toISOString();
  const row = db.prepare("SELECT COUNT(*) as c FROM session_message").get() as { c: number | bigint };
  const next = Number(row.c) + 1;
  const item: SessionMessageInfo = {
    id: `msg_${String(next).padStart(3, "0")}`,
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    createdAt,
  };

  db.prepare("INSERT INTO session_message (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(
    item.id,
    item.sessionId,
    item.role,
    item.content,
    item.createdAt
  );

  return item;
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

  const session = db
    .prepare("SELECT id, project_id, title, status, created_at FROM chat_session WHERE id = ? LIMIT 1")
    .get(input.sessionId) as
    | { id: string; project_id: string; title: string; status: "active" | "archived"; created_at: string }
    | undefined;

  if (!session) {
    throw new Error(`session ${input.sessionId} not found`);
  }

  const sessionDir = path.join(EXPORT_DIR, input.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const filename = `${id}.${input.format}`;
  const absPath = path.join(sessionDir, filename);

  const payload = {
    id: session.id,
    projectId: session.project_id,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    exportedAt: createdAt,
  };

  if (input.format === "jsonl") {
    fs.writeFileSync(absPath, `${JSON.stringify(payload)}\n`, "utf8");
  } else if (input.format === "csv") {
    const header = "id,projectId,title,status,createdAt,exportedAt\n";
    const rowCsv = [
      payload.id,
      payload.projectId,
      payload.title,
      payload.status,
      payload.createdAt,
      payload.exportedAt,
    ]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`)
      .join(",");
    fs.writeFileSync(absPath, `${header}${rowCsv}\n`, "utf8");
  } else {
    fs.writeFileSync(
      absPath,
      `Session Export\nID: ${payload.id}\nProject: ${payload.projectId}\nTitle: ${payload.title}\nStatus: ${payload.status}\nCreatedAt: ${payload.createdAt}\nExportedAt: ${payload.exportedAt}\n`,
      "utf8"
    );
  }

  const fileUri = absPath;
  const sampleCount = 1;

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

function evolveTuneTask(row: {
  id: string;
  project_id: string;
  model_id: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  logs: string;
  created_at: string;
  updated_at: string;
}) {
  const now = new Date();
  const created = new Date(row.created_at).getTime();
  const ageMs = now.getTime() - created;

  let nextStatus = row.status;
  if (ageMs > 15_000) nextStatus = "succeeded";
  else if (ageMs > 4_000) nextStatus = "running";

  let logs = JSON.parse(row.logs || "[]") as string[];
  if (nextStatus !== row.status) {
    if (nextStatus === "running") logs = [...logs, "task running"];
    if (nextStatus === "succeeded") logs = [...logs, "task succeeded"];
    const nextUpdatedAt = now.toISOString();
    db.prepare("UPDATE tune_task SET status = ?, logs = ?, updated_at = ? WHERE id = ?").run(
      nextStatus,
      JSON.stringify(logs),
      nextUpdatedAt,
      row.id
    );
    return {
      ...row,
      status: nextStatus,
      logs: JSON.stringify(logs),
      updated_at: nextUpdatedAt,
    };
  }

  return row;
}

export function listTuneTasks(projectId?: string): TuneTaskInfo[] {
  const rows = (projectId
    ? db
        .prepare(
          "SELECT id, project_id, model_id, name, status, logs, created_at, updated_at FROM tune_task WHERE project_id = ? ORDER BY created_at DESC"
        )
        .all(projectId)
    : db
        .prepare("SELECT id, project_id, model_id, name, status, logs, created_at, updated_at FROM tune_task ORDER BY created_at DESC")
        .all()) as Array<{
    id: string;
    project_id: string;
    model_id: string;
    name: string;
    status: "queued" | "running" | "succeeded" | "failed";
    logs: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((raw) => {
    const row = evolveTuneTask(raw);
    return {
      id: row.id,
      projectId: row.project_id,
      modelId: row.model_id,
      name: row.name,
      status: row.status,
      logs: JSON.parse(row.logs || "[]") as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export function getTuneTask(taskId: string): TuneTaskInfo | undefined {
  const row = db
    .prepare("SELECT id, project_id, model_id, name, status, logs, created_at, updated_at FROM tune_task WHERE id = ? LIMIT 1")
    .get(taskId) as
    | {
        id: string;
        project_id: string;
        model_id: string;
        name: string;
        status: "queued" | "running" | "succeeded" | "failed";
        logs: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return undefined;
  const next = evolveTuneTask(row);
  return {
    id: next.id,
    projectId: next.project_id,
    modelId: next.model_id,
    name: next.name,
    status: next.status,
    logs: JSON.parse(next.logs || "[]") as string[],
    createdAt: next.created_at,
    updatedAt: next.updated_at,
  };
}

export function createTuneTask(input: { projectId: string; modelId: string; name?: string }): TuneTaskInfo {
  const createdAt = new Date().toISOString();
  const row = db.prepare("SELECT COUNT(*) as c FROM tune_task").get() as { c: number | bigint };
  const next = Number(row.c) + 1;
  const task: TuneTaskInfo = {
    id: `tune_${String(next).padStart(3, "0")}`,
    projectId: input.projectId,
    modelId: input.modelId,
    name: input.name?.trim() || `Tune Task ${next}`,
    status: "queued",
    logs: ["task queued"],
    createdAt,
    updatedAt: createdAt,
  };

  db.prepare(
    "INSERT INTO tune_task (id, project_id, model_id, name, status, logs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    task.id,
    task.projectId,
    task.modelId,
    task.name,
    task.status,
    JSON.stringify(task.logs),
    task.createdAt,
    task.updatedAt
  );

  return task;
}

export function getTuneTaskLogs(taskId: string): Array<{ index: number; message: string; at: string }> | undefined {
  const task = getTuneTask(taskId);
  if (!task) return undefined;

  return task.logs.map((message, idx) => ({
    index: idx + 1,
    message,
    at: task.updatedAt,
  }));
}
