from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from rich.console import Console
from rich.table import Table

from churn.infra.config import load_config
from churn.service.analysis import AnalysisResult, run_analysis


def main():
    args = _parse_args()
    config = load_config(args.config, args.secret)
    result = run_analysis(config)

    if args.format == "json":
        _print_json(result)
    else:
        _print_rich(result)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ShieldXChurn — Mixpanel churn analysis")
    parser.add_argument("--config", default="config.yaml", help="Path to config YAML")
    parser.add_argument("--secret", default="key", help="Path to API secret file")
    parser.add_argument("--format", choices=["table", "json"], default="table", help="Output format")
    return parser.parse_args()


def _print_json(result: AnalysisResult):
    print(json.dumps(asdict(result), indent=2))


def _print_rich(result: AnalysisResult):
    console = Console()

    console.print(f"\n[bold]Events:[/bold] {result.total_events}  "
                  f"[bold]Sessions:[/bold] {result.total_sessions}\n")

    for funnel in result.funnel_results:
        table = Table(title=f"Funnel: {funnel.name}")
        table.add_column("Step", style="cyan")
        table.add_column("Entered", justify="right")
        table.add_column("Dropped", justify="right", style="red")
        table.add_column("Drop Rate", justify="right")

        for step in funnel.steps:
            table.add_row(step.name, str(step.entered), str(step.dropped), f"{step.drop_rate}%")

        table.add_section()
        table.add_row(
            "[bold]Total[/bold]",
            str(funnel.total_entered),
            str(funnel.total_entered - funnel.total_completed),
            f"{100 - funnel.completion_rate}%",
        )
        console.print(table)
        console.print()

    if result.drop_offs:
        drop_table = Table(title="Last Screen Drop-Off")
        drop_table.add_column("Screen", style="cyan")
        drop_table.add_column("Count", justify="right")
        drop_table.add_column("% of Sessions", justify="right")

        for drop in result.drop_offs:
            drop_table.add_row(drop.screen_name, str(drop.count), f"{drop.percentage}%")

        console.print(drop_table)


if __name__ == "__main__":
    main()
