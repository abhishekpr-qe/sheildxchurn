from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScreenEvent:
    distinct_id: str
    screen_name: str
    timestamp: int


@dataclass(frozen=True)
class Session:
    distinct_id: str
    events: tuple[ScreenEvent, ...]
    last_screen: str


@dataclass(frozen=True)
class FunnelStep:
    name: str
    entered: int
    dropped: int
    drop_rate: float


@dataclass(frozen=True)
class FunnelResult:
    name: str
    steps: tuple[FunnelStep, ...]
    total_entered: int
    total_completed: int
    completion_rate: float


@dataclass(frozen=True)
class DropOff:
    screen_name: str
    count: int
    percentage: float


@dataclass(frozen=True)
class FunnelConfig:
    name: str
    steps: tuple[str, ...] = field(default_factory=tuple)
