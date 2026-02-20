from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from churn.infra.config import RedshiftSettings
from churn.infra.redshift import RedshiftClient


@pytest.fixture
def settings() -> RedshiftSettings:
    return RedshiftSettings(
        host="test-host",
        port=5439,
        user="test_user",
        password="test_pass",
        database="dev",
        schema="public",
    )


@pytest.fixture
def client(settings: RedshiftSettings) -> RedshiftClient:
    return RedshiftClient(settings)


class TestRedshiftClient:
    @patch("churn.infra.redshift.redshift_connector")
    def test_query_returns_columns_and_rows(self, mock_rc, client):
        mock_cursor = MagicMock()
        mock_cursor.description = [("user_id",), ("score",)]
        mock_cursor.fetchall.return_value = [("u1", 10), ("u2", 20)]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_rc.connect.return_value = mock_conn

        columns, rows = client.query("SELECT user_id, score FROM users")

        assert columns == ["user_id", "score"]
        assert rows == [("u1", 10), ("u2", 20)]
        mock_conn.close.assert_called_once()

    @patch("churn.infra.redshift.redshift_connector")
    def test_query_empty_result(self, mock_rc, client):
        mock_cursor = MagicMock()
        mock_cursor.description = [("cnt",)]
        mock_cursor.fetchall.return_value = []

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_rc.connect.return_value = mock_conn

        columns, rows = client.query("SELECT COUNT(*) AS cnt FROM empty_table")

        assert columns == ["cnt"]
        assert rows == []

    @patch("churn.infra.redshift.redshift_connector")
    def test_connection_closed_on_error(self, mock_rc, client):
        mock_cursor = MagicMock()
        mock_cursor.execute.side_effect = RuntimeError("query failed")

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_rc.connect.return_value = mock_conn

        with pytest.raises(RuntimeError, match="query failed"):
            client.query("BAD SQL")

        mock_conn.close.assert_called_once()

    @patch("churn.infra.redshift.redshift_connector")
    def test_connect_uses_settings(self, mock_rc, settings):
        client = RedshiftClient(settings)
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.description = [("x",)]
        mock_cursor.fetchall.return_value = [(1,)]
        mock_conn.cursor.return_value = mock_cursor
        mock_rc.connect.return_value = mock_conn

        client.query("SELECT 1")

        mock_rc.connect.assert_called_once_with(
            host="test-host",
            port=5439,
            user="test_user",
            password="test_pass",
            database="dev",
        )
