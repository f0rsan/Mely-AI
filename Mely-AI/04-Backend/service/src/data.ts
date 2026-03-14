import type { ModelInfo, Project, SessionInfo } from "./types.js";

export const projects: Project[] = [
  {
    id: "proj_001",
    name: "Melt AI Core",
    description: "Core orchestration and model routing",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "proj_002",
    name: "Melt AI Playground",
    description: "Prompt and workflow experimentation",
    updatedAt: new Date().toISOString(),
  },
];

export const models: ModelInfo[] = [
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    name: "GPT-4.1 mini",
    capabilities: ["chat", "reasoning"],
  },
  {
    id: "claude-3-5-sonnet",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    capabilities: ["chat", "analysis"],
  },
  {
    id: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    capabilities: ["chat", "multimodal"],
  },
];

export const sessions: SessionInfo[] = [
  {
    id: "sess_001",
    projectId: "proj_001",
    title: "Initial architecture discussion",
    status: "active",
    createdAt: new Date().toISOString(),
  },
];
