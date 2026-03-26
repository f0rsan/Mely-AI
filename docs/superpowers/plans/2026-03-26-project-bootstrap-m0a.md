# Project Bootstrap + M0-A Minimal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current docs-and-prototypes workspace into a runnable Mely AI codebase with a git repository, a Tauri + React shell, a FastAPI backend, SQLite bootstrap + migrations, and a minimal Chinese status page.

**Architecture:** Keep the first slice narrow. The root workspace holds the React app and Tauri shell, while `backend/` contains the FastAPI service, bootstrap logic, migrations, and tests. Existing `docs/`, `specs/`, and `prototypes/` stay as reference inputs; the UI gets reimplemented in TypeScript rather than copied from the JSX prototypes. Development mode uses Tauri’s `beforeDevCommand` to start the web frontend first, then the backend gets added to the same dev stack once the health flow exists.

**Tech Stack:** Git, npm, React 18, TypeScript, Vite, Tailwind CSS, Tauri 2.x, Rust, Python 3.11, FastAPI, SQLite, pytest, Vitest, React Testing Library, concurrently

---

**Execution note:** This workspace is not a git repository yet, and the existing docs and prototypes are not committed anywhere. Execution therefore starts with a one-time bootstrap in the current workspace to create the repository, commit the existing baseline, and then move into an isolated worktree. All implementation tasks after that bootstrap should run inside the worktree.

## File Structure

- `.gitignore` — ignore Node, Rust, Python, Tauri, local Mely data artifacts, and project-local worktrees.
- `package.json` — root scripts for web dev, tests, build, and Tauri dev.
- `tsconfig.json` — frontend TypeScript config.
- `tsconfig.node.json` — Vite/Tailwind config TypeScript support.
- `vite.config.ts` — React plugin, dev server settings, backend proxy, and Vitest config.
- `tailwind.config.ts` — Tailwind content scan and theme extension hook.
- `postcss.config.cjs` — Tailwind + Autoprefixer bridge.
- `index.html` — Vite entry page.
- `src/main.tsx` — React app mount.
- `src/App.tsx` — minimal startup status page.
- `src/App.test.tsx` — frontend status-page tests.
- `src/api/health.ts` — typed health-check client.
- `src/styles.css` — minimal app styling and Tailwind directives.
- `src/setupTests.ts` — Vitest + Testing Library setup.
- `src-tauri/Cargo.toml` — Rust crate for the desktop shell.
- `src-tauri/src/main.rs` — Tauri desktop entrypoint.
- `src-tauri/tauri.conf.json` — Tauri dev/build configuration.
- `src-tauri/build.rs` — Tauri build helper.
- `src-tauri/capabilities/default.json` — default Tauri capability set.
- `backend/pyproject.toml` — Python package metadata and backend dependencies.
- `backend/app/main.py` — FastAPI app factory and startup lifecycle.
- `backend/app/api/health.py` — `/api/health` route.
- `backend/app/core/settings.py` — environment and path settings.
- `backend/app/core/paths.py` — `~/.mely/` data root and directory creation helpers.
- `backend/app/db/connection.py` — SQLite connection helper.
- `backend/app/db/migrations.py` — migration runner and migration-table management.
- `backend/app/services/bootstrap.py` — startup bootstrap state builder.
- `backend/migrations/0001_initial_schema.sql` — initial schema for all current core tables and indexes.
- `backend/tests/conftest.py` — shared backend test helpers.
- `backend/tests/test_health.py` — backend health endpoint tests.
- `backend/tests/test_bootstrap.py` — data root, migration, and schema bootstrap tests.
- `README.md` — product overview plus the first working developer runbook.

### Task 0: Bootstrap the repository and create an isolated worktree

**Files:**
- Create: `.gitignore`
- Modify: existing tracked workspace files only by placing them under the first baseline commit

- [ ] **Step 1: Initialize the git repository in the current workspace**

Run:

```bash
git init
```

Expected:

```text
Initialized empty Git repository in /.../Mely AI/.git/
```

- [ ] **Step 2: Create the root ignore rules, including worktree directories**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.vite/
coverage/

src-tauri/target/

