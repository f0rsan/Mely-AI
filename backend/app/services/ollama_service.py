from __future__ import annotations

import json
from dataclasses import dataclass
from typing import AsyncIterator

import httpx


OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)


class OllamaRetryableError(Exception):
    """Raised when an Ollama operation is likely retryable later."""


class OllamaNotRunningError(OllamaRetryableError):
    """Raised when Ollama is not reachable."""


class OllamaModelNotFoundError(Exception):
    """Raised when a requested model is not available."""


class OllamaAPIError(Exception):
    """Raised on unexpected Ollama API errors."""


class OllamaTemporarilyUnavailableError(OllamaRetryableError):
    """Raised when Ollama is reachable but temporarily unavailable."""


@dataclass(slots=True)
class OllamaModelInfo:
    name: str
    size_bytes: int
    modified_at: str
    digest: str


@dataclass(slots=True)
class OllamaStatus:
    running: bool
    version: str | None
    models: list[OllamaModelInfo]


async def check_ollama_status() -> OllamaStatus:
    """Ping Ollama and return status including available models."""
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT, trust_env=False) as client:
            version_resp = await client.get(f"{OLLAMA_BASE_URL}/api/version")
            version_resp.raise_for_status()
            version = version_resp.json().get("version")

            tags_resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            tags_resp.raise_for_status()
            raw_models = tags_resp.json().get("models", [])

        models = [
            OllamaModelInfo(
                name=m["name"],
                size_bytes=m.get("size", 0),
                modified_at=m.get("modified_at", ""),
                digest=m.get("digest", ""),
            )
            for m in raw_models
        ]
        return OllamaStatus(running=True, version=version, models=models)
    except (httpx.ConnectError, httpx.TimeoutException):
        return OllamaStatus(running=False, version=None, models=[])
    except httpx.HTTPStatusError as exc:
        raise OllamaAPIError(f"Ollama returned {exc.response.status_code}") from exc


async def pull_model(model_name: str) -> AsyncIterator[dict]:
    """Stream pull progress for a model. Yields progress dicts."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=600.0, write=30.0, pool=5.0), trust_env=False) as client:
        try:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/pull",
                json={"name": model_name},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        yield json.loads(line)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise OllamaNotRunningError("Ollama 未运行，请先启动 Ollama") from exc
        except httpx.HTTPStatusError as exc:
            raise OllamaAPIError(f"拉取模型失败: {exc.response.status_code}") from exc


async def create_model(model_name: str, modelfile: str) -> None:
    """Register a custom model from a Modelfile string."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0), trust_env=False) as client:
        try:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/create",
                json={"name": model_name, "modelfile": modelfile},
            )
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise OllamaNotRunningError("Ollama 未运行，请先启动 Ollama") from exc
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            detail = ""
            try:
                payload = exc.response.json()
                if isinstance(payload, dict) and isinstance(payload.get("error"), str):
                    detail = payload["error"]
            except ValueError:
                pass
            if not detail:
                detail = exc.response.text.strip()
            if status_code in {502, 503, 504}:
                message = "Ollama 暂时不可用，请稍后重试"
                if detail:
                    message = f"{message}（{detail}）"
                raise OllamaTemporarilyUnavailableError(message) from exc
            if detail:
                raise OllamaAPIError(f"注册模型失败: {status_code} - {detail}") from exc
            raise OllamaAPIError(f"注册模型失败: {status_code}") from exc


async def delete_model(model_name: str) -> None:
    """Delete a model from Ollama."""
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT, trust_env=False) as client:
        try:
            resp = await client.delete(
                f"{OLLAMA_BASE_URL}/api/delete",
                json={"name": model_name},
            )
            if resp.status_code == 404:
                raise OllamaModelNotFoundError(f"模型 '{model_name}' 不存在")
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise OllamaNotRunningError("Ollama 未运行，请先启动 Ollama") from exc


async def chat_stream(
    model_name: str,
    messages: list[dict],
) -> AsyncIterator[str]:
    """Stream chat completion tokens. Yields text chunks."""
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0),
        trust_env=False,
    ) as client:
        try:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/chat",
                json={"model": model_name, "messages": messages, "stream": True},
            ) as response:
                if response.status_code == 404:
                    raise OllamaModelNotFoundError(f"模型 '{model_name}' 未找到，请先完成训练或检查 Ollama")
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield chunk
                        if data.get("done"):
                            break
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise OllamaNotRunningError("语言引擎未响应，请稍后重试") from exc


def build_character_modelfile(base_model: str, gguf_path: str, system_prompt: str) -> str:
    """Build an Ollama Modelfile for a fine-tuned character model."""
    escaped_prompt = system_prompt.replace('"', '\\"')
    return f"""FROM {gguf_path}
SYSTEM "{escaped_prompt}"
PARAMETER temperature 0.8
PARAMETER top_p 0.9
PARAMETER num_predict 512
"""
