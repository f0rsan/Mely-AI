-- M3: extend voice_assets with extraction status and metadata
ALTER TABLE voice_assets ADD COLUMN reference_audio_duration REAL;
ALTER TABLE voice_assets ADD COLUMN reference_audio_format TEXT;
ALTER TABLE voice_assets ADD COLUMN bound_at TEXT;
ALTER TABLE voice_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'unbound';
-- status: unbound / extracting / bound / failed

CREATE INDEX IF NOT EXISTS idx_voice_assets_status ON voice_assets(status);
