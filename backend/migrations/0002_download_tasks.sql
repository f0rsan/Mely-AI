CREATE TABLE IF NOT EXISTS download_tasks (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    url TEXT NOT NULL,
    target_path TEXT NOT NULL,
    temp_path TEXT NOT NULL,
    expected_size INTEGER,
    expected_sha256 TEXT,
    actual_sha256 TEXT,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER,
    message TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status);
CREATE INDEX IF NOT EXISTS idx_download_tasks_model_id ON download_tasks(model_id);
CREATE INDEX IF NOT EXISTS idx_download_tasks_created ON download_tasks(created_at DESC);
