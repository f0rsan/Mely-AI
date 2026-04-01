"""Creation proof service — SHA-256 hash chain for IP attribution.

Each operation (costume creation, PDF export, etc.) records a proof entry
that links to the previous entry, forming a tamper-evident chain.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class ProofServiceError(Exception):
    pass


@dataclass
class ProofRecord:
    id: str
    character_id: str
    operation_type: str
    timestamp: str
    data_hash: str
    output_hash: str | None
    prev_proof_hash: str | None
    proof_hash: str
    metadata: dict | None
    created_at: str


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_data_hash(params: dict) -> str:
    """Deterministic SHA-256 of sorted JSON params."""
    return _sha256(json.dumps(params, sort_keys=True, ensure_ascii=False))


def compute_file_hash(file_path: Path) -> str:
    """SHA-256 of file contents."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _compute_proof_hash(
    proof_id: str,
    operation_type: str,
    timestamp: str,
    data_hash: str,
    output_hash: str | None,
    prev_proof_hash: str | None,
) -> str:
    parts = [proof_id, operation_type, timestamp, data_hash,
             output_hash or "", prev_proof_hash or ""]
    return _sha256("|".join(parts))


def get_last_proof(conn: sqlite3.Connection, character_id: str) -> ProofRecord | None:
    """Return the most recent proof for the character."""
    row = conn.execute(
        "SELECT * FROM creation_proofs WHERE character_id = ? ORDER BY created_at DESC LIMIT 1",
        (character_id,),
    ).fetchone()
    if row is None:
        return None
    return _row_to_proof(row)


def create_proof(
    conn: sqlite3.Connection,
    character_id: str,
    operation_type: str,
    params: dict,
    output_path: Path | None = None,
    metadata: dict | None = None,
) -> ProofRecord:
    proof_id = str(uuid4())
    timestamp = _utc_now_iso()
    created_at = timestamp

    data_hash = compute_data_hash(params)
    output_hash = compute_file_hash(output_path) if output_path and output_path.exists() else None
    last = get_last_proof(conn, character_id)
    prev_proof_hash = last.proof_hash if last else None
    proof_hash = _compute_proof_hash(proof_id, operation_type, timestamp, data_hash, output_hash, prev_proof_hash)
    metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None

    conn.execute(
        """INSERT INTO creation_proofs
           (id, character_id, operation_type, timestamp, data_hash, output_hash,
            prev_proof_hash, proof_hash, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (proof_id, character_id, operation_type, timestamp, data_hash, output_hash,
         prev_proof_hash, proof_hash, metadata_json, created_at),
    )
    conn.commit()

    return ProofRecord(
        id=proof_id, character_id=character_id, operation_type=operation_type,
        timestamp=timestamp, data_hash=data_hash, output_hash=output_hash,
        prev_proof_hash=prev_proof_hash, proof_hash=proof_hash,
        metadata=metadata, created_at=created_at,
    )


def export_proof_chain(conn: sqlite3.Connection, character_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM creation_proofs WHERE character_id = ? ORDER BY created_at ASC",
        (character_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def verify_proof_chain(chain: list[dict]) -> tuple[bool, str | None]:
    """Recompute each proof_hash and verify prev_proof_hash linkage."""
    prev_hash = None
    for i, entry in enumerate(chain):
        expected = _compute_proof_hash(
            entry["id"], entry["operation_type"], entry["timestamp"],
            entry["data_hash"], entry.get("output_hash"), entry.get("prev_proof_hash"),
        )
        if expected != entry["proof_hash"]:
            return False, f"第 {i+1} 条记录哈希不匹配，数据可能已被篡改"
        if entry.get("prev_proof_hash") != prev_hash:
            return False, f"第 {i+1} 条记录的前驱哈希链接断裂"
        prev_hash = entry["proof_hash"]
    return True, None


def _row_to_proof(row) -> ProofRecord:
    meta = None
    if row["metadata"]:
        try:
            meta = json.loads(row["metadata"])
        except json.JSONDecodeError:
            meta = None
    return ProofRecord(
        id=row["id"], character_id=row["character_id"],
        operation_type=row["operation_type"], timestamp=row["timestamp"],
        data_hash=row["data_hash"], output_hash=row["output_hash"],
        prev_proof_hash=row["prev_proof_hash"], proof_hash=row["proof_hash"],
        metadata=meta, created_at=row["created_at"],
    )
