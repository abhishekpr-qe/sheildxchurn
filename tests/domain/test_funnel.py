from churn.domain.models import FunnelConfig, ScreenEvent, Session
from churn.domain.funnel import analyze_funnel


def _session(uid: str, screens: list[str]) -> Session:
    events = tuple(
        ScreenEvent(distinct_id=uid, screen_name=s, timestamp=i)
        for i, s in enumerate(screens)
    )
    return Session(distinct_id=uid, events=events, last_screen=screens[-1])


ONBOARDING = FunnelConfig(name="onboarding", steps=("Home", "SignUp", "Dashboard"))


class TestAnalyzeFunnel:
    def test_full_completion(self):
        sessions = [_session("u1", ["Home", "SignUp", "Dashboard"])]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.total_entered == 1
        assert result.total_completed == 1
        assert result.completion_rate == 100.0

    def test_partial_completion(self):
        sessions = [
            _session("u1", ["Home", "SignUp", "Dashboard"]),
            _session("u2", ["Home", "SignUp"]),
            _session("u3", ["Home"]),
        ]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.total_entered == 3
        assert result.total_completed == 1
        assert len(result.steps) == 3
        assert result.steps[0].entered == 3
        assert result.steps[1].entered == 2
        assert result.steps[2].entered == 1

    def test_drop_rates(self):
        sessions = [
            _session("u1", ["Home", "SignUp", "Dashboard"]),
            _session("u2", ["Home", "SignUp"]),
            _session("u3", ["Home"]),
            _session("u4", ["Home"]),
        ]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.steps[0].drop_rate == 0.0
        assert result.steps[1].dropped == 2
        assert result.steps[1].drop_rate == 50.0

    def test_order_preserving(self):
        """User sees Dashboard before Home — enters Home+SignUp but not Dashboard (appears too early)."""
        sessions = [_session("u1", ["Dashboard", "Home", "SignUp"])]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.steps[0].entered == 1  # Home found
        assert result.steps[1].entered == 1  # SignUp found after Home
        assert result.steps[2].entered == 0  # Dashboard not found after SignUp

    def test_user_not_in_funnel(self):
        sessions = [_session("u1", ["Settings", "Profile"])]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.total_entered == 0
        assert result.total_completed == 0

    def test_empty_sessions(self):
        result = analyze_funnel([], ONBOARDING)
        assert result.total_entered == 0

    def test_empty_funnel_config(self):
        config = FunnelConfig(name="empty", steps=())
        result = analyze_funnel([_session("u1", ["Home"])], config)
        assert result.total_entered == 0

    def test_interleaved_screens(self):
        sessions = [_session("u1", ["Home", "Settings", "SignUp", "Help", "Dashboard"])]
        result = analyze_funnel(sessions, ONBOARDING)

        assert result.total_completed == 1
