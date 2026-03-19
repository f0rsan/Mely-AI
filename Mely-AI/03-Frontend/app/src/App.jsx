import { useEffect, useMemo, useState } from 'react';
import { authApi, projectsApi, modelsApi, sessionsApi, tuneApi } from './api/httpApi';

export default function App() {
  const [token, setToken] = useState(authApi.getToken());
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('demo@mely.ai');
  const [password, setPassword] = useState('123456');

  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [status, setStatus] = useState('ready');
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
    setStatus('loading projects...');
    const p = await projectsApi.list();
    setProjects(p);
    const first = p[0]?.id || '';
    setProjectId(first);
    setStatus('ready');
  }

  async function loadModelsAndSessions(pid) {
    setStatus('loading models/sessions...');
    const [m, s, t] = await Promise.all([modelsApi.listByProject(pid), sessionsApi.list(pid), tuneApi.list(pid)]);
    setModels(m);
    setModelId(m[0]?.id || '');
    setSessions(s);
    setSessionId(s[0]?.id || '');
    setTuneTasks(t);
    setTuneTaskId(t[0]?.id || '');
    setExportsBySession({});
    setTuneLogsByTask({});
    setStatus('ready');
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

  async function handleCreateProject() {
    setStatus('Project create API not enabled in current backend milestone');
  }

  async function handleCreateSession() {
    if (!projectId || !modelId) return;
    const created = await sessionsApi.create({ projectId, modelId, title: `Session ${sessions.length + 1}` });
    const next = [created, ...sessions];
    setSessions(next);
    setSessionId(created.id);
  }

  async function loadExports(targetSessionId) {
    try {
      const items = await sessionsApi.listExports(targetSessionId);
      setExportsBySession((prev) => ({ ...prev, [targetSessionId]: items }));
    } catch (err) {
      setStatus(err.message || 'load exports failed');
    }
  }

  async function handleCreateExport() {
    if (!sessionId) return;
    try {
      setStatus(`creating ${exportFormat} export...`);
      await sessionsApi.createExport({ sessionId, format: exportFormat });
      await loadExports(sessionId);
      setStatus('export created');
    } catch (err) {
      setStatus(err.message || 'create export failed');
    }
  }

  async function handleCreateTuneTask() {
    if (!projectId || !modelId) return;
    try {
      setStatus('creating tune task...');
      const item = await tuneApi.create({ projectId, modelId, name: tuneTaskName || undefined });
      setTuneTaskName('');
      const refreshed = await tuneApi.list(projectId);
      setTuneTasks(refreshed);
      setTuneTaskId(item.id);
      setStatus('tune task created');
    } catch (err) {
      setStatus(err.message || 'create tune task failed');
    }
  }

  async function loadTuneLogs(taskId) {
    try {
      const items = await tuneApi.logs(taskId);
      setTuneLogsByTask((prev) => ({ ...prev, [taskId]: items }));
    } catch (err) {
      setStatus(err.message || 'load tune logs failed');
    }
  }

  async function handleSend() {
    if (!sessionId || !input.trim()) return;
    const text = input.trim();
    setInput('');
    try {
      await sessionsApi.sendMessage({ sessionId, content: text });
      const refreshed = await sessionsApi.list(projectId);
      setSessions(refreshed);
    } catch (err) {
      setStatus(err.message || 'send failed');
    }
  }

  async function handleLogout() {
    await authApi.logout();
    setToken(null);
    setUser(null);
    setProjects([]);
    setModels([]);
    setSessions([]);
    setTuneTasks([]);
    setExportsBySession({});
    setTuneLogsByTask({});
    setProjectId('');
    setModelId('');
    setSessionId('');
    setTuneTaskId('');
  }

  if (!token) {
    return (
      <main className="page center">
        <form className="panel" onSubmit={handleLogin}>
          <h1>Mely AI Login</h1>
          <p>Demo account is prefilled.</p>
          <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button type="submit">Login</button>
          <small>{status}</small>
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <header>
        <h1>Mely AI Frontend Skeleton</h1>
        <div>
          <span>{user?.name || 'Demo User'}</span>
          <button onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <section className="grid">
        <aside className="panel">
          <h3>Projects</h3>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="row">
            <input placeholder="new project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
            <button onClick={handleCreateProject}>Add</button>
          </div>

          <h3>Models</h3>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>)}
          </select>

          <h3>Sessions</h3>
          <button onClick={handleCreateSession}>New Session</button>
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <button className={s.id === sessionId ? 'active' : ''} onClick={() => setSessionId(s.id)}>{s.title}</button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel chat">
          <h3>{currentSession?.title || 'No session selected'}</h3>
          <div className="export-bar">
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} disabled={!sessionId}>
              <option value="jsonl">jsonl</option>
              <option value="csv">csv</option>
              <option value="txt">txt</option>
            </select>
            <button onClick={handleCreateExport} disabled={!sessionId}>Create Export</button>
          </div>
          <ul className="exports">
            {currentExports.map((item) => (
              <li key={item.id}>
                <code>{item.format}</code> · <a href={item.fileUri} target="_blank" rel="noreferrer">artifact</a>
              </li>
            ))}
            {!currentExports.length && <li>No exports yet.</li>}
          </ul>

          <section className="tune-panel">
            <h4>Tune Tasks</h4>
            <div className="row">
              <input placeholder="task name (optional)" value={tuneTaskName} onChange={(e) => setTuneTaskName(e.target.value)} />
              <button onClick={handleCreateTuneTask} disabled={!projectId || !modelId}>Create Tune</button>
            </div>
            <select value={tuneTaskId} onChange={(e) => setTuneTaskId(e.target.value)}>
              <option value="">Select tune task</option>
              {tuneTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.id} · {t.status} · {t.name}</option>
              ))}
            </select>
            <ul className="tune-logs">
              {currentTuneLogs.map((log) => (
                <li key={`${log.index}-${log.at}`}><code>#{log.index}</code> {log.message}</li>
              ))}
              {tuneTaskId && currentTuneLogs.length === 0 && <li>No logs yet.</li>}
            </ul>
          </section>

          <div className="messages">
            {(currentSession?.messages || []).map((m) => (
              <p key={m.id} className={m.role}><b>{m.role}:</b> {m.content}</p>
            ))}
          </div>
          <div className="row">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type and send..." disabled />
            <button onClick={handleSend} disabled>Send</button>
          </div>
          <small>Message API 未实现，当前聊天发送已禁用。{status ? `（${status}）` : ''}</small>
        </section>
      </section>
    </main>
  );
}
