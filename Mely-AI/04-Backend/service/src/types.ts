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
