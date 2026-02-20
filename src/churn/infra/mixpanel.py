from __future__ import annotations

import json

import requests

from churn.domain.models import ScreenEvent
from churn.infra.config import ExportSettings, MixpanelSettings


class MixpanelClient:
    def __init__(self, settings: MixpanelSettings, api_secret: str):
        self._settings = settings
        self._auth = (api_secret, "")

    def export_events(self, export: ExportSettings) -> list[ScreenEvent]:
        """Stream JSONL from Mixpanel export endpoint → list of ScreenEvents."""
        resp = requests.get(
            f"{self._settings.base_url}/export",
            params={
                "event": json.dumps([export.event_name]),
                "from_date": export.from_date,
                "to_date": export.to_date,
            },
            auth=self._auth,
            timeout=self._settings.timeout_seconds,
            stream=True,
        )
        resp.raise_for_status()
        return list(_parse_export_stream(resp))

    def get_user_profiles(self, page_size: int = 1000) -> list[dict]:
        """Paginate through Mixpanel engage endpoint → list of user profiles."""
        profiles: list[dict] = []
        page = 0
        session_id = None

        while True:
            params: dict = {"page_size": page_size, "page": page}
            if session_id:
                params["session_id"] = session_id

            resp = requests.get(
                f"{self._settings.engage_url}/engage",
                params=params,
                auth=self._auth,
                timeout=self._settings.timeout_seconds,
            )
            resp.raise_for_status()
            data = resp.json()

            results = data.get("results", [])
            profiles.extend(results)

            session_id = data.get("session_id")
            total = data.get("total", 0)
            if len(profiles) >= total or not results:
                break
            page += 1

        return profiles


def _parse_export_stream(resp: requests.Response):
    for line in resp.iter_lines(decode_unicode=True):
        if not line:
            continue
        row = json.loads(line)
        props = row.get("properties", {})
        distinct_id = props.get("distinct_id", "")
        screen_name = props.get("$current_url", props.get("screen_name", "unknown"))
        timestamp = props.get("time", 0)

        yield ScreenEvent(
            distinct_id=str(distinct_id),
            screen_name=screen_name,
            timestamp=int(timestamp),
        )
