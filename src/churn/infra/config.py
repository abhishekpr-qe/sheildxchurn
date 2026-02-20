from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

from churn.domain.models import FunnelConfig


@dataclass(frozen=True)
class RedshiftSettings:
    mcp_url: str
    timeout_seconds: int
    retries: int
    retry_delay: float
    schema: str


@dataclass(frozen=True)
class MixpanelSettings:
    base_url: str
    engage_url: str
    timeout_seconds: int


@dataclass(frozen=True)
class ExportSettings:
    event_name: str
    from_date: str
    to_date: str


@dataclass(frozen=True)
class AppConfig:
    redshift: RedshiftSettings
    mixpanel: MixpanelSettings
    export: ExportSettings
    funnels: tuple[FunnelConfig, ...]
    api_secret: str


def load_config(config_path: str, secret_path: str) -> AppConfig:
    raw = _load_yaml(config_path)
    secret = _load_secret(secret_path)

    rs = raw["redshift"]
    mp = raw["mixpanel"]
    ex = raw["export"]

    funnels = tuple(
        FunnelConfig(name=name, steps=tuple(f["steps"]))
        for name, f in raw.get("funnels", {}).items()
    )

    mcp_url = os.environ.get("MCP_URL", rs["mcp_url"])

    return AppConfig(
        redshift=RedshiftSettings(
            mcp_url=mcp_url,
            timeout_seconds=rs["timeout_seconds"],
            retries=rs["retries"],
            retry_delay=rs["retry_delay"],
            schema=rs["schema"],
        ),
        mixpanel=MixpanelSettings(
            base_url=mp["base_url"],
            engage_url=mp["engage_url"],
            timeout_seconds=mp["timeout_seconds"],
        ),
        export=ExportSettings(
            event_name=ex["event_name"],
            from_date=ex["from_date"],
            to_date=ex["to_date"],
        ),
        funnels=funnels,
        api_secret=secret,
    )


def _load_yaml(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def _load_secret(path: str) -> str:
    return Path(path).read_text().strip()
