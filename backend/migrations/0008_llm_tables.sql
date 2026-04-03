-- LLM training datasets (persona docs + dialogue samples)
CREATE TABLE IF NOT EXISTS llm_datasets (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_format TEXT NOT NULL,       -- "persona_doc" | "dialogue_jsonl" | "dialogue_csv" | "mixed"
    item_count INTEGER NOT NULL DEFAULT 0,
    quality_score REAL,                -- 0.0-1.0
    quality_issues_json TEXT,          -- JSON array of issue strings
    converted_path TEXT,               -- path to ShareGPT JSONL after conversion
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- LLM training jobs (Unsloth QLoRA)
CREATE TABLE IF NOT EXISTS llm_training_jobs (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    dataset_ids_json TEXT NOT NULL,    -- JSON array of llm_datasets.id
    mode TEXT NOT NULL,                -- "light" | "standard" | "fine"
    base_model TEXT NOT NULL DEFAULT 'qwen2.5:7b-instruct-q4_K_M',
    status TEXT NOT NULL DEFAULT 'queued',
    -- status: queued | preparing | training | exporting | registering | completed | failed | canceled
    progress REAL NOT NULL DEFAULT 0.0,
    current_step INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    loss REAL,
    eta_seconds INTEGER,
    adapter_path TEXT,                 -- path to LoRA adapter .safetensors
    gguf_path TEXT,                    -- path to merged GGUF export
    error_message TEXT,
    queue_task_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- LLM models registered in Ollama (per character, versioned)
CREATE TABLE IF NOT EXISTS llm_models (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    training_job_id TEXT,
    base_model TEXT NOT NULL,
    ollama_model_name TEXT NOT NULL,   -- e.g. "character_abc123_v1"
    gguf_path TEXT NOT NULL,
    system_prompt TEXT,                -- injected from character DNA at creation time
    dataset_item_count INTEGER NOT NULL DEFAULT 0,
    loss_final REAL,
    status TEXT NOT NULL DEFAULT 'ready',
    -- status: pending | ready | deleted
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (training_job_id) REFERENCES llm_training_jobs(id) ON DELETE SET NULL
);

-- Character chat sessions
CREATE TABLE IF NOT EXISTS character_chats (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    llm_model_id TEXT,                 -- null = base model
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
    FOREIGN KEY (llm_model_id) REFERENCES llm_models(id) ON DELETE SET NULL
);

-- Chat messages within a session
CREATE TABLE IF NOT EXISTS character_chat_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,                -- "user" | "assistant" | "system"
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES character_chats(id) ON DELETE CASCADE
);