backend/.pytest_cache/
backend/.mypy_cache/
backend/.coverage
backend/.venv/

.DS_Store
.idea/
.vscode/

.worktrees/
worktrees/
.mely/
tmp/
```

- [ ] **Step 3: Commit the current docs-and-prototypes baseline before branching**

Run:

```bash
git add .
git commit -m "[M0] initialize repository baseline"
```

Expected:

```text
[main (root-commit) ...] [M0] initialize repository baseline
```

Result:
- The current Markdown docs, HTML specs, JSX prototypes, and `.gitignore` are now preserved in git.
- The next steps can use worktree-based isolation without losing the existing project context.

- [ ] **Step 4: Create an isolated worktree for implementation**

Recommended project-local option:

```bash
mkdir -p .worktrees
git check-ignore -q .worktrees
git worktree add .worktrees/m0a-foundation -b codex/m0a-foundation
```

Alternative global option if the partner prefers a global worktree location:

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
mkdir -p ~/.config/superpowers/worktrees/"$project"
git worktree add ~/.config/superpowers/worktrees/"$project"/m0a-foundation -b codex/m0a-foundation
```

Expected:

```text
Preparing worktree (new branch 'codex/m0a-foundation')
HEAD is now at ... [M0] initialize repository baseline
```

- [ ] **Step 5: Verify the worktree contains the project baseline and is ready**

If using the project-local option, run:

```bash
cd .worktrees/m0a-foundation
test -f README.md
test -d docs
test -d specs
test -d prototypes
git status --short
```

Expected:

```text
```

If using the global option, replace the `cd` target with the chosen global worktree path. An empty `git status --short` confirms the new worktree is clean.

### Task 1: Create the frontend shell and Tauri desktop wrapper

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.cjs`
- Create: `index.html`
- Create: `src/vite-env.d.ts`
- Create: `src/setupTests.ts`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/App.test.tsx`
- Create: `src/styles.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`

Execute this task inside the worktree created in Task 0.

- [ ] **Step 1: Create the frontend toolchain files**

Create `package.json`:

```json
{
  "name": "mely-ai",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev:web": "vite --host 127.0.0.1 --port 1420 --strictPort",
    "build": "tsc && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 1420 --strictPort",
    "test": "vitest",
    "test:run": "vitest run",
    "tauri:dev": "tauri dev"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "concurrently": "^9.1.2",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.16",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.5"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    css: true,
  },
});
```

Create `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

Create `postcss.config.cjs`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>Mely AI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Create `src/setupTests.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Install the Node dependencies**

Run:

```bash
npm install
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

- [ ] **Step 3: Write the failing frontend smoke test**

Create `src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

