-- M4: exported artifacts tracking
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    export_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exports_character ON exports(character_id);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);
