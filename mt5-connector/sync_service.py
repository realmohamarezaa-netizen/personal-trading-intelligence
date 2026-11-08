#!/usr/bin/env python3
"""Bundled background sync service for the Personal Trading Intelligence
desktop app (Windows).

Started automatically by the dashboard's "Connect MT5" button / on app launch.
Runs an endless read-only sync loop against the local dashboard and exits by
itself once the dashboard is closed (health endpoint unreachable N times).

Every cycle re-imports the sync core and re-initializes the MT5 connection,
so transient problems (terminal starting up, connector package hiccup) are
retried forever instead of silently killing the service. Anything that goes
wrong is printed to the log file the dashboard shows in Settings → MT5
Connector → Diagnostics.

Read-only: this service never places, modifies or closes any order.

Usage (managed by the desktop app):
    python.exe sync_service.py --api http://127.0.0.1:3517 --days 365 --interval 45
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.request
from datetime import datetime
from typing import Optional

# NOTE: deliberately NO top-level `import sync` / `import MetaTrader5` here —
# if the native MetaTrader5 package cannot load, the service must stay alive
# and report the reason every cycle instead of dying silently at startup.

# The embeddable Python runtime (python312._pth) runs in ISOLATED mode:
# sys.path holds only what is listed in the ._pth file and the script's own
# directory is never prepended (unlike a normal python install). `sync.py`
# sits next to this file, so add that folder to sys.path explicitly —
# otherwise `from sync import run_sync` fails with ModuleNotFoundError on
# every cycle while MetaTrader5/requests (site-packages) import fine.
_CONNECTOR_DIR = os.path.dirname(os.path.abspath(__file__))
if _CONNECTOR_DIR not in sys.path:
    sys.path.insert(0, _CONNECTOR_DIR)


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _err(msg: str) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] ERROR: {msg}", file=sys.stderr, flush=True)


def build_service_args(api: str, days: int, token: Optional[str] = None) -> argparse.Namespace:
    """An argparse.Namespace shaped exactly like sync.py's parse_args output."""
    ns = argparse.Namespace()
    ns.api = api
    ns.days = days
    ns.login = None
    ns.password = None
    ns.server = None
    ns.token = token
    ns.watch = None
    ns.test = False
    return ns


def api_alive(api: str) -> bool:
    """True when the dashboard answers its /api/health endpoint (stdlib only —
    must work even if the requests package itself failed to import)."""
    try:
        req = urllib.request.Request(api.rstrip("/") + "/api/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
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
        "--token", default=None,
        help="Sync token issued by the dashboard (sent as X-PTI-Token)",
    )
    parser.add_argument(
        "--max-down", type=int, default=3,
        help="Exit after the dashboard health check fails this many times in a row",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    opts = parse_service_args(argv)
    args = build_service_args(opts.api, opts.days, opts.token)
    _log(
        f"MT5 sync service started (pid {os.getpid()}) — api={opts.api} "
        f"interval={opts.interval:g}s history={opts.days}d "
        f"auth={'token' if opts.token else 'none'} "
        f"python={sys.version.split()[0]} (read-only, exits when the dashboard closes)"
    )

    down = 0
    first_cycle = True
    cycle = 0
    while True:
        if not first_cycle:
            time.sleep(opts.interval)
        first_cycle = False
        cycle += 1

        if api_alive(opts.api):
            down = 0
        else:
            down += 1
            if down >= opts.max_down:
                _log("Dashboard is closed — sync service exits. Bye!")
                return 0
            _log(f"dashboard unreachable ({down}/{opts.max_down}) — retrying next cycle")
            continue  # dashboard gone for now; retry after the next interval

        try:
            # Import INSIDE the loop: a failed module import is not cached by
            # Python, so a broken environment (e.g. the MetaTrader5 native
            # package) is retried — and loudly logged — every cycle instead
            # of killing the service silently at startup.
            from sync import run_sync

            ok = run_sync(args)
            if not ok:
                _log(f"cycle #{cycle}: sync did not complete — retrying next cycle")
        except ImportError as exc:
            _err(
                f"connector runtime problem on cycle #{cycle}: {exc!r} — "
                "the bundled Python runtime looks damaged; reinstall the app. "
                "Will keep retrying."
            )
        except Exception as exc:  # one bad cycle must never kill the service
            _err(f"unexpected service error on cycle #{cycle}: {exc!r}")


if __name__ == "__main__":
    sys.exit(main())
