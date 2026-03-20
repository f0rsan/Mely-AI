import { useEffect, useMemo, useState } from 'react';
import { authApi, projectsApi, modelsApi, sessionsApi, tuneApi } from './api/httpApi';

const NAV_ITEMS = [
  ['home', 'Home'],
  ['models', 'Models'],
  ['chat', 'Chat'],
  ['tune', 'Tune'],
  ['generate', 'Generate'],
  ['market', 'Market'],
  ['library', 'Library'],
  ['settings', 'Settings'],
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

  const currentProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const currentModel = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const currentSession = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);
  const currentExports = exportsBySession[sessionId] || [];
  const currentTuneLogs = tuneLogsByTask[tuneTaskId] || [];

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

  async function boot() {
    try {
      setStatus('loading projects...');
      const [me, p] = await Promise.all([authApi.me(), projectsApi.list()]);
      setUser(me);
      setProjects(p);
      setProjectId(p[0]?.id || '');
      setStatus('ready');
    } catch (e) {
      if ((e.message || '').toLowerCase().includes('unauthorized')) {
        await authApi.logout();
        setToken(null);
        setUser(null);
      }
      setStatus(e.message || 'boot failed');
    }
  }

  async function loadModelsAndSessions(pid) {
    try {
      setStatus('loading models/sessions...');
      const [m, s, t] = await Promise.all([modelsApi.listByProject(pid), sessionsApi.list(pid), tuneApi.list(pid)]);
      setModels(m);
      setModelId((prev) => (m.some((x) => x.id === prev) ? prev : m[0]?.id || ''));
      setSessions(s);
      setSessionId((prev) => (s.some((x) => x.id === prev) ? prev : s[0]?.id || ''));
      setTuneTasks(t);
      setTuneTaskId((prev) => (t.some((x) => x.id === prev) ? prev : t[0]?.id || ''));
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
      setStatus(e2.message || 'login failed');
    }
  }

  async function handleCreateSession() {
    if (!projectId) return;
    try {
      const created = await sessionsApi.create({ projectId, title: `Session ${sessions.length + 1}` });
      const next = [created, ...sessions];
      setSessions(next);
      setSessionId(created.id);
      setStatus('session created');
    } catch (e) {
      setStatus(e.message || 'create session failed');
    }
  }

  async function loadExports(targetSessionId) {
    try {
      const items = await sessionsApi.listExports(targetSessionId);
      setExportsBySession((prev) => ({ ...prev, [targetSessionId]: items }));
    } catch (e) {
      setStatus(e.message || 'load exports failed');
    }
  }

  async function handleCreateExport() {
    if (!sessionId) return;
    try {
      await sessionsApi.createExport({ sessionId, format: exportFormat });
      await loadExports(sessionId);
      setStatus('export created');
    } catch (e) {
      setStatus(e.message || 'export failed');
    }
  }

  async function handleCreateTuneTask() {
    if (!projectId || !modelId) return;
    try {
      const item = await tuneApi.create({ projectId, modelId, name: tuneTaskName || undefined });
      setTuneTaskName('');
      const refreshed = await tuneApi.list(projectId);
      setTuneTasks(refreshed);
      setTuneTaskId(item.id);
      setStatus('tune task created');
    } catch (e) {
      setStatus(e.message || 'create tune task failed');
    }
  }

  async function loadTuneLogs(taskId) {
    try {
      const items = await tuneApi.logs(taskId);
      setTuneLogsByTask((prev) => ({ ...prev, [taskId]: items }));
    } catch (e) {
      setStatus(e.message || 'load tune logs failed');
    }
  }

  async function handleLogout() {
    await authApi.logout();
    setToken(null);
    setUser(null);
  }

  function shell(title, subtitle, children) {
    return (
      <section className="page">
        <header className="page-head">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </header>
        <div className="page-body">{children}</div>
      </section>
    );
  }

  function renderPage() {
    if (page === 'home') {
      return shell('Workspace Overview', 'Current project footprint and training workload', <>
        <div className="grid two">
          <article className="tile accent">
            <span>Project</span>
            <strong>{currentProject?.name || 'No project'}</strong>
            <small>{currentProject?.id || '—'}</small>
          </article>
          <article className="tile">
            <span>Model</span>
            <strong>{currentModel?.label || 'No model selected'}</strong>
            <small>{currentModel?.id || '—'}</small>
          </article>
        </div>
        <div className="grid three">
          <article className="tile"><span>Sessions</span><strong>{sessions.length}</strong></article>
          <article className="tile"><span>Exports</span><strong>{Object.values(exportsBySession).flat().length}</strong></article>
          <article className="tile"><span>Tune Tasks</span><strong>{tuneTasks.length}</strong></article>
        </div>
      </>);
    }

    if (page === 'models') {
      return shell('Model Layer', 'Connect project with available foundation models', <>
        <label className="control">Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="control">Model
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <ul className="list">{models.map((m) => <li key={m.id} className={m.id === modelId ? 'chip active' : 'chip'}>{m.label}</li>)}</ul>
      </>);
    }

    if (page === 'chat') {
      return shell('Session Studio', 'Session creation and export pipeline', <>
        <div className="row">
          <button onClick={handleCreateSession}>New Session</button>
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
            <option value="jsonl">jsonl</option>
            <option value="csv">csv</option>
            <option value="txt">txt</option>
          </select>
          <button onClick={handleCreateExport} disabled={!sessionId}>Create Export</button>
        </div>
        <div className="grid two">
          <article>
            <h4>Sessions</h4>
            <ul className="list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button className={s.id === sessionId ? 'chip active' : 'chip'} onClick={() => setSessionId(s.id)}>{s.title}</button>
                </li>
              ))}
            </ul>
          </article>
          <article>
            <h4>Exports · {currentSession?.title || 'No session'}</h4>
            <ul className="list">
              {currentExports.map((item) => <li key={item.id}><a href={item.fileUri} target="_blank" rel="noreferrer">{item.format} artifact</a></li>)}
              {!currentExports.length && <li className="muted">No exports yet</li>}
            </ul>
          </article>
        </div>
      </>);
    }

    if (page === 'tune') {
      return shell('Tune Engine', 'Trigger and inspect fine-tune tasks', <>
        <div className="row">
          <input placeholder="Task name (optional)" value={tuneTaskName} onChange={(e) => setTuneTaskName(e.target.value)} />
          <button onClick={handleCreateTuneTask} disabled={!projectId || !modelId}>Create Task</button>
        </div>
        <label className="control">Tune Task
          <select value={tuneTaskId} onChange={(e) => setTuneTaskId(e.target.value)}>
            <option value="">Select task</option>
            {tuneTasks.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.status}</option>)}
          </select>
        </label>
        <ul className="list">
          {currentTuneLogs.map((log) => <li key={`${log.index}-${log.at}`}>#{log.index} {log.message}</li>)}
          {tuneTaskId && currentTuneLogs.length === 0 && <li className="muted">No logs yet</li>}
        </ul>
      </>);
    }

    if (page === 'generate') {
      return shell('Generate (Placeholder)', 'UI scaffold ready; backend API integration pending', <>
        <article className="tile placeholder">
          <strong>Coming soon: creative generation workspace</strong>
          <p>Planned integration: prompt input, style packs, batch render queue, and history stream.</p>
          <small>No backend endpoint connected in current milestone.</small>
        </article>
      </>);
    }

    if (page === 'market') {
      return shell('Market (Placeholder)', 'Style-consistent placeholder without backend dependency', <>
        <article className="tile placeholder">
          <strong>Asset marketplace will land in a later phase.</strong>
          <p>Reserved for template packs, LoRA bundles, and community presets.</p>
          <small>No server API bound for market in this build.</small>
        </article>
      </>);
    }

    if (page === 'library') {
      return shell('Library', 'Local records from sessions, exports, and tune pipeline', <>
        <div className="grid three">
          <article className="tile"><span>Recent Session</span><strong>{currentSession?.title || '—'}</strong></article>
          <article className="tile"><span>Latest Export</span><strong>{currentExports[0]?.format || '—'}</strong></article>
          <article className="tile"><span>Active Tune Task</span><strong>{tuneTasks.find((t) => t.id === tuneTaskId)?.status || '—'}</strong></article>
        </div>
      </>);
    }

    return shell('Settings', 'Workspace controls and account profile', <>
      <div className="grid two">
        <article className="tile"><span>User</span><strong>{user?.name || 'Demo User'}</strong><small>{user?.email || email}</small></article>
        <article className="tile"><span>Token Status</span><strong>{token ? 'Authenticated' : 'Logged out'}</strong></article>
      </div>
    </>);
  }

  if (!token) {
    return (
      <main className="login-wrap">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>Mely AI Frontend</h1>
          <p>Sign in to continue with the project workspace.</p>
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
        <div className="brand">MELY AI</div>
        <div className="stack">Project: {currentProject?.name || '—'}</div>
        <nav>
          {NAV_ITEMS.map(([k, label]) => (
            <button key={k} className={page === k ? 'nav active' : 'nav'} onClick={() => setPage(k)}>{label}</button>
          ))}
        </nav>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="kicker">MELY AI · PRODUCT</div>
            <h2>{NAV_ITEMS.find(([k]) => k === page)?.[1]}</h2>
          </div>
          <div className="userbox">{user?.name || 'Demo User'}<button onClick={handleLogout}>Logout</button></div>
        </header>

        <section className="surface">{renderPage()}</section>
        <footer className="status">Status: {status}</footer>
      </section>
    </main>
  );
}
