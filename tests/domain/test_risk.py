from churn.domain.risk import classify_risk_tier, compute_risk_score


class TestClassifyRiskTier:
    def test_critical_threshold(self):
        assert classify_risk_tier(0.80) == 'CRITICAL'
        assert classify_risk_tier(0.95) == 'CRITICAL'

    def test_high_threshold(self):
        assert classify_risk_tier(0.60) == 'HIGH'
        assert classify_risk_tier(0.79) == 'HIGH'

    def test_medium_threshold(self):
        assert classify_risk_tier(0.40) == 'MEDIUM'
        assert classify_risk_tier(0.59) == 'MEDIUM'

    def test_low_threshold(self):
        assert classify_risk_tier(0.00) == 'LOW'
        assert classify_risk_tier(0.39) == 'LOW'

    def test_boundary_values(self):
        assert classify_risk_tier(0.80) == 'CRITICAL'
        assert classify_risk_tier(0.60) == 'HIGH'
        assert classify_risk_tier(0.40) == 'MEDIUM'
        assert classify_risk_tier(0.00) == 'LOW'

    def test_negative_score(self):
        assert classify_risk_tier(-0.1) == 'LOW'


class TestComputeRiskScore:
    def test_zero_signals(self):
        score = compute_risk_score(
            signal_count=0, fail_rate=0.0, days_since_last=0, stuck_rate=0.0,
        )
        assert score == 0.0

    def test_score_bounded_at_one(self):
        score = compute_risk_score(
            signal_count=10, fail_rate=0.5, days_since_last=30, stuck_rate=0.5,
        )
        assert score == 1.0

    def test_inactivity_boost(self):
        base = compute_risk_score(
            signal_count=1, fail_rate=0.0, days_since_last=10, stuck_rate=0.0,
        )
        boosted = compute_risk_score(
            signal_count=1, fail_rate=0.0, days_since_last=20, stuck_rate=0.0,
        )
        assert boosted > base + 0.2  # 0.3 boost for >14 days

    def test_high_failure_boost(self):
        base = compute_risk_score(
            signal_count=1, fail_rate=0.2, days_since_last=5, stuck_rate=0.0,
        )
        boosted = compute_risk_score(
            signal_count=1, fail_rate=0.4, days_since_last=5, stuck_rate=0.0,
        )
        assert boosted > base + 0.15  # 0.2 boost for >0.3 fail rate

    def test_signal_count_contribution(self):
        s1 = compute_risk_score(signal_count=1, fail_rate=0.0, days_since_last=5, stuck_rate=0.0)
        s3 = compute_risk_score(signal_count=3, fail_rate=0.0, days_since_last=5, stuck_rate=0.0)
        assert s3 > s1
