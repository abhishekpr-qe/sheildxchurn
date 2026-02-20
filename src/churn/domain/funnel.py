from __future__ import annotations

from churn.domain.models import FunnelConfig, FunnelResult, FunnelStep, Session


def analyze_funnel(sessions: list[Session], config: FunnelConfig) -> FunnelResult:
    """Order-preserving funnel: a user 'passes' step N if they visited it after step N-1."""
    steps = config.steps
    if not steps:
        return FunnelResult(
            name=config.name, steps=(), total_entered=0,
            total_completed=0, completion_rate=0.0,
        )

    step_counts = _count_step_progression(sessions, steps)
    total_entered = step_counts[0]
    funnel_steps = _build_funnel_steps(steps, step_counts)
    total_completed = step_counts[-1]
    completion_rate = round(total_completed / total_entered * 100, 2) if total_entered else 0.0

    return FunnelResult(
        name=config.name,
        steps=tuple(funnel_steps),
        total_entered=total_entered,
        total_completed=total_completed,
        completion_rate=completion_rate,
    )


def _count_step_progression(sessions: list[Session], steps: tuple[str, ...]) -> list[int]:
    """Count how many users reached each step in order."""
    step_counts = [0] * len(steps)
    for session in sessions:
        screen_names = [e.screen_name for e in session.events]
        search_from = 0
        for i, step in enumerate(steps):
            try:
                idx = screen_names.index(step, search_from)
                step_counts[i] += 1
                search_from = idx + 1
            except ValueError:
                break
    return step_counts


def _build_funnel_steps(steps: tuple[str, ...], step_counts: list[int]) -> list[FunnelStep]:
    """Build FunnelStep objects with drop counts and rates."""
    funnel_steps = []
    for i, step_name in enumerate(steps):
        entered = step_counts[i]
        prev = step_counts[i - 1] if i > 0 else entered
        dropped = prev - entered
        drop_rate = round(dropped / prev * 100, 2) if prev else 0.0
        funnel_steps.append(FunnelStep(
            name=step_name, entered=entered,
            dropped=dropped, drop_rate=drop_rate,
        ))
    return funnel_steps
