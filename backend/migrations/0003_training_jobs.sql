CREATE TABLE IF NOT EXISTS training_jobs (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    queue_task_id TEXT NOT NULL UNIQUE,
    requested_mode TEXT NOT NULL,
    effective_mode TEXT NOT NULL,
    requested_model TEXT NOT NULL,
    effective_model TEXT NOT NULL,
    strategy_default_model TEXT NOT NULL,
    runtime_default_model TEXT NOT NULL,
    requested_steps INTEGER NOT NULL,
    effective_steps INTEGER NOT NULL,
    requested_rank INTEGER NOT NULL,
    effective_rank INTEGER NOT NULL,
    vram_gb REAL NOT NULL,
    vram_source TEXT NOT NULL,
    precheck_result TEXT NOT NULL,
    downgrade_reasons TEXT NOT NULL DEFAULT '[]',
    config_json TEXT NOT NULL,
    business_status TEXT NOT NULL,
    queue_status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    current_stage TEXT NOT NULL,
    latest_message TEXT,
    latest_error TEXT,
    user_visible_error TEXT,
    sample_previews TEXT NOT NULL DEFAULT '[]',
    validation_images TEXT NOT NULL DEFAULT '[]',
    retrain_of_task_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (retrain_of_task_id) REFERENCES training_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_character_created
ON training_jobs(character_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_jobs_business_status
ON training_jobs(business_status);

CREATE INDEX IF NOT EXISTS idx_training_jobs_queue_status
ON training_jobs(queue_status);
