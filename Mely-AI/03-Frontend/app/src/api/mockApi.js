import { seed } from './mockData';

const STORAGE_KEY = 'mely-ai-mock-db';
const TOKEN_KEY = 'mely-ai-token';

const sleep = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function getDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return structuredClone(seed);
  }
  return JSON.parse(raw);
}

function setDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function withAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Unauthorized');
}

export const authApi = {
  async login({ email, password }) {
    await sleep();
    const db = getDb();
    const user = db.users.find((u) => u.email === email && u.password === password);
    if (!user) throw new Error('Invalid credentials');
    const token = `token_${user.id}`;
    localStorage.setItem(TOKEN_KEY, token);
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  },
  async logout() {
    await sleep(80);
    localStorage.removeItem(TOKEN_KEY);
    return { ok: true };
  },
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }
};

export const projectsApi = {
  async list() {
    await sleep();
    withAuth();
    return getDb().projects;
  },
  async create({ name }) {
    await sleep();
    withAuth();
    const db = getDb();
    const project = { id: uid('p'), name, ownerId: 'u_demo' };
    db.projects.push(project);
    setDb(db);
    return project;
  }
};

export const modelsApi = {
  async listByProject(projectId) {
    await sleep();
    withAuth();
    return getDb().models.filter((m) => m.projectId === projectId);
  }
};

export const sessionsApi = {
  async list(projectId) {
    await sleep();
    withAuth();
    return getDb().sessions.filter((s) => s.projectId === projectId);
  },
  async create({ projectId, modelId, title }) {
    await sleep();
    withAuth();
    const db = getDb();
    const session = { id: uid('s'), projectId, modelId, title: title || 'New Session', messages: [] };
    db.sessions.unshift(session);
    setDb(db);
    return session;
  },
  async sendMessage({ sessionId, content }) {
    await sleep(250);
    withAuth();
    const db = getDb();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error('Session not found');

    const userMsg = { id: uid('msg'), role: 'user', content };
    const botMsg = { id: uid('msg'), role: 'assistant', content: `Mock reply: ${content}` };
    session.messages.push(userMsg, botMsg);
    setDb(db);
    return { userMsg, botMsg, session };
  }
};
