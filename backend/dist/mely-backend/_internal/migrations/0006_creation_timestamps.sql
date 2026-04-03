-- M4: creation proof hash chain for IP attribution
CREATE TABLE IF NOT EXISTS creation_proofs (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    output_hash TEXT,
    prev_proof_hash TEXT,
    proof_hash TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_creation_proofs_character ON creation_proofs(character_id);
CREATE INDEX IF NOT EXISTS idx_creation_proofs_timestamp ON creation_proofs(timestamp DESC);
