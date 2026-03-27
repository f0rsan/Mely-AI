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
