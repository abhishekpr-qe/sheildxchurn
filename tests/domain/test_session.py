from churn.domain.models import ScreenEvent
from churn.domain.session import build_sessions, last_screen_drop_offs


def _event(uid: str, screen: str, ts: int) -> ScreenEvent:
    return ScreenEvent(distinct_id=uid, screen_name=screen, timestamp=ts)


class TestBuildSessions:
    def test_groups_by_user(self):
        events = [
            _event("u1", "Home", 1),
            _event("u2", "Home", 2),
            _event("u1", "Settings", 3),
        ]
        sessions = build_sessions(events)
        assert len(sessions) == 2

    def test_sorts_events_by_timestamp(self):
        events = [
            _event("u1", "Settings", 3),
            _event("u1", "Home", 1),
            _event("u1", "Profile", 2),
        ]
        sessions = build_sessions(events)
        names = [e.screen_name for e in sessions[0].events]
        assert names == ["Home", "Profile", "Settings"]

    def test_last_screen_set_correctly(self):
        events = [
            _event("u1", "Home", 1),
            _event("u1", "Checkout", 5),
            _event("u1", "Cart", 3),
        ]
        sessions = build_sessions(events)
        assert sessions[0].last_screen == "Checkout"

    def test_empty_input(self):
        assert build_sessions([]) == []


class TestLastScreenDropOffs:
    def test_counts_and_percentages(self):
        events = [
            _event("u1", "Home", 1),
            _event("u2", "Home", 1),
            _event("u2", "Cart", 2),
            _event("u3", "Home", 1),
            _event("u3", "Cart", 2),
            _event("u3", "Pay", 3),
        ]
        sessions = build_sessions(events)
        drop_offs = last_screen_drop_offs(sessions)

        assert drop_offs[0].screen_name == "Home"
        assert drop_offs[0].count == 1
        assert drop_offs[0].percentage == 33.33

    def test_sorted_by_count_descending(self):
        events = [
            _event("u1", "A", 1),
            _event("u2", "B", 1),
            _event("u3", "B", 1),
            _event("u4", "A", 1),
            _event("u4", "C", 2),
        ]
        sessions = build_sessions(events)
        drop_offs = last_screen_drop_offs(sessions)

        assert drop_offs[0].count >= drop_offs[-1].count

    def test_empty_sessions(self):
        assert last_screen_drop_offs([]) == []
