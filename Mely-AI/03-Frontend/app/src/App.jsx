import { useEffect, useMemo, useState } from 'react';
import { authApi, projectsApi, modelsApi, sessionsApi, tuneApi } from './api/httpApi';

const NAV_ITEMS = [
  ['home', 'Product Showcase'],
  ['models', 'Model Layer'],
  ['chat', 'Studio Session'],
  ['tune', 'Tune Engine'],
  ['market', 'Asset Market'],
  ['library', 'Library'],
  ['settings', 'Trust & Billing'],
];

export default function App() {
  const [token, setToken] = useState(authApi.getToken());
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('demo@mely.ai');
  const [password, setPassword] = useState('123456');
  const [status, setStatus] = useState('ready');
  const [page, setPage] = useState('home');

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [exportFormat, setExportFormat] = useState('jsonl');
  const [exportsBySession, setExportsBySession] = useState({});
  const [tuneTasks, setTuneTasks] = useState([]);
  const [tuneTaskId, setTuneTaskId] = useState('');
  const [tuneTaskName, setTuneTaskName] = useState('');
  const [tuneLogsByTask, setTuneLogsByTask] = useState({});

  useEffect(() => {
    if (!token) return;
    boot();
  }, [token]);

  useEffect(() => {
    if (!projectId || !token) return;
    loadModelsAndSessions(projectId);
  }, [projectId, token]);

  useEffect(() => {
    if (!sessionId || !token) return;
    loadExports(sessionId);
  }, [sessionId, token]);

  useEffect(() => {
    if (!tuneTaskId || !token) return;
    loadTuneLogs(tuneTaskId);
  }, [tuneTaskId, token]);

  const currentSession = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);
  const currentExports = exportsBySession[sessionId] || [];
  const currentTuneLogs = tuneLogsByTask[tuneTaskId] || [];

  async function boot() {
    try {
      setStatus('loading projects...');
      const p = await projectsApi.list();
      setProjects(p);
      const first = p[0]?.id || '';
      setProjectId(first);
      setStatus('ready');
    } catch (e) {
      setStatus(e.message || 'boot failed');
    }
  }

  async function loadModelsAndSessions(pid) {
    try {
      setStatus('loading models/sessions...');
      const [m, s, t] = await Promise.all([modelsApi.listByProject(pid), sessionsApi.list(pid), tuneApi.list(pid)]);
      setModels(m);
      setModelId(m[0]?.id || '');
      setSessions(s);
      setSessionId(s[0]?.id || '');
      setTuneTasks(t);
      setTuneTaskId(t[0]?.id || '');
      setStatus('ready');
    } catch (e) {
      setStatus(e.message || 'load failed');
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    try {
      setStatus('logging in...');
      const res = await authApi.login({ email, password });
      setToken(res.token);
      setUser(res.user);
      setStatus('ready');
    } catch (e2) {
      setStatus(e2.message);
    }
  }

  async function handleCreateSession() {
    if (!projectId) return;
    const created = await sessionsApi.create({ projectId, title: `Session ${sessions.length + 1}` });
    const next = [created, ...sessions];
    setSessions(next);
    setSessionId(created.id);
  }

  async function loadExports(targetSessionId) {
    const items = await sessionsApi.listExports(targetSessionId);
    setExportsBySession((prev) => ({ ...prev, [targetSessionId]: items }));
  }

  async function handleCreateExport() {
    if (!sessionId) return;
    await sessionsApi.createExport({ sessionId, format: exportFormat });
    await loadExports(sessionId);
    setStatus('export created');
  }

  async function handleCreateTuneTask() {
    if (!projectId || !modelId) return;
    const item = await tuneApi.create({ projectId, modelId, name: tuneTaskName || undefined });
    setTuneTaskName('');
    const refreshed = await tuneApi.list(projectId);
    setTuneTasks(refreshed);
    setTuneTaskId(item.id);
  }

  async function loadTuneLogs(taskId) {
    const items = await tuneApi.logs(taskId);
    setTuneLogsByTask((prev) => ({ ...prev, [taskId]: items }));
  }

  async function handleLogout() {
    await authApi.logout();
    setToken(null);
    setUser(null);
  }

  if (!token) {
    return (
      <main className="login-wrap">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>Desktop AI Studio</h1>
          <p>Mely AI · Local-first creator client</p>
          <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit">Login</button>
          <small>{status}</small>
        </form>
      </main>
    );
  }

  return (
    <main className="studio">
      <aside className="sidebar">
        <div className="brand">DESKTOP AI STUDIO</div>
        <div className="stack">Model: {models.find((m) => m.id === modelId)?.label || 'N/A'}</div>
        <nav>
          {NAV_ITEMS.map(([k, label]) => (
            <button key={k} className={page === k ? 'nav active' : 'nav'} onClick={() => setPage(k)}>{label}</button>
          ))}
        </nav>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="kicker">PRODUCT SURFACE</div>
            <h2>{NAV_ITEMS.find(([k]) => k === page)?.[1]}</h2>
          </div>
          <div className="userbox">{user?.name || 'Demo User'} <button onClick={handleLogout}>Logout</button></div>
        </header>

        <section className="surface">
          <div className="left panel-blue">
            <h3>Project & Session</h3>
            <label>Project<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Model<select value={modelId} onChange={(e) => setModelId(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <button onClick={handleCreateSession}>New Session</button>
            <ul className="list">{sessions.map((s) => <li key={s.id}><button className={s.id === sessionId ? 'chip active' : 'chip'} onClick={() => setSessionId(s.id)}>{s.title}</button></li>)}</ul>
          </div>

          <div className="center panel-dark">
            <h3>{currentSession?.title || 'Session'}</h3>
            <div className="row">
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                <option value="jsonl">jsonl</option><option value="csv">csv</option><option value="txt">txt</option>
              </select>
              <button onClick={handleCreateExport}>Create Export</button>
            </div>
            <ul className="list">
              {currentExports.map((item) => <li key={item.id}><a href={item.fileUri} target="_blank" rel="noreferrer">{item.format} artifact</a></li>)}
              {!currentExports.length && <li className="muted">No exports yet</li>}
            </ul>
          </div>

          <div className="right panel-dark">
            <h3>Tune Engine</h3>
            <div className="row"><input placeholder="task name" value={tuneTaskName} onChange={(e) => setTuneTaskName(e.target.value)} /><button onClick={handleCreateTuneTask}>Create</button></div>
            <select value={tuneTaskId} onChange={(e) => setTuneTaskId(e.target.value)}>
              <option value="">Select task</option>
              {tuneTasks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.status}</option>)}
            </select>
            <ul className="list">
              {currentTuneLogs.map((log) => <li key={`${log.index}-${log.at}`}>#{log.index} {log.message}</li>)}
              {tuneTaskId && currentTuneLogs.length === 0 && <li className="muted">No logs yet</li>}
            </ul>
          </div>
        </section>

        <footer className="status">Status: {status}</footer>
      </section>
    </main>
  );
}
