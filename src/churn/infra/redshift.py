"""Direct Redshift connection via redshift_connector."""
from __future__ import annotations

import redshift_connector

from churn.infra.config import RedshiftSettings


class RedshiftClient:
    def __init__(self, settings: RedshiftSettings):
        self._settings = settings

    def _connect(self) -> redshift_connector.Connection:
        return redshift_connector.connect(
            host=self._settings.host,
            port=self._settings.port,
            user=self._settings.user,
            password=self._settings.password,
            database=self._settings.database,
        )

    def query(self, sql: str) -> tuple[list[str], list[tuple]]:
        """Run SQL, return (column_names, rows)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            return columns, rows
        finally:
            conn.close()