test("shows the startup placeholder before backend wiring exists", () => {
  render(<App />);

  expect(screen.getByText("正在连接后端...")).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the frontend test to verify it fails**

Run:

```bash
npm run test:run -- src/App.test.tsx
```

Expected:

```text
FAIL src/App.test.tsx
Error: Failed to resolve import "./App"
```

- [ ] **Step 5: Create the minimal frontend app files**

Create `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="app-shell">
      <section className="status-card">
        <p className="eyebrow">Mely AI</p>
        <h1>角色工作台</h1>
        <p className="status-copy">正在连接后端...</p>
      </section>
    </main>
  );
}
```

Create `src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color: #f6f1e8;
  background:
    radial-gradient(circle at top, rgba(199, 111, 58, 0.35), transparent 40%),
    linear-gradient(160deg, #171312 0%, #241a18 50%, #120f0e 100%);
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.status-card {
  width: min(100%, 640px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  padding: 32px;
  background: rgba(18, 15, 14, 0.78);
  backdrop-filter: blur(16px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.eyebrow {
  margin: 0 0 12px;
  color: #f3b17e;
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 16px;
  font-size: clamp(32px, 8vw, 56px);
  line-height: 1;
}

.status-copy {
  margin: 0;
  font-size: 18px;
  color: rgba(246, 241, 232, 0.84);
}
```

- [ ] **Step 6: Run the frontend test to verify it passes**

Run:

```bash
npm run test:run -- src/App.test.tsx
```

Expected:

```text
✓ src/App.test.tsx (1 test)
```

- [ ] **Step 7: Generate the Tauri shell**

Run:

```bash
npx tauri init --ci --app-name "Mely AI" --window-title "Mely AI" --before-dev-command "npm run dev:web" --before-build-command "npm run build" --dev-url "http://127.0.0.1:1420" --frontend-dist "../dist"
```

Expected:

```text
tauri configuration created
```

- [ ] **Step 8: Verify the Rust desktop shell compiles**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
Finished `dev` profile ...
```

- [ ] **Step 9: Commit the bootstrap shell**

Run:

```bash
git add package.json tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.ts postcss.config.cjs index.html src src-tauri
git commit -m "[M0] scaffold desktop shell"
```

Expected:

```text
[codex/m0a-foundation ...] [M0] scaffold desktop shell
```

### Task 2: Add the FastAPI backend and the first health-check contract

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/health.py`
- Create: `backend/app/main.py`
- Test: `backend/tests/test_health.py`

- [ ] **Step 1: Create the backend package metadata**

Create `backend/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"

[project]
name = "mely-backend"
version = "0.1.0"
description = "FastAPI backend for Mely AI"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115,<1.0",
  "pydantic>=2.10,<3.0",
  "pydantic-settings>=2.6,<3.0",
  "uvicorn[standard]>=0.32,<1.0"
]

[project.optional-dependencies]
dev = [
  "httpx>=0.27,<0.28",
  "pytest>=8.3,<9.0",
  "pytest-cov>=6.0,<7.0"
]

[tool.setuptools.packages.find]
where = ["."]
include = ["app*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Install the backend dependencies**

Run:

```bash
python -m pip install -e "backend[dev]"
```

Expected:

```text
Successfully installed mely-backend ...
```

- [ ] **Step 3: Write the failing backend health test**

Create `backend/tests/test_health.py`:

```py
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoint_returns_basic_service_status() -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "mely-backend"
    assert body["services"]["api"] == "running"
```

- [ ] **Step 4: Run the backend test to verify it fails**

Run:

```bash
cd backend && python -m pytest tests/test_health.py -q
```

Expected:

```text
E   ModuleNotFoundError: No module named 'app.main'
```

- [ ] **Step 5: Create the FastAPI app factory and health route**

Create `backend/app/__init__.py`:

```py
"""Mely AI backend package."""
```

Create `backend/app/api/__init__.py`:

```py
"""API routes for the Mely backend."""
```

Create `backend/app/api/health.py`:

```py
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def read_health() -> dict[str, object]:
    return {
        "status": "ok",
        "app": "mely-backend",
        "services": {"api": "running"},
    }
```

Create `backend/app/main.py`:

```py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="Mely AI Backend")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:1420", "http://localhost:1420"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 6: Run the backend test to verify it passes**

Run:

```bash
cd backend && python -m pytest tests/test_health.py -q
```

Expected:

```text
1 passed
```

- [ ] **Step 7: Commit the backend health slice**

Run:

```bash
git add backend/pyproject.toml backend/app backend/tests/test_health.py
git commit -m "[M0] Add backend health endpoint"
```

Expected:

```text
[main ...] [M0] Add backend health endpoint
```

### Task 3: Add `~/.mely/` bootstrap, SQLite setup, and schema migrations

**Files:**
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/settings.py`
- Create: `backend/app/core/paths.py`
- Create: `backend/app/db/__init__.py`
- Create: `backend/app/db/connection.py`
- Create: `backend/app/db/migrations.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/bootstrap.py`
- Create: `backend/migrations/0001_initial_schema.sql`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_bootstrap.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/health.py`
- Modify: `backend/tests/test_health.py`

- [ ] **Step 1: Write the failing bootstrap tests**

Create `backend/tests/conftest.py`:

```py
import os
from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture()
def temp_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    data_root = tmp_path / ".mely-test"
    monkeypatch.setenv("MELY_DATA_DIR", str(data_root))
    monkeypatch.delenv("MELY_APP_ENV", raising=False)
    yield data_root
    os.environ.pop("MELY_DATA_DIR", None)
```

Create `backend/tests/test_bootstrap.py`:

```py
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


EXPECTED_TABLES = {
    "schema_migrations",
    "characters",
    "character_dna",
    "visual_assets",
    "voice_assets",
    "costumes",
    "costume_previews",
    "generations",
    "generation_tags",
}


def test_bootstrap_creates_data_root_and_schema(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["database"]["initialized"] is True

    db_path = temp_data_root / "db" / "mely.db"
    assert db_path.exists()
    assert (temp_data_root / "characters").exists()
    assert (temp_data_root / "models").exists()
    assert (temp_data_root / "temp").exists()

    with sqlite3.connect(db_path) as connection:
        table_rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()

    tables = {row[0] for row in table_rows}
    assert EXPECTED_TABLES.issubset(tables)


def test_bootstrap_is_idempotent(temp_data_root: Path) -> None:
    first_app = create_app()
    second_app = create_app()

    with TestClient(first_app) as first_client:
        first_response = first_client.get("/api/health")

    with TestClient(second_app) as second_client:
        second_response = second_client.get("/api/health")

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["database"]["initialized"] is True
```

- [ ] **Step 2: Run the bootstrap tests to verify they fail**

Run:

```bash
cd backend && python -m pytest tests/test_bootstrap.py -q
```

Expected:

```text
FAILED tests/test_bootstrap.py::test_bootstrap_creates_data_root_and_schema
KeyError: 'database'
```

- [ ] **Step 3: Create the settings, paths, database, and bootstrap services**

Create `backend/app/core/__init__.py`:

```py
"""Core backend helpers."""
```

Create `backend/app/core/settings.py`:

```py
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MELY_", extra="ignore")

    app_env: str = Field(default="development")
    data_dir: Path | None = Field(default=None)


def get_settings() -> Settings:
    return Settings()
```

Create `backend/app/core/paths.py`:

```py
from pathlib import Path


def resolve_data_root(data_dir: Path | None) -> Path:
    if data_dir is not None:
        return data_dir.expanduser().resolve()

    return (Path.home() / ".mely").resolve()


def ensure_data_directories(data_root: Path) -> dict[str, Path]:
    directories = {
        "root": data_root,
        "db": data_root / "db",
        "characters": data_root / "characters",
        "models": data_root / "models",
        "temp": data_root / "temp",
    }

    for path in directories.values():
        path.mkdir(parents=True, exist_ok=True)

    return directories
```

Create `backend/app/db/__init__.py`:

```py
"""Database helpers."""
```

Create `backend/app/db/connection.py`:

```py
import sqlite3
from pathlib import Path


def connect_database(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys = ON;")
    return connection
```

Create `backend/app/db/migrations.py`:

```py
import sqlite3
from pathlib import Path


def ensure_schema_migrations_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.commit()


def apply_migrations(connection: sqlite3.Connection, migration_dir: Path) -> list[str]:
    ensure_schema_migrations_table(connection)

    applied = {
        row[0]
        for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
    }

    applied_now: list[str] = []
    for migration_path in sorted(migration_dir.glob("*.sql")):
        version = migration_path.stem.split("_", maxsplit=1)[0]
        if version in applied:
            continue

        sql = migration_path.read_text(encoding="utf-8")
        connection.executescript(sql)
        connection.execute(
            "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
            (version, migration_path.name),
        )
        connection.commit()
        applied_now.append(migration_path.name)

    return applied_now
```

Create `backend/app/services/__init__.py`:

```py
"""Service layer for backend startup and runtime workflows."""
```

Create `backend/app/services/bootstrap.py`:

```py
from dataclasses import dataclass, field
from pathlib import Path

from app.core.paths import ensure_data_directories, resolve_data_root
from app.core.settings import Settings, get_settings
from app.db.connection import connect_database
from app.db.migrations import apply_migrations


@dataclass(slots=True)
class BootstrapState:
    status: str
    data_root: Path
    db_path: Path
    initialized: bool
    applied_migrations: list[str] = field(default_factory=list)
    error: str | None = None


def bootstrap_application(settings: Settings | None = None) -> BootstrapState:
    resolved_settings = settings or get_settings()
    data_root = resolve_data_root(resolved_settings.data_dir)
    db_path = data_root / "db" / "mely.db"

    try:
        directories = ensure_data_directories(data_root)
        db_path = directories["db"] / "mely.db"
        migration_dir = Path(__file__).resolve().parents[2] / "migrations"

        with connect_database(db_path) as connection:
            applied_migrations = apply_migrations(connection, migration_dir)

        return BootstrapState(
            status="ok",
            data_root=data_root,
            db_path=db_path,
            initialized=True,
            applied_migrations=applied_migrations,
        )
    except Exception as exc:  # pragma: no cover - exercised through health contract
        return BootstrapState(
            status="error",
            data_root=data_root,
            db_path=db_path,
            initialized=False,
            error=str(exc),
        )
```

Create `backend/migrations/0001_initial_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS character_dna (
    character_id TEXT PRIMARY KEY,
    hair_color TEXT,
    eye_color TEXT,
    skin_tone TEXT,
    body_type TEXT,
    style TEXT,
    extra_tags TEXT,
    auto_prompt TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visual_assets (
    character_id TEXT PRIMARY KEY,
    lora_path TEXT,
    trigger_word TEXT,
    recommended_weight REAL,
    base_checkpoint TEXT,
    training_config TEXT,
    training_status TEXT,
    training_progress REAL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_assets (
    character_id TEXT PRIMARY KEY,
    reference_audio_path TEXT,
    voiceprint_embedding BLOB,
    tts_engine TEXT,
    custom_model_path TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS costumes (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    costume_lora TEXT,
    costume_prompt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES costumes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS costume_previews (
    id TEXT PRIMARY KEY,
    costume_id TEXT NOT NULL,
    image_path TEXT NOT NULL,
    sort_order INTEGER,
    FOREIGN KEY (costume_id) REFERENCES costumes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    costume_id TEXT NOT NULL,
    type TEXT NOT NULL,
    params_snapshot TEXT NOT NULL,
    output_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (costume_id) REFERENCES costumes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_tags (
    generation_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (generation_id, tag),
    FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_costumes_character ON costumes(character_id);
CREATE INDEX IF NOT EXISTS idx_costumes_parent ON costumes(parent_id);
CREATE INDEX IF NOT EXISTS idx_generations_character ON generations(character_id);
CREATE INDEX IF NOT EXISTS idx_generations_costume ON generations(costume_id);
CREATE INDEX IF NOT EXISTS idx_generations_type ON generations(type);
CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_tags_tag ON generation_tags(tag);
```

- [ ] **Step 4: Update startup and health reporting to expose bootstrap state**

Modify `backend/app/main.py`:

```py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.services.bootstrap import bootstrap_application


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.bootstrap = bootstrap_application()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Mely AI Backend", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:1420", "http://localhost:1420"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
```

Modify `backend/app/api/health.py`:

```py
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health")
def read_health(request: Request) -> JSONResponse | dict[str, object]:
    bootstrap = getattr(request.app.state, "bootstrap", None)

    if bootstrap is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "app": "mely-backend",
                "services": {"api": "running"},
                "database": {"initialized": False},
                "error": "bootstrap_not_run",
            },
        )

    body = {
        "status": bootstrap.status,
        "app": "mely-backend",
        "services": {"api": "running"},
        "dataRoot": str(bootstrap.data_root),
        "database": {
            "path": str(bootstrap.db_path),
            "initialized": bootstrap.initialized,
            "appliedMigrations": bootstrap.applied_migrations,
            "error": bootstrap.error,
        },
    }

    if bootstrap.status != "ok":
        return JSONResponse(status_code=503, content=body)

    return body
```

Modify `backend/tests/test_health.py`:

```py
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def test_health_endpoint_returns_bootstrap_details(temp_data_root: Path) -> None:
    app = create_app()

    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app"] == "mely-backend"
    assert body["services"]["api"] == "running"
    assert body["dataRoot"] == str(temp_data_root)
    assert body["database"]["initialized"] is True
    assert body["database"]["path"] == str(temp_data_root / "db" / "mely.db")
```

- [ ] **Step 5: Run the backend tests to verify they pass**

Run:

```bash
cd backend && python -m pytest tests/test_health.py tests/test_bootstrap.py -q
```

Expected:

```text
3 passed
```

- [ ] **Step 6: Commit the bootstrap and schema foundation**

Run:

```bash
git add backend/app backend/migrations backend/tests/conftest.py backend/tests/test_bootstrap.py
git commit -m "[M0] Add bootstrap and schema migrations"
```

Expected:

```text
[main ...] [M0] Add bootstrap and schema migrations
```

### Task 4: Wire the frontend status page to `/api/health` and update dev startup to include the backend

**Files:**
- Create: `src/api/health.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write the failing frontend health-page tests**

Replace `src/App.test.tsx` with:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders backend health details after a successful fetch", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: "ok",
      app: "mely-backend",
      dataRoot: "/tmp/.mely-test",
      database: {
        path: "/tmp/.mely-test/db/mely.db",
        initialized: true,
        appliedMigrations: ["0001_initial_schema.sql"],
        error: null,
      },
      services: { api: "running" },
    }),
  });

  render(<App />);

  expect(screen.getByText("正在连接后端...")).toBeInTheDocument();

  await screen.findByText("后端连接正常");
  expect(screen.getByText("/tmp/.mely-test")).toBeInTheDocument();
  expect(screen.getByText("/tmp/.mely-test/db/mely.db")).toBeInTheDocument();
});

test("shows a Chinese retry flow when the backend request fails", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "ok",
        app: "mely-backend",
        dataRoot: "/tmp/.mely-test",
        database: {
          path: "/tmp/.mely-test/db/mely.db",
          initialized: true,
          appliedMigrations: ["0001_initial_schema.sql"],
          error: null,
        },
        services: { api: "running" },
      }),
    });

  render(<App />);

  await screen.findByText("后端未启动，请重试");

  await userEvent.click(screen.getByRole("button", { name: "重试连接" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await screen.findByText("后端连接正常");
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:

```bash
npm run test:run -- src/App.test.tsx
```

Expected:

```text
FAIL src/App.test.tsx
Unable to find an element with the text: 后端连接正常
```

- [ ] **Step 3: Create the health client and the connected status page**

Create `src/api/health.ts`:

```ts
export type HealthResponse = {
  status: "ok" | "error";
  app: string;
  dataRoot?: string;
  services: {
    api: string;
  };
  database: {
    path?: string;
    initialized: boolean;
    appliedMigrations?: string[];
    error?: string | null;
  };
};

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", { signal });

  if (!response.ok) {
    throw new Error("BACKEND_UNAVAILABLE");
  }

  return (await response.json()) as HealthResponse;
}
```

Modify `src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "./api/health";

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; data: HealthResponse }
  | { kind: "error"; message: string };

