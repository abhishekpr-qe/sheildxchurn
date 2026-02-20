from __future__ import annotations

from dataclasses import dataclass

from churn.domain.funnel import analyze_funnel
from churn.domain.models import DropOff, FunnelResult, ScreenEvent
from churn.domain.session import build_sessions, last_screen_drop_offs
from churn.infra.config import AppConfig
from churn.infra.mixpanel import MixpanelClient


@dataclass(frozen=True)
class AnalysisResult:
    total_events: int
    total_sessions: int
    funnel_results: tuple[FunnelResult, ...]
    drop_offs: tuple[DropOff, ...]


def run_analysis(config: AppConfig) -> AnalysisResult:
    client = MixpanelClient(config.mixpanel, config.api_secret)
    events = client.export_events(config.export)
    return analyze_events(events, config)


def analyze_events(events: list[ScreenEvent], config: AppConfig) -> AnalysisResult:
    """Pure analysis pipeline — separated from I/O for testability."""
    sessions = build_sessions(events)

    funnel_results = tuple(
        analyze_funnel(sessions, funnel_cfg)
        for funnel_cfg in config.funnels
    )

    drop_offs = tuple(last_screen_drop_offs(sessions))

    return AnalysisResult(
        total_events=len(events),
        total_sessions=len(sessions),
        funnel_results=funnel_results,
        drop_offs=drop_offs,
    )
