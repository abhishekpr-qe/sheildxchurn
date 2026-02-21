"""Risk tier classification — pure domain logic, no I/O dependencies."""
from __future__ import annotations

from .constants import RISK_TIERS, INACTIVITY_THRESHOLD_DAYS, HIGH_FAIL_RATE_THRESHOLD


def classify_risk_tier(score: float) -> str:
    """Classify a churn probability score into a risk tier.

    Tiers are checked in descending threshold order from RISK_TIERS.
    """
    for tier, threshold in sorted(RISK_TIERS.items(), key=lambda t: -t[1]):
        if score >= threshold:
            return tier
    return 'LOW'


def compute_risk_score(
    *,
    signal_count: int,
    fail_rate: float,
    days_since_last: int,
    stuck_rate: float,
) -> float:
    """Compute a heuristic risk score from transaction signals.

    Used by process_transactions.py for users without ML scores.
    """
    score = 0.1 * signal_count + 0.1 * fail_rate + 0.05 * min(days_since_last / 10, 1) + 0.1 * stuck_rate
    if days_since_last > INACTIVITY_THRESHOLD_DAYS:
        score += 0.3
    if fail_rate > HIGH_FAIL_RATE_THRESHOLD:
        score += 0.2
    return min(1.0, score)
