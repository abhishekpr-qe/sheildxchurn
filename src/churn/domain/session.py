from __future__ import annotations

from collections import defaultdict

from churn.domain.models import DropOff, ScreenEvent, Session


def build_sessions(events: list[ScreenEvent]) -> list[Session]:
    """Group events by distinct_id into sessions, sorted by timestamp."""
    by_user: dict[str, list[ScreenEvent]] = defaultdict(list)
    for event in events:
        by_user[event.distinct_id].append(event)

    sessions = []
    for distinct_id, user_events in by_user.items():
        sorted_events = sorted(user_events, key=lambda e: e.timestamp)
        sessions.append(Session(
            distinct_id=distinct_id,
            events=tuple(sorted_events),
            last_screen=sorted_events[-1].screen_name,
        ))
    return sessions


def last_screen_drop_offs(sessions: list[Session]) -> list[DropOff]:
    """Aggregate sessions by last screen seen — higher counts = more drop-off."""
    counts: dict[str, int] = defaultdict(int)
    for session in sessions:
        counts[session.last_screen] += 1

    total = len(sessions)
    drop_offs = [
        DropOff(
            screen_name=screen,
            count=count,
            percentage=round(count / total * 100, 2) if total else 0.0,
        )
        for screen, count in counts.items()
    ]
    return sorted(drop_offs, key=lambda d: d.count, reverse=True)
