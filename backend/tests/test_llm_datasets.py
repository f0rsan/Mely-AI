"""Tests for M1-B: LLM dataset management."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(temp_data_root):
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def character_id(client) -> str:
    resp = client.post("/api/characters", json={"name": "琳娜"})
    assert resp.status_code == 201
    return resp.json()["id"]


# ── Persona document parsing ──────────────────────────────────────────────────

class TestPersonaDocParsing:
    def test_upload_persona_markdown_returns_201(self, client, character_id):
        content = """# 角色设定

## 基本信息
姓名：琳娜
性别：女

## 性格
活泼开朗，喜欢和粉丝互动，说话时喜欢用颜文字。

## 背景故事
来自虚拟世界的少女，某天意外进入了现实世界，成为了一名 Vtuber。
"""
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "linna.md", "content": content},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["characterId"] == character_id
        assert body["sourceFormat"] == "persona_doc"
        assert body["itemCount"] > 0
        assert body["qualityScore"] is not None
        assert body["id"] is not None

    def test_persona_doc_generates_multiple_qa_pairs(self, client, character_id):
        content = (
            "姓名：小花\n\n"
            "性格：温柔可爱，喜欢照顾他人，遇到困难不会轻易放弃，有时候会突然撒娇。\n\n"
            "背景：普通高中生，热爱唱歌，立志成为一名 Vtuber，用歌声打动更多人。\n\n"
            "口头禅：「加油哦～」「小花陪着你呢！」"
        )
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "persona.txt", "content": content},
        )
        assert resp.status_code == 201
        # at minimum the full-doc pair + section pairs
        assert resp.json()["itemCount"] >= 1

    def test_persona_doc_txt_extension_detected_correctly(self, client, character_id):
        content = (
            "我是小花，一个活泼开朗的女孩。\n\n"
            "性格方面：我很喜欢唱歌跳舞，也很喜欢和大家聊天，希望带给大家快乐。\n\n"
            "口头禅是「哈哈哈～一起开心吧！」，说话风格轻松活泼。"
        )
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "character.txt", "content": content},
        )
        assert resp.status_code == 201
        assert resp.json()["sourceFormat"] == "persona_doc"


# ── JSONL dialogue parsing ─────────────────────────────────────────────────────

class TestDialogueJSONLParsing:
    def _make_jsonl(self, pairs: list[tuple[str, str]]) -> str:
        lines = [json.dumps({"user": u, "assistant": a}, ensure_ascii=False) for u, a in pairs]
        return "\n".join(lines)

    def test_upload_jsonl_user_assistant_format(self, client, character_id):
        content = self._make_jsonl(
            [(f"问题{i}", f"回答{i}，这是一个比较长的回复内容，包含更多信息。") for i in range(60)]
        )
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "dialogues.jsonl", "content": content},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["itemCount"] == 60
        assert body["sourceFormat"] == "dialogue_jsonl"

    def test_upload_jsonl_sharegpt_format(self, client, character_id):
        lines = [
            json.dumps({
                "conversations": [
                    {"from": "human", "value": f"你好{i}"},
                    {"from": "gpt",   "value": f"你好呀～我是琳娜！{i}"},
                ]
            })
            for i in range(55)
        ]
        content = "\n".join(lines)
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "sharegpt.jsonl", "content": content},
        )
        assert resp.status_code == 201
        assert resp.json()["itemCount"] == 55

    def test_upload_jsonl_human_gpt_keys(self, client, character_id):
        lines = [
            json.dumps({"human": f"问{i}", "gpt": f"答{i}，这是回答内容。"})
            for i in range(52)
        ]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 201

    def test_bad_json_returns_400(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "bad.jsonl", "content": 'not json\n{"user": "ok", "assistant": "ok"}'},
        )
        assert resp.status_code == 400
        assert "格式有误" in resp.json()["detail"]

    def test_missing_fields_returns_400(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "bad.jsonl", "content": '{"foo": "bar"}'},
        )
        assert resp.status_code == 400


# ── CSV dialogue parsing ──────────────────────────────────────────────────────

class TestDialogueCSVParsing:
    def test_upload_csv_user_assistant_columns(self, client, character_id):
        rows = ["user,assistant"] + [
            f"问题{i},这是回答{i}，包含足够多的内容。" for i in range(55)
        ]
        content = "\n".join(rows)
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.csv", "content": content},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["itemCount"] == 55
        assert body["sourceFormat"] == "dialogue_csv"

    def test_upload_csv_human_gpt_columns(self, client, character_id):
        rows = ["human,gpt"] + [f"hi{i},hello{i}，这是一段回复内容。" for i in range(52)]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.csv", "content": "\n".join(rows)},
        )
        assert resp.status_code == 201

    def test_csv_missing_header_returns_400(self, client, character_id):
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.csv", "content": "col1,col2\nval1,val2"},
        )
        assert resp.status_code == 400
        assert "表头" in resp.json()["detail"]


# ── Quality check ─────────────────────────────────────────────────────────────

class TestQualityCheck:
    def test_too_few_items_returns_400(self, client, character_id):
        lines = [json.dumps({"user": f"q{i}", "assistant": f"a{i}"}) for i in range(5)]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "tiny.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 400
        assert "过少" in resp.json()["detail"]

    def test_quality_score_present_on_success(self, client, character_id):
        lines = [
            json.dumps({"user": f"问{i}", "assistant": f"这是回答{i}，内容丰富详细。"})
            for i in range(60)
        ]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "ok.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 201
        assert 0.0 <= resp.json()["qualityScore"] <= 1.0

    def test_quality_warnings_included_in_issues_list(self, client, character_id):
        # 20 items: enough to pass MIN_ITEMS_ERROR but triggers MIN_ITEMS_WARNING
        lines = [
            json.dumps({"user": f"q{i}", "assistant": f"这是回答{i}，内容足够长。"})
            for i in range(20)
        ]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "warn.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 201
        body = resp.json()
        # Should have a warning about item count
        assert any("建议" in issue for issue in body["qualityIssues"])


# ── CRUD endpoints ────────────────────────────────────────────────────────────

class TestDatasetCRUD:
    def _upload(self, client, character_id, n=55) -> str:
        lines = [
            json.dumps({"user": f"问{i}", "assistant": f"回答{i}，内容详细丰富。"})
            for i in range(n)
        ]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "test.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 201
        return resp.json()["id"]

    def test_list_datasets_returns_uploaded_datasets(self, client, character_id):
        self._upload(client, character_id)
        self._upload(client, character_id)
        resp = client.get(f"/api/characters/{character_id}/llm-datasets")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_datasets_empty_for_new_character(self, client, character_id):
        resp = client.get(f"/api/characters/{character_id}/llm-datasets")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_preview_returns_conversation_items(self, client, character_id):
        dataset_id = self._upload(client, character_id)
        resp = client.get(f"/api/llm-datasets/{dataset_id}/preview?limit=5")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) <= 5
        assert all("human" in it and "gpt" in it for it in items)

    def test_delete_removes_dataset(self, client, character_id):
        dataset_id = self._upload(client, character_id)
        resp = client.delete(f"/api/llm-datasets/{dataset_id}")
        assert resp.status_code == 204

        # Should be gone from list
        resp = client.get(f"/api/characters/{character_id}/llm-datasets")
        assert len(resp.json()) == 0

    def test_delete_nonexistent_returns_404(self, client, character_id):
        resp = client.delete("/api/llm-datasets/nonexistent-id")
        assert resp.status_code == 404

    def test_upload_to_nonexistent_character_returns_404(self, client):
        lines = [json.dumps({"user": f"q{i}", "assistant": f"a{i}"}) for i in range(55)]
        resp = client.post(
            "/api/characters/ghost-id/llm-datasets",
            json={"filename": "x.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 404


# ── ShareGPT serialisation ────────────────────────────────────────────────────

class TestShareGPTSerialisation:
    def test_converted_file_is_valid_sharegpt_jsonl(self, client, character_id, temp_data_root):
        lines = [
            json.dumps({"user": f"问{i}", "assistant": f"答{i}，内容详细。"})
            for i in range(55)
        ]
        resp = client.post(
            f"/api/characters/{character_id}/llm-datasets",
            json={"filename": "data.jsonl", "content": "\n".join(lines)},
        )
        assert resp.status_code == 201
        converted_path = resp.json()["convertedPath"]
        assert converted_path is not None

        content = Path(converted_path).read_text(encoding="utf-8")
        parsed_lines = [json.loads(l) for l in content.splitlines() if l.strip()]
        assert len(parsed_lines) == 55
        for obj in parsed_lines:
            assert "conversations" in obj
            convs = obj["conversations"]
            assert any(c["from"] == "human" for c in convs)
            assert any(c["from"] == "gpt" for c in convs)
