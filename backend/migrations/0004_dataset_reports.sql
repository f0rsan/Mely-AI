CREATE TABLE IF NOT EXISTS dataset_reports (
    character_id TEXT PRIMARY KEY,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_images (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    image_format TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    angle_bucket TEXT NOT NULL,
    quality_status TEXT NOT NULL,
    issues_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_images_character_stored_name
ON dataset_images(character_id, stored_name);

CREATE INDEX IF NOT EXISTS idx_dataset_images_character_created
ON dataset_images(character_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dataset_images_character_quality
ON dataset_images(character_id, quality_status);
