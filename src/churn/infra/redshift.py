"""
Redshift query client via MCP HTTP gateway.

Executes SQL through the MCP redshift_execute_sql_tool endpoint.
No direct Redshift credentials needed — the gateway handles auth.
"""
from __future__ import annotations

import json
import re
import time
import uuid

import pandas as pd
import requests

from churn.infra.config import RedshiftSettings


class RedshiftClient:
    def __init__(self, settings: RedshiftSettings):
        self._settings = settings
        self._schema = settings.schema

    # ── Query execution ──────────────────────────────────────────────────────

    def query_df(self, sql: str) -> pd.DataFrame:
        """Execute SQL via the MCP gateway. Returns a DataFrame."""
        url = self._settings.mcp_url
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": "redshift_execute_sql_tool",
                "arguments": {"sql": sql},
            },
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        last_exc: Exception | None = None
        retries = self._settings.retries
        delay = self._settings.retry_delay
        timeout = self._settings.timeout_seconds

        for attempt in range(1, retries + 1):
            try:
                resp = requests.post(
                    url, json=payload, headers=headers, timeout=timeout,
                )
                resp.raise_for_status()
                content_type = resp.headers.get("Content-Type", "")
                if "text/event-stream" in content_type:
                    raw = _parse_sse(resp.text)
                else:
                    raw = resp.json()
                return _parse_result(raw)
            except requests.exceptions.HTTPError as exc:
                if exc.response is not None and exc.response.status_code < 500:
                    raise
                last_exc = exc
                if attempt < retries:
                    time.sleep(delay)
            except (
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ConnectionError,
            ) as exc:
                last_exc = exc
                if attempt < retries:
                    time.sleep(delay)

        raise last_exc  # type: ignore[misc]

    # ── Feature queries ──────────────────────────────────────────────────────

    def fetch_all_order_features(
        self, obs_date: str, limit: int = 30_000,
    ) -> pd.DataFrame:
        """
        Canonical feature query: all transaction-derived + static user
        attributes, computed as-of obs_date (no label leakage).

        Returns per user: days_since_last_tx, days_since_first_tx,
        days_since_signup, total_completed_transfers, avg_tx_size_usd,
        wallet_cash_usd, tx_velocity_l30, tx_velocity_l90,
        tx_frequency_ratio, failed_tx_l60, failure_rate_l60,
        avg_attempts_per_order.
        """
        s = self._schema
        sql = f"""
        SELECT
            o.user_id,

            DATEDIFF('day',
                MAX(CASE WHEN o.order_status = 'COMPLETED'
                    THEN o.created_at END),
                '{obs_date}'
            )                                                      AS days_since_last_tx,

            DATEDIFF('day',
                MIN(CASE WHEN o.order_status = 'COMPLETED'
                    THEN o.created_at END),
                '{obs_date}'
            )                                                      AS days_since_first_tx,

            CASE WHEN u.signup_date IS NOT NULL
                 THEN DATEDIFF('day', u.signup_date, '{obs_date}')
                 ELSE NULL END                                     AS days_since_signup,

            COUNT(CASE WHEN o.order_status = 'COMPLETED'
                THEN 1 END)                                        AS total_completed_transfers,

            CASE WHEN u.total_completed_transfers > 0
                 THEN u.total_tpv_usd / u.total_completed_transfers
                 ELSE 0 END                                        AS avg_tx_size_usd,

            COALESCE(u.wallet_cash_usd, 0)                        AS wallet_cash_usd,

            COUNT(CASE
                WHEN o.order_status = 'COMPLETED'
                 AND o.created_at >= DATEADD('day', -30, '{obs_date}')
                THEN 1 END)                                        AS tx_velocity_l30,
            COUNT(CASE
                WHEN o.order_status = 'COMPLETED'
                 AND o.created_at >= DATEADD('day', -90, '{obs_date}')
                THEN 1 END)                                        AS tx_velocity_l90,

            COUNT(CASE
                WHEN o.order_status IN ('FAILED', 'CANCELLED')
                 AND o.created_at >= DATEADD('day', -60, '{obs_date}')
                THEN 1 END)                                        AS failed_tx_l60,
            COUNT(CASE
                WHEN o.created_at >= DATEADD('day', -60, '{obs_date}')
                THEN 1 END)                                        AS total_orders_l60,

            COALESCE(AVG(CASE
                WHEN o.created_at >= DATEADD('day', -90, '{obs_date}')
                THEN CAST(o.attempts AS FLOAT) END), 1.0)          AS avg_attempts_per_order

        FROM {s}.analytics_orders_master_data o
        INNER JOIN {s}.analytics_users_master_data u
            ON o.user_id = u.user_id
        WHERE u.kyc_status = 'VERIFIED'
          AND o.created_at <  '{obs_date}'
          AND o.created_at >= DATEADD('day', -730, '{obs_date}')
        GROUP BY o.user_id, u.signup_date, u.total_completed_transfers,
                 u.total_tpv_usd, u.wallet_cash_usd
        HAVING COUNT(CASE
                        WHEN o.order_status = 'COMPLETED'
                         AND o.created_at >= DATEADD('day', -90, '{obs_date}')
                        THEN 1 END) >= 1
        LIMIT {limit}
        """
        df = self.query_df(sql)
        if df.empty:
            return df
        numeric_cols = [
            "days_since_last_tx", "days_since_first_tx", "days_since_signup",
            "total_completed_transfers", "avg_tx_size_usd", "wallet_cash_usd",
            "tx_velocity_l30", "tx_velocity_l90", "failed_tx_l60",
            "total_orders_l60", "avg_attempts_per_order",
        ]
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        df["days_since_last_tx"] = df["days_since_last_tx"].clip(lower=0)
        df["days_since_first_tx"] = df["days_since_first_tx"].clip(lower=0)
        df["days_since_signup"] = (
            df["days_since_signup"]
            .replace(0, pd.NA)
            .fillna(df["days_since_first_tx"])
        )
        df["tx_frequency_ratio"] = (
            df["tx_velocity_l30"] / (df["tx_velocity_l90"] / 3.0 + 0.01)
        )
        df["failure_rate_l60"] = (
            df["failed_tx_l60"] / (df["total_orders_l60"] + 0.01)
        )
        return df.drop(columns=["total_orders_l60"])

    def fetch_user_master(self, as_of_date: str) -> pd.DataFrame:
        """Static user attributes from analytics_users_master_data."""
        s = self._schema
        sql = f"""
        SELECT
            user_id,
            CASE WHEN signup_date IS NOT NULL
                 THEN DATEDIFF('day', signup_date, '{as_of_date}')
                 ELSE NULL END                                     AS days_since_signup,
            CASE
                WHEN total_completed_transfers > 0
                THEN total_tpv_usd / total_completed_transfers
                ELSE 0
            END                                                    AS avg_tx_size_usd,
            COALESCE(wallet_cash_usd, 0)                           AS wallet_cash_usd
        FROM {s}.analytics_users_master_data
        WHERE kyc_status = 'VERIFIED'
          AND last_transaction_date IS NOT NULL
          AND user_id IN (
              SELECT DISTINCT user_id
              FROM {s}.analytics_orders_master_data
              WHERE created_at >= DATEADD('day', -730, '{as_of_date}')
                AND created_at <  '{as_of_date}'
          )
        """
        df = self.query_df(sql)
        if df.empty:
            return df
        for col in ["days_since_signup", "avg_tx_size_usd", "wallet_cash_usd"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        return df

    def fetch_rfi_features(self, as_of_date: str) -> pd.DataFrame:
        """Compliance hold features from transfer_rfi."""
        s = self._schema
        sql = f"""
        SELECT
            userid                                                 AS user_id,
            COUNT(CASE
                WHEN status IN ('REQUESTED', 'SUBMITTED', 'SENT_TO_PROVIDER')
                 AND created_at <= '{as_of_date}'
                THEN 1 END)                                        AS open_rfi_count,
            MAX(CASE
                WHEN status = 'REJECTED'
                 AND created_at <= '{as_of_date}'
                THEN 1 ELSE 0 END)                                 AS rfi_rejected
        FROM {s}.transfer_rfi
        WHERE created_at <= '{as_of_date}'
        GROUP BY userid
        """
        df = self.query_df(sql)
        if df.empty:
            return df
        for col in ["open_rfi_count", "rfi_rejected"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        return df

    def fetch_support_features(self, as_of_date: str) -> pd.DataFrame:
        """Support conversation features from decagon_conversations."""
        s = self._schema
        sql = f"""
        SELECT
            user_id,
            COUNT(CASE
                WHEN created_at >= DATEADD('day', -60, '{as_of_date}')
                 AND created_at <  '{as_of_date}'
                THEN 1 END)                                        AS support_convos_l60,
            MAX(CASE
                WHEN undeflected = TRUE
                 AND created_at >= DATEADD('day', -60, '{as_of_date}')
                 AND created_at <  '{as_of_date}'
                THEN 1 ELSE 0 END)                                 AS has_undeflected_convo,
            MAX(CASE
                WHEN csat_rating <= 2
                 AND created_at >= DATEADD('day', -60, '{as_of_date}')
                 AND created_at <  '{as_of_date}'
                THEN 1 ELSE 0 END)                                 AS low_csat_convo
        FROM {s}.decagon_conversations
        WHERE created_at < '{as_of_date}'
        GROUP BY user_id
        """
        df = self.query_df(sql)
        if df.empty:
            return df
        for col in ["support_convos_l60", "has_undeflected_convo", "low_csat_convo"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        return df

    def fetch_training_labels(
        self, obs_date: str, horizon_date: str,
    ) -> pd.DataFrame:
        """
        Forward-looking labels for users active in 90d before obs_date.

        label = 0 -> retained (completed a transfer in [obs_date, horizon_date])
        label = 1 -> churned  (no completed transfer in label window)
        """
        s = self._schema
        sql = f"""
        WITH active_before AS (
            SELECT DISTINCT o.user_id
            FROM {s}.analytics_orders_master_data o
            INNER JOIN {s}.analytics_users_master_data u
                ON o.user_id = u.user_id
            WHERE u.kyc_status = 'VERIFIED'
              AND o.order_status = 'COMPLETED'
              AND o.created_at >= DATEADD('day', -90, '{obs_date}')
              AND o.created_at <  '{obs_date}'
        )
        SELECT
            a.user_id,
            CASE
                WHEN MAX(CASE
                        WHEN o.order_status = 'COMPLETED'
                        THEN 1 ELSE 0 END) = 1
                THEN 0 ELSE 1
            END AS label
        FROM active_before a
        LEFT JOIN {s}.analytics_orders_master_data o
            ON a.user_id = o.user_id
           AND o.created_at >= '{obs_date}'
           AND o.created_at <  '{horizon_date}'
        GROUP BY a.user_id
        """
        df = self.query_df(sql)
        if not df.empty:
            df["label"] = (
                pd.to_numeric(df["label"], errors="coerce")
                .fillna(1)
                .astype(int)
            )
        return df

    def fetch_intervention_targets(self, as_of_date: str) -> pd.DataFrame:
        """Return at-risk (30-60d) and churned (>60d) verified users."""
        s = self._schema
        sql = f"""
        SELECT
            user_id,
            last_transaction_date,
            DATEDIFF('day', last_transaction_date, '{as_of_date}')
                                                                   AS days_since_last_tx,
            CASE
                WHEN DATEDIFF('day', last_transaction_date, '{as_of_date}') > 60
                THEN 'churned'
                ELSE 'at_risk'
            END                                                    AS segment
        FROM {s}.analytics_users_master_data
        WHERE kyc_status = 'VERIFIED'
          AND last_transaction_date IS NOT NULL
          AND DATEDIFF('day', last_transaction_date, '{as_of_date}') >= 30
        ORDER BY days_since_last_tx ASC
        LIMIT 5000
        """
        df = self.query_df(sql)
        if not df.empty:
            df["days_since_last_tx"] = pd.to_numeric(
                df["days_since_last_tx"], errors="coerce",
            )
        return df

    def check_outcomes(
        self, user_ids: list[str], from_date: str, to_date: str,
    ) -> pd.DataFrame:
        """Check if users transacted in [from_date, to_date]."""
        ids_csv = ",".join(f"'{uid}'" for uid in user_ids)
        s = self._schema
        sql = f"""
        SELECT
            user_id,
            1               AS converted,
            MIN(created_at)  AS first_tx_date
        FROM {s}.analytics_orders_master_data
        WHERE user_id IN ({ids_csv})
          AND order_status = 'COMPLETED'
          AND created_at >= '{from_date}'
          AND created_at <  '{to_date}'
        GROUP BY user_id
        """
        return self.query_df(sql)


# ── Response parsing (private) ───────────────────────────────────────────────


def _parse_sse(text: str) -> dict:
    """Extract the last JSON object from an SSE stream."""
    result: dict = {}
    for line in text.splitlines():
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if chunk and chunk != "[DONE]":
                try:
                    result = json.loads(chunk)
                except json.JSONDecodeError:
                    pass
    return result


def _parse_result(raw: object) -> pd.DataFrame:
    """
    Parse MCP tool result into a DataFrame.
    Handles JSON array, JSON object with rows key, and markdown tables.
    """
    if isinstance(raw, dict):
        result_block = raw.get("result", raw)
        content = result_block.get("content", [])
        if content and isinstance(content, list):
            text = content[0].get("text", "")
        else:
            for key in ("rows", "data", "results", "records"):
                if key in result_block and isinstance(result_block[key], list):
                    return pd.DataFrame(result_block[key])
            text = str(result_block)
    else:
        text = str(raw)

    text = text.strip()

    if text.startswith("["):
        try:
            return pd.DataFrame(json.loads(text))
        except json.JSONDecodeError:
            pass

    if text.startswith("{"):
        try:
            obj = json.loads(text)
            for key in ("rows", "data", "results", "records"):
                if key in obj:
                    return pd.DataFrame(obj[key])
        except json.JSONDecodeError:
            pass

    return _parse_table(text)


def _parse_table(text: str) -> pd.DataFrame:
    """Parse pipe-delimited or whitespace table into DataFrame."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [line for line in lines if not re.match(r"^[\|\s\-\+]+$", line)]
    if not lines:
        return pd.DataFrame()

    def _split_row(line: str) -> list[str]:
        if "|" in line:
            parts = [p.strip() for p in line.split("|")]
            return [p for p in parts if p]
        return line.split()

    headers = _split_row(lines[0])
    rows = [_split_row(line) for line in lines[1:] if line]
    rows = [r for r in rows if len(r) == len(headers)]
    return pd.DataFrame(rows, columns=headers)
