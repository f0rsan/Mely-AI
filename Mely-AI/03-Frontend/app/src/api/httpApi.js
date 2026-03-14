const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000';
const TOKEN_KEY = 'mely-ai-token';

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const authApi = {
  async login({ email, password }) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  },
  async logout() {
    localStorage.removeItem(TOKEN_KEY);
    return { ok: true };
  },
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
};

export const projectsApi = {
  async list() {
    const data = await request('/projects');
    return data.items || [];
  },
};

export const modelsApi = {
  async listByProject() {
    const data = await request('/models');
    return (data.items || []).map((m) => ({
      ...m,
      label: m.name,
      projectId: 'shared',
    }));
  },
};

export const sessionsApi = {
  async list() {
    const data = await request('/sessions');
    return (data.items || []).map((s) => ({ ...s, messages: [] }));
  },
  async create({ projectId, title }) {
    return request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, title }),
    });
  },
  async sendMessage() {
    throw new Error('Message API not implemented yet in backend');
  },
};
