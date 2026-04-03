"""Tests for VoiceService — upload, extraction, synthesis, status.

Uses a real SQLite database (via temp_data_root fixture) but mocks
F5-TTS HTTP and the TTS engine runtime.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services.voice_service import (
    VoiceCharacterNotFoundError,
    VoiceInvalidDurationError,
    VoiceInvalidFormatError,
    VoiceNotBoundError,
    VoiceReferenceNotFoundError,
    VoiceService,
    VoiceSynthesisUnavailableError,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _make_service(temp_data_root: Path, tts_state: str = "running") -> VoiceService:
    from app.services.bootstrap import bootstrap_application
    from app.services.tts_runtime import TTSEngineStatus
    from app.services.task_queue import TaskQueue

    bootstrap = bootstrap_application()
    queue = TaskQueue()

    mock_runtime = MagicMock()
    mock_runtime.get_status.return_value = TTSEngineStatus(
        state=tts_state,
        restart_count=0,
        error_message=None,
        pid=None,
    )

    return VoiceService(
        db_path=bootstrap.db_path,
        data_root=Path(bootstrap.data_root),
        queue=queue,
        tts_runtime=mock_runtime,
    )


def _insert_character(db_path: Path, character_id: str = "char-1") -> None:
    from app.db.connection import connect_database
    conn = connect_database(db_path)
    with conn:
        conn.execute(
            "INSERT INTO characters (id, name, created_at) VALUES (?, ?, datetime('now'))",
            (character_id, "测试角色"),
        )


def _insert_costume(db_path: Path, character_id: str, costume_id: str = "cos-1") -> None:
    from app.db.connection import connect_database
    conn = connect_database(db_path)
    with conn:
        conn.execute(
            "INSERT INTO costumes (id, character_id, name) VALUES (?, ?, ?)",
            (costume_id, character_id, "基础造型"),
        )


def _get_voice_asset(db_path: Path, character_id: str):
    from app.db.connection import connect_database
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        return conn.execute(
            "SELECT * FROM voice_assets WHERE character_id = ?", (character_id,)
        ).fetchone()


def _count_audio_generations(db_path: Path, character_id: str) -> int:
    from app.db.connection import connect_database
    conn = connect_database(db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM generations WHERE character_id = ? AND type = 'audio'",
            (character_id,),
        ).fetchone()
    return int(row["cnt"] if row is not None else 0)


def _fake_wav_bytes() -> bytes:
    return b"RIFF\x24\x00\x00\x00WAVEfmt "


# ---------------------------------------------------------------------------
# get_status
# ---------------------------------------------------------------------------


def test_get_status_returns_unbound_for_new_character(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    asset = svc.get_status("char-1")
    assert asset.status == "unbound"
    assert asset.reference_audio_path is None


def test_get_status_raises_for_unknown_character(temp_data_root):
    svc = _make_service(temp_data_root)
    with pytest.raises(VoiceCharacterNotFoundError):
        svc.get_status("nonexistent-char")


# ---------------------------------------------------------------------------
# save_reference_audio
# ---------------------------------------------------------------------------


def test_save_reference_audio_writes_file_and_db(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    asset = svc.save_reference_audio(
        character_id="char-1",
        audio_bytes=_fake_wav_bytes(),
        original_filename="test.wav",
        duration_seconds=10.0,
        audio_format="wav",
    )

    assert asset.status == "extracting"
    assert asset.reference_audio_duration == 10.0
    assert asset.reference_audio_format == "wav"

    ref_path = Path(asset.reference_audio_path)
    assert ref_path.exists()
    assert ref_path.read_bytes() == _fake_wav_bytes()


def test_save_reference_audio_rejects_invalid_format(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    with pytest.raises(VoiceInvalidFormatError):
        svc.save_reference_audio(
            character_id="char-1",
            audio_bytes=b"data",
            original_filename="test.mp4",
            duration_seconds=10.0,
            audio_format="mp4",
        )


def test_save_reference_audio_rejects_non_wav_when_transcoding_unavailable(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    with pytest.raises(VoiceInvalidFormatError, match="仅支持 WAV"):
        svc.save_reference_audio(
            character_id="char-1",
            audio_bytes=b"fake-mp3",
            original_filename="test.mp3",
            duration_seconds=10.0,
            audio_format="mp3",
        )


def test_save_reference_audio_rejects_invalid_wav_bytes(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    with pytest.raises(VoiceInvalidFormatError, match="有效的 WAV"):
        svc.save_reference_audio(
            character_id="char-1",
            audio_bytes=b"not-a-wav",
            original_filename="test.wav",
            duration_seconds=10.0,
            audio_format="wav",
        )


def test_save_reference_audio_rejects_too_short(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    with pytest.raises(VoiceInvalidDurationError):
        svc.save_reference_audio(
            character_id="char-1",
            audio_bytes=_fake_wav_bytes(),
            original_filename="test.wav",
            duration_seconds=1.5,
            audio_format="wav",
        )


def test_save_reference_audio_rejects_too_long(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)

    with pytest.raises(VoiceInvalidDurationError):
        svc.save_reference_audio(
            character_id="char-1",
            audio_bytes=_fake_wav_bytes(),
            original_filename="test.wav",
            duration_seconds=60.0,
            audio_format="wav",
        )


# ---------------------------------------------------------------------------
# submit_synthesis
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_synthesize_raises_when_not_bound(temp_data_root):
    svc = _make_service(temp_data_root)
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)
    # Status is unbound, no voice asset row

    with pytest.raises(VoiceNotBoundError):
        await svc.submit_synthesis("char-1", "你好")


@pytest.mark.asyncio
async def test_synthesize_raises_when_engine_not_running(temp_data_root):
    svc = _make_service(temp_data_root, tts_state="stopped")
    from app.services.bootstrap import bootstrap_application
    bs = bootstrap_application()
    _insert_character(bs.db_path)
    # Manually set status to bound
    from app.db.connection import connect_database
    conn = connect_database(bs.db_path)
    with conn:
        conn.execute(
            "INSERT INTO voice_assets (character_id, status) VALUES (?, 'bound')",
            ("char-1",),
        )

    with pytest.raises(Exception, match="TTS 引擎未运行"):
        await svc.submit_synthesis("char-1", "你好")


@pytest.mark.asyncio
async def test_synthesize_fails_without_real_audio_output_and_keeps_history_clean(temp_data_root):
    svc = _make_service(temp_data_root, tts_state="running")
    from app.services.bootstrap import bootstrap_application
    from app.db.connection import connect_database

    bs = bootstrap_application()
    _insert_character(bs.db_path)
    conn = connect_database(bs.db_path)
    with conn:
        conn.execute(
            """
            INSERT INTO voice_assets
                (character_id, reference_audio_path, reference_audio_duration, reference_audio_format, status, tts_engine)
            VALUES (?, ?, ?, ?, 'bound', 'f5-tts')
            """,
            ("char-1", "/tmp/reference.wav", 8.0, "wav"),
        )

    with pytest.raises(VoiceSynthesisUnavailableError, match="暂不支持"):
        await svc.submit_synthesis("char-1", "你好")

    assert _count_audio_generations(bs.db_path, "char-1") == 0