function renderBody(state: ViewState, onRetry: () => void) {
  if (state.kind === "loading") {
    return <p className="status-copy">正在连接后端...</p>;
  }

  if (state.kind === "error") {
    return (
      <>
        <p className="status-copy">{state.message}</p>
        <button className="retry-button" onClick={onRetry} type="button">
          重试连接
        </button>
      </>
    );
  }

  return (
    <div className="status-grid">
      <div>
        <p className="label">状态</p>
        <p className="value success">后端连接正常</p>
      </div>
      <div>
        <p className="label">数据目录</p>
        <p className="value">{state.data.dataRoot}</p>
      </div>
      <div>
        <p className="label">数据库</p>
        <p className="value">{state.data.database.path}</p>
      </div>
      <div>
        <p className="label">迁移</p>
        <p className="value">
          {state.data.database.appliedMigrations?.join(", ") || "已初始化"}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  const load = async () => {
    setState({ kind: "loading" });

    try {
      const data = await fetchHealth();
      setState({ kind: "ready", data });
    } catch {
      setState({ kind: "error", message: "后端未启动，请重试" });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="app-shell">
      <section className="status-card">
        <p className="eyebrow">Mely AI</p>
        <h1>角色工作台</h1>
        {renderBody(state, () => {
          void load();
        })}
      </section>
    </main>
  );
}
```

Modify `src/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color: #f6f1e8;
  background:
    radial-gradient(circle at top, rgba(199, 111, 58, 0.35), transparent 40%),
    linear-gradient(160deg, #171312 0%, #241a18 50%, #120f0e 100%);
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}

.status-card {
  width: min(100%, 720px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  padding: 32px;
  background: rgba(18, 15, 14, 0.78);
  backdrop-filter: blur(16px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.eyebrow {
  margin: 0 0 12px;
  color: #f3b17e;
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 16px;
  font-size: clamp(32px, 8vw, 56px);
  line-height: 1;
}

.status-copy,
.value {
  margin: 0;
  font-size: 18px;
  color: rgba(246, 241, 232, 0.84);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
}

.label {
  margin: 0 0 8px;
  color: rgba(243, 177, 126, 0.9);
  font-size: 14px;
}

.success {
  color: #8fe3b3;
}

.retry-button {
  margin-top: 20px;
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  background: #f3b17e;
  color: #120f0e;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 4: Update dev commands so Tauri starts both the frontend and the backend**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev:web": "vite --host 127.0.0.1 --port 1420 --strictPort",
    "dev:backend": "cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload",
    "dev:stack": "concurrently -k -s first -n web,api \"npm run dev:web\" \"npm run dev:backend\"",
    "build": "tsc && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 1420 --strictPort",
    "test": "vitest",
    "test:run": "vitest run",
    "tauri:dev": "tauri dev"
  }
}
```

Modify `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    css: true,
  },
});
```

Modify `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Mely AI",
  "version": "0.1.0",
  "identifier": "com.mely.character-workbench",
  "build": {
    "beforeDevCommand": "npm run dev:stack",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://127.0.0.1:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Mely AI",
        "width": 1280,
        "height": 860,
        "resizable": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

- [ ] **Step 5: Run the frontend tests to verify they pass**

Run:

```bash
npm run test:run -- src/App.test.tsx
```

Expected:

```text
✓ src/App.test.tsx (2 tests)
```

- [ ] **Step 6: Manually verify the desktop app opens and reports backend health**

Run:

```bash
npm run tauri:dev
```

Expected:

```text
VITE ready on http://127.0.0.1:1420
Uvicorn running on http://127.0.0.1:8000
Tauri window opens and shows “后端连接正常”
```

- [ ] **Step 7: Commit the connected status page**

Run:

```bash
git add package.json vite.config.ts src/App.tsx src/App.test.tsx src/api/health.ts src/styles.css src-tauri/tauri.conf.json
git commit -m "[M0] Wire status page to backend health"
```

Expected:

```text
[main ...] [M0] Wire status page to backend health
```

### Task 5: Capture the first developer runbook and run the full verification set

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the first working developer runbook**

Append this section to `README.md`:

````md
## 当前开发入口

### 前置环境

- Node.js 18+
- Rust toolchain
- Python 3.11+

### 首次安装

```bash
npm install
python -m pip install -e "backend[dev]"
```

### 启动桌面应用

```bash
npm run tauri:dev
```

### 运行测试

```bash
npm run test:run
cd backend && python -m pytest -q
```

### 当前阶段能力

- 桌面窗口可启动
- FastAPI 后端会随开发流程启动
- `~/.mely/` 数据目录会自动创建
- SQLite 数据库和初始 schema 会自动建立
- 首页会显示后端与数据库状态
````

- [ ] **Step 2: Run the full automated verification set**

Run:

```bash
npm run test:run
```

Expected:

```text
2 passed
```

Run:

```bash
cd backend && python -m pytest -q
```

Expected:

```text
3 passed
```

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
Finished `dev` profile ...
```

- [ ] **Step 3: Run the final manual verification checklist**

Run:

```bash
npm run tauri:dev
```

Expected:

```text
The window opens, the page shows “后端连接正常”, and ~/.mely/db/mely.db exists after startup.
```

- [ ] **Step 4: Commit the runbook and final verification state**

Run:

```bash
git add README.md
git commit -m "[M0] Document bootstrap workflow"
```

Expected:

```text
[main ...] [M0] Document bootstrap workflow
```
