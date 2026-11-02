#!/usr/bin/env python3
"""Bundled background sync service for the Personal Trading Intelligence
desktop app (Windows).

Started automatically by the dashboard's "Connect MT5" button / on app launch.
Runs an endless read-only sync loop against the local dashboard and exits by
itself once the dashboard is closed (health endpoint unreachable N times).

Read-only: this service never places, modifies or closes any order.

Usage (managed by the desktop app):
    python.exe sync_service.py --api http://127.0.0.1:3517 --days 365 --interval 45
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Optional

import requests

from sync import _log, _err, run_sync, parse_args  # reuse the battle-tested core


def build_service_args(api: str, days: int) -> argparse.Namespace:
    """An argparse.Namespace shaped exactly like sync.py's parse_args output."""
    ns = argparse.Namespace()
    ns.api = api
    ns.days = days
    ns.login = None
    ns.password = None
    ns.server = None
    ns.watch = None
    ns.test = False
    return ns


def api_alive(api: str) -> bool:
    """True when the dashboard answers its /api/health endpoint."""
    try:
        response = requests.get(api.rstrip("/") + "/api/health", timeout=5)
        return response.status_code == 200
    except Exception:
        return False


def parse_service_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bundled read-only MT5 -> dashboard sync service."
    )
    parser.add_argument(
        "--api", default="http://127.0.0.1:3000",
        help="Dashboard base URL (default: %(default)s)",
    )
    parser.add_argument("--days", type=int, default=365, help="History depth in days")
    parser.add_argument(
        "--interval", type=float, default=45.0, help="Seconds between sync cycles"
    )
    parser.add_argument(
        "--max-down", type=int, default=3,
        help="Exit after the dashboard health check fails this many times in a row",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    opts = parse_service_args(argv)
    args = build_service_args(opts.api, opts.days)
    _log(
        f"MT5 sync service started — api={opts.api} interval={opts.interval:g}s "
        f"history={opts.days}d (read-only, exits when the dashboard closes)"
    )

    down = 0
    first_cycle = True
    while True:
        if not first_cycle:
            time.sleep(opts.interval)
        first_cycle = False

        if api_alive(opts.api):
            down = 0
        else:
            down += 1
            if down >= opts.max_down:
                _log("Dashboard is closed — sync service exits. Bye!")
                return 0
            continue  # dashboard gone for now; retry after the next interval

        try:
            # run_sync() re-initializes the MT5 connection each cycle, so it
            # survives terminal restarts and "MT5 not open yet" states.
            run_sync(args)
        except Exception as exc:  # one bad cycle must never kill the service
            _err(f"unexpected service error: {exc!r}")


if __name__ == "__main__":
    sys.exit(main())
