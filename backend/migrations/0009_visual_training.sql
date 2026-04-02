-- Visual training image datasets (Entry A: own images, Entry B: generated images)
CREATE TABLE IF NOT EXISTS visual_datasets (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_count INTEGER NOT NULL DEFAULT 0,
    quality_score REAL,                 -- 0.0–1.0 composite score
    quality_issues_json TEXT,           -- JSON array of issue strings
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- Individual images within a visual dataset
CREATE TABLE IF NOT EXISTS visual_dataset_images (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    tags_json TEXT,                     -- WD14 auto-generated tags (JSON array)
    source TEXT NOT NULL DEFAULT 'upload',  -- "upload" | "generated"
    created_at TEXT NOT NULL,
    FOREIGN KEY (dataset_id) REFERENCES visual_datasets(id) ON DELETE CASCADE
);

-- Visual LoRA training jobs (AI-Toolkit)
CREATE TABLE IF NOT EXISTS visual_training_jobs (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    dataset_ids_json TEXT NOT NULL,     -- JSON array of visual_datasets.id
    mode TEXT NOT NULL,                 -- "light" | "standard" | "fine"
    base_checkpoint TEXT NOT NULL DEFAULT 'flux-dev-q4',
    trigger_word TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    -- status: queued | preparing | training | completed | failed | canceled
    progress REAL NOT NULL DEFAULT 0.0,
    current_step INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    eta_seconds INTEGER,
    lora_path TEXT,                     -- output .safetensors path
    sample_images_json TEXT,            -- JSON array of preview image paths (one per 20%)
    error_message TEXT,
    queue_task_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_visual_datasets_character ON visual_datasets(character_id);
CREATE INDEX IF NOT EXISTS idx_visual_dataset_images_dataset ON visual_dataset_images(dataset_id);
CREATE INDEX IF NOT EXISTS idx_visual_training_jobs_character ON visual_training_jobs(character_id);
