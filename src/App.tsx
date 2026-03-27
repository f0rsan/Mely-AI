export default function App() {
  return (
    <main className="app-shell">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">Mely AI</p>
        <h1 id="app-title">角色工作台</h1>
        <p className="lead">
          本地优先的角色创作桌面应用。启动后会先连接后端，再进入角色库。
        </p>

        <div className="status-row" role="status" aria-live="polite">
          <span className="status-chip">正在连接后端...</span>
          <span className="status-hint">首次启动会检查本地数据目录和数据库。</span>
        </div>
      </section>
    </main>
  );
}
