"""VoiceService — manages voice asset lifecycle for a character.

Responsibilities:
- Store / retrieve voice_assets rows in SQLite
- Validate and save uploaded reference audio (delegating ffmpeg conversion)
- Submit voiceprint extraction and TTS synthesis tasks to the task queue
- Write completed audio generations to the generations table
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from app.services.task_queue import TaskQueue
    from app.services.tts_runtime import TTSRuntime

ALLOWED_AUDIO_FORMATS = {"wav", "mp3", "flac", "m4a", "ogg"}
MIN_DURATION_S = 3.0
MAX_DURATION_S = 30.0


class VoiceServiceError(Exception):
    pass


class VoiceCharacterNotFoundError(VoiceServiceError):
    pass


class VoiceReferenceNotFoundError(VoiceServiceError):
    pass


class VoiceNotBoundError(VoiceServiceError):
    pass


class VoiceInvalidFormatError(VoiceServiceError):
    pass


class VoiceInvalidDurationError(VoiceServiceError):
    pass


@dataclass
class VoiceAssetRow:
    character_id: str
    reference_audio_path: str | None
    reference_audio_duration: float | None
    reference_audio_format: str | None
    status: str  # unbound / extracting / bound / failed
    tts_engine: str | None
    bound_at: str | None


@dataclass
class VoiceService:
    db_path: Path
    data_root: Path
    queue: "TaskQueue"
    tts_runtime: "TTSRuntime"

    # ---------------------------------------------------------------------------
    # helpers
    # ---------------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        from app.db.connection import connect_database
        conn = connect_database(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _character_exists(self, conn: sqlite3.Connection, character_id: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM characters WHERE id = ?", (character_id,)
        ).fetchone()
        return row is not None

    def _get_voice_asset(self, conn: sqlite3.Connection, character_id: str) -> VoiceAssetRow | None:
        row = conn.execute(
            """
            SELECT character_id, reference_audio_path, reference_audio_duration,
                   reference_audio_format, status, tts_engine, bound_at
            FROM voice_assets WHERE character_id = ?
            """,
            (character_id,),
        ).fetchone()
        if row is None:
            return None
        return VoiceAssetRow(
            character_id=row["character_id"],
            reference_audio_path=row["reference_audio_path"],
            reference_audio_duration=row["reference_audio_duration"],
            reference_audio_format=row["reference_audio_format"],
            status=row["status"],
            tts_engine=row["tts_engine"],
            bound_at=row["bound_at"],
        )

    def _upsert_voice_asset(self, conn: sqlite3.Connection, asset: VoiceAssetRow) -> None:
        conn.execute(
            """
            INSERT INTO voice_assets
                (character_id, reference_audio_path, reference_audio_duration,
                 reference_audio_format, status, tts_engine, bound_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(character_id) DO UPDATE SET
                reference_audio_path = excluded.reference_audio_path,
                reference_audio_duration = excluded.reference_audio_duration,
                reference_audio_format = excluded.reference_audio_format,
                status = excluded.status,
                tts_engine = excluded.tts_engine,
                bound_at = excluded.bound_at
            """,
            (
                asset.character_id,
                asset.reference_audio_path,
                asset.reference_audio_duration,
                asset.reference_audio_format,
                asset.status,
                asset.tts_engine,
                asset.bound_at,
            ),
        )
        conn.commit()

    # ---------------------------------------------------------------------------
    # public API
    # ---------------------------------------------------------------------------

    def get_status(self, character_id: str) -> VoiceAssetRow:
        with self._connect() as conn:
            if not self._character_exists(conn, character_id):
                raise VoiceCharacterNotFoundError(f"角色不存在，请刷新后重试。")
            asset = self._get_voice_asset(conn, character_id)
            if asset is None:
                # Return a default "unbound" row — voice_assets row may not exist yet.
                return VoiceAssetRow(
                    character_id=character_id,
                    reference_audio_path=None,
                    reference_audio_duration=None,
                    reference_audio_format=None,
                    status="unbound",
                    tts_engine=None,
                    bound_at=None,
                )
            return asset

    def save_reference_audio(
        self,
        character_id: str,
        audio_bytes: bytes,
        original_filename: str,
        duration_seconds: float,
        audio_format: str,
    ) -> VoiceAssetRow:
        """Validate format/duration and persist reference audio bytes to disk."""
        ext = audio_format.lower().lstrip(".")
        if ext not in ALLOWED_AUDIO_FORMATS:
            raise VoiceInvalidFormatError(
                f"不支持的音频格式 {ext!r}，请上传 WAV、MP3、FLAC、M4A 或 OGG 文件。"
            )
        if not (MIN_DURATION_S <= duration_seconds <= MAX_DURATION_S):
            raise VoiceInvalidDurationError(
                f"参考音频时长需在 {MIN_DURATION_S}–{MAX_DURATION_S} 秒之间，当前为 {duration_seconds:.1f} 秒。"
            )

        voice_dir = self.data_root / "characters" / character_id / "voice"
        voice_dir.mkdir(parents=True, exist_ok=True)
        dest = voice_dir / "reference.wav"
        dest.write_bytes(audio_bytes)

        with self._connect() as conn:
            if not self._character_exists(conn, character_id):
                raise VoiceCharacterNotFoundError("角色不存在，请刷新后重试。")
            asset = VoiceAssetRow(
                character_id=character_id,
                reference_audio_path=str(dest),
                reference_audio_duration=duration_seconds,
                reference_audio_format=ext,
                status="extracting",
                tts_engine="f5-tts",
                bound_at=None,
            )
            self._upsert_voice_asset(conn, asset)
        return asset

    async def submit_voiceprint_extraction(self, character_id: str) -> str:
        """Submit a background task that marks the voice as bound (mock extraction).

        Real voiceprint extraction happens inside F5-TTS at inference time; this
        task just validates the reference file exists and updates the DB status.
        """
        asset = self.get_status(character_id)
        if asset.reference_audio_path is None:
            raise VoiceReferenceNotFoundError("请先上传参考音频再提取声纹。")

        ref_path = Path(asset.reference_audio_path)

        async def _extract(progress) -> None:
            await progress(10, "正在验证参考音频文件")
            await asyncio.sleep(0.05)
            if not ref_path.exists():
                raise FileNotFoundError("参考音频文件不存在，请重新上传。")
            await progress(80, "声纹提取完成，正在写入数据库")
            await asyncio.sleep(0.05)
            bound_at = datetime.now(timezone.utc).isoformat()
            with self._connect() as conn:
                conn.execute(
                    "UPDATE voice_assets SET status = 'bound', bound_at = ? WHERE character_id = ?",
                    (bound_at, character_id),
                )
                conn.commit()
            await progress(100, "声纹绑定成功")

        task = await self.queue.submit(
            name=f"tts-extract-{character_id}",
            runner=_extract,
            initial_message="声纹提取任务已进入队列",
        )
        return task.id

    async def submit_synthesis(
        self,
        character_id: str,
        text: str,
        language: str = "zh",
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> str:
        """Submit a TTS synthesis task; writes result to generations table when done."""
        from app.services.gpu_mutex import EngineGpuMutexError, check_gpu_exclusive

        asset = self.get_status(character_id)
        if asset.status != "bound":
            raise VoiceNotBoundError("请先完成声音绑定再合成语音。")

        # GPU mutex check
        check_gpu_exclusive(self.queue)

        tts_runtime_status = self.tts_runtime.get_status()
        if tts_runtime_status.state != "running":
            raise VoiceServiceError("TTS 引擎未运行，请先启动引擎。")

        # Find default costume for this character.
        with self._connect() as conn:
            costume_row = conn.execute(
                "SELECT id FROM costumes WHERE character_id = ? ORDER BY created_at LIMIT 1",
                (character_id,),
            ).fetchone()
        costume_id = costume_row["id"] if costume_row else "default"

        ref_path = asset.reference_audio_path
        db_path = self.db_path
        data_root = self.data_root

        async def _synthesize(progress) -> None:
            await progress(10, "正在准备 TTS 引擎")
            await asyncio.sleep(0.05)
            await progress(50, "正在合成语音")
            await asyncio.sleep(0.1)

            # Write output file
            gen_id = uuid4().hex
            output_dir = data_root / "characters" / character_id / "generations"
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"{gen_id}.wav"
            # In real impl this would call F5-TTS HTTP API and write the response.
            # For now we write an empty placeholder so the file endpoint works.
            output_path.write_bytes(b"")

            params_snapshot = json.dumps(
                {
                    "text": text,
                    "language": language,
                    "speed": speed,
                    "ttsEngine": "f5-tts",
                    "sampleRate": 24000,
                    "referenceAudioPath": ref_path,
                },
                ensure_ascii=False,
            )

            from app.db.connection import connect_database
            conn2 = connect_database(db_path)
            conn2.row_factory = sqlite3.Row
            with conn2:
                conn2.execute(
                    """
                    INSERT INTO generations
                        (id, character_id, costume_id, type, output_path, params_snapshot)
                    VALUES (?, ?, ?, 'audio', ?, ?)
                    """,
                    (gen_id, character_id, costume_id, str(output_path), params_snapshot),
                )
            await progress(100, "语音合成完成")

        task = await self.queue.submit(
            name=f"tts-{character_id}",
            runner=_synthesize,
            initial_message="语音合成任务已进入队列",
        )
        return task.id


def create_voice_service(
    db_path: Path,
    data_root: Path,
    queue: "TaskQueue",
    tts_runtime: "TTSRuntime",
) -> VoiceService:
    return VoiceService(
        db_path=db_path,
        data_root=data_root,
        queue=queue,
        tts_runtime=tts_runtime,
    )
