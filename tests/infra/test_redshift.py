from __future__ import annotations

import json

import pandas as pd
import pytest

from churn.infra.redshift import _parse_result, _parse_sse, _parse_table


class TestParseResult:
    def test_json_array(self):
        raw = {
            "result": {
                "content": [
                    {"type": "text", "text": json.dumps([
                        {"user_id": "u1", "score": 10},
                        {"user_id": "u2", "score": 20},
                    ])}
                ]
            }
        }
        df = _parse_result(raw)
        assert list(df.columns) == ["user_id", "score"]
        assert len(df) == 2
        assert df.iloc[0]["user_id"] == "u1"

    def test_json_object_with_rows_key(self):
        raw = {
            "result": {
                "content": [
                    {"type": "text", "text": json.dumps({
                        "rows": [{"id": "a"}, {"id": "b"}]
                    })}
                ]
            }
        }
        df = _parse_result(raw)
        assert len(df) == 2
        assert list(df.columns) == ["id"]

    def test_json_object_with_data_key(self):
        raw = {
            "result": {
                "content": [
                    {"type": "text", "text": json.dumps({
                        "data": [{"x": 1}]
                    })}
                ]
            }
        }
        df = _parse_result(raw)
        assert len(df) == 1

    def test_empty_content(self):
        raw = {"result": {"content": []}}
        df = _parse_result(raw)
        assert df.empty

    def test_plain_dict_fallback(self):
        raw = {"rows": [{"col": "val"}]}
        df = _parse_result(raw)
        assert len(df) == 1


class TestParseTable:
    def test_pipe_delimited(self):
        text = (
            "| user_id | score |\n"
            "|---------|-------|\n"
            "| u1      | 10    |\n"
            "| u2      | 20    |\n"
        )
        df = _parse_table(text)
        assert list(df.columns) == ["user_id", "score"]
        assert len(df) == 2

    def test_whitespace_delimited(self):
        text = (
            "user_id score\n"
            "u1 10\n"
            "u2 20\n"
        )
        df = _parse_table(text)
        assert list(df.columns) == ["user_id", "score"]
        assert len(df) == 2

    def test_empty_input(self):
        df = _parse_table("")
        assert df.empty

    def test_separator_only(self):
        df = _parse_table("|---|---|\n|---|---|")
        assert df.empty

    def test_mismatched_columns_skipped(self):
        text = (
            "| a | b |\n"
            "|---|---|\n"
            "| 1 | 2 |\n"
            "| 3 |\n"
        )
        df = _parse_table(text)
        assert len(df) == 1


class TestParseSse:
    def test_extracts_last_json(self):
        text = (
            "data: {\"partial\": true}\n"
            "data: {\"result\": {\"content\": [{\"text\": \"done\"}]}}\n"
            "data: [DONE]\n"
        )
        result = _parse_sse(text)
        assert result == {"result": {"content": [{"text": "done"}]}}

    def test_skips_invalid_json(self):
        text = "data: not-json\ndata: {\"ok\": true}\n"
        result = _parse_sse(text)
        assert result == {"ok": True}

    def test_empty_stream(self):
        result = _parse_sse("")
        assert result == {}
