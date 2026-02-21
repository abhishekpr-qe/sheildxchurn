from churn.domain.constants import (
    SIGNAL_FEATURES, LABEL_COL, RISK_TIERS, CORRIDOR_MAP,
    INTERVENTIONS, CORRIDORS, ONBOARDING_STEPS, EXPORT_EVENTS, CHURN_WINDOW_DAYS,
)


class TestSignalFeatures:
    def test_count(self):
        assert len(SIGNAL_FEATURES) == 43

    def test_no_duplicates(self):
        assert len(SIGNAL_FEATURES) == len(set(SIGNAL_FEATURES))

    def test_all_strings(self):
        assert all(isinstance(f, str) for f in SIGNAL_FEATURES)


class TestRiskTiers:
    def test_four_tiers(self):
        assert set(RISK_TIERS.keys()) == {'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'}

    def test_descending_thresholds(self):
        assert RISK_TIERS['CRITICAL'] > RISK_TIERS['HIGH'] > RISK_TIERS['MEDIUM'] > RISK_TIERS['LOW']

    def test_low_is_zero(self):
        assert RISK_TIERS['LOW'] == 0.0


class TestCorridorMap:
    def test_currencies(self):
        assert set(CORRIDOR_MAP.keys()) == {'AED', 'GBP', 'USD', 'EUR'}

    def test_all_route_to_india(self):
        assert all('India' in v for v in CORRIDOR_MAP.values())


class TestInterventions:
    def test_five_types(self):
        assert len(INTERVENTIONS) == 5

    def test_required_fields(self):
        for name, interv in INTERVENTIONS.items():
            assert 'channel' in interv, f'{name} missing channel'
            assert 'cost' in interv, f'{name} missing cost'
            assert 'lift' in interv, f'{name} missing lift'
            assert isinstance(interv['cost'], (int, float)), f'{name} cost not numeric'


class TestOther:
    def test_label_col(self):
        assert LABEL_COL == 'churn_label'

    def test_churn_window(self):
        assert CHURN_WINDOW_DAYS == 60

    def test_corridors_list(self):
        assert len(CORRIDORS) == 3

    def test_onboarding_steps_ordered(self):
        values = list(ONBOARDING_STEPS.values())
        assert values == sorted(values)

    def test_export_events_nonempty(self):
        assert len(EXPORT_EVENTS) > 0
