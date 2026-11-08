#!/usr/bin/env python3
"""MetaTrader5 constant provider for the PTI connector.

On Windows the real ``MetaTrader5`` package is imported. Everywhere else
(Linux dev machines, the automated test-suite) the package does not exist —
this shim then provides the documented constant values so that the pure
transformation logic in ``sync.py`` stays importable and unit-testable
without a terminal or a Windows machine.

Only constants that the connector's PURE code needs are mirrored here.
Values follow the official MetaTrader5 Python package documentation;
the Windows runtime always uses the real package, so a hypothetical drift
in the fallback values can never affect production syncing.
"""

from __future__ import annotations

import sys
from typing import Any

try:  # real package (Windows production runtime)
    import MetaTrader5 as _mt5  # type: ignore

    HAVE_MT5 = True
except Exception:  # Linux dev / tests
    _mt5 = None
    HAVE_MT5 = False


class _FallbackConsts:
    """Documented MetaTrader5 package constants (fallback used only when the
    native package is unavailable)."""

    # TradeDeal.entry
    DEAL_ENTRY_IN = 0
    DEAL_ENTRY_OUT = 1
    DEAL_ENTRY_INOUT = 2
    DEAL_ENTRY_OUT_BY = 3

    # TradeDeal.type
    DEAL_TYPE_BUY = 0
    DEAL_TYPE_SELL = 1
    DEAL_TYPE_BALANCE = 2
    DEAL_TYPE_CREDIT = 3
    DEAL_TYPE_CHARGE = 4
    DEAL_TYPE_CORRECTION = 5
    DEAL_TYPE_BONUS = 6
    DEAL_TYPE_COMMISSION = 7
    DEAL_TYPE_COMMISSION_DAILY = 8
    DEAL_TYPE_COMMISSION_MONTHLY = 9
    DEAL_TYPE_COMMISSION_AGENT_DAILY = 10
    DEAL_TYPE_COMMISSION_AGENT_OVERNIGHT = 11
    DEAL_TYPE_COMMISSION_AGENT_MARKUP = 12
    DEAL_TYPE_INTEREST = 13
    DEAL_TYPE_BUY_CANCELED = 14
    DEAL_TYPE_SELL_CANCELED = 15
    DEAL_TYPE_DIVIDEND = 16
    DEAL_TYPE_DIVIDEND_FRANKED = 17
    DEAL_TYPE_TAX = 18

    # TradePosition.type
    POSITION_TYPE_BUY = 0
    POSITION_TYPE_SELL = 1

    # AccountInfo.trade_mode
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1
    ACCOUNT_TRADE_MODE_REAL = 2

    def __getattr__(self, name: str) -> Any:  # pragma: no cover
        raise AttributeError(
            f"MetaTrader5 constant {name!r} is not available: the native package "
            "is not installed on this machine (fine for tests — not for syncing)."
        )


mt5: Any = _mt5 if HAVE_MT5 else _FallbackConsts()


def deal_type_name(value: int) -> str:
    """Best-effort human name for a TradeDeal.type value (logs/diagnostics)."""
    for name in dir(mt5):
        if name.startswith("DEAL_TYPE_") and getattr(mt5, name) == value:
            return name.removeprefix("DEAL_TYPE_")
    return f"DEAL_TYPE_{value}"


if __name__ == "__main__":
    mode = "native MetaTrader5 package" if HAVE_MT5 else "fallback constants (no native package)"
    print(f"mt5_shim: using {mode}", file=sys.stderr)
