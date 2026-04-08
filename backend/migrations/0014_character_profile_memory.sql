-- character_profile: 1:1 extension of characters, holds all static persona/world/interaction data
CREATE TABLE IF NOT EXISTS character_profile (
    character_id        TEXT PRIMARY KEY,

    -- Persona
    persona_summary     TEXT,
    personality_traits  TEXT,           -- JSON array: ["温柔", "毒舌"]
    speaking_style      TEXT,
    backstory           TEXT,
    values_beliefs      TEXT,
    quirks              TEXT,
    likes               TEXT,           -- JSON array
    dislikes            TEXT,           -- JSON array

    -- Worldbuilding
    world_name          TEXT,
    world_setting       TEXT,
    world_rules         TEXT,
    world_key_events    TEXT,

    -- Interaction
    user_address        TEXT NOT NULL DEFAULT '你',
    self_address        TEXT NOT NULL DEFAULT '我',
    catchphrases        TEXT,           -- JSON array
    forbidden_words     TEXT,           -- JSON array
    emotion_default     TEXT,
    trigger_rules       TEXT,           -- JSON array: [{"trigger":"...", "reaction":"..."}]

    -- Meta
    updated_at          TEXT NOT NULL,
    profile_version     INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- character_memories: 1:N long-term memory entries
CREATE TABLE IF NOT EXISTS character_memories (
    id              TEXT PRIMARY KEY,
    character_id    TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'fact',   -- 'fact'|'event'|'relationship'|'preference'
    content         TEXT NOT NULL,
    importance      INTEGER NOT NULL DEFAULT 3,     -- 1..5
    pinned          INTEGER NOT NULL DEFAULT 0,     -- 1 = always inject into prompt
    source          TEXT NOT NULL DEFAULT 'manual', -- 'manual'|'auto_extracted'
    source_chat_id  TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_used_at    TEXT,
    hit_count       INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_character ON character_memories(character_id, pinned DESC, importance DESC);

-- FTS5 virtual table for memory content keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS character_memories_fts USING fts5(
    content,
    content='character_memories',
    content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON character_memories BEGIN
    INSERT INTO character_memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON character_memories BEGIN
    INSERT INTO character_memories_fts(character_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON character_memories BEGIN
    INSERT INTO character_memories_fts(character_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO character_memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
