export type Project = {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
};

export type ModelInfo = {
  id: string;
  provider: string;
  name: string;
  capabilities: string[];
};

export type SessionInfo = {
  id: string;
  projectId: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
};

export type SessionExportInfo = {
  id: string;
  sessionId: string;
  format: "jsonl" | "csv" | "txt";
  fileUri: string;
  sampleCount: number;
  createdAt: string;
};

export type SessionMessageInfo = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type TuneTaskInfo = {
  id: string;
  projectId: string;
  modelId: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  logs: string[];
  createdAt: string;
  updatedAt: string;
};
