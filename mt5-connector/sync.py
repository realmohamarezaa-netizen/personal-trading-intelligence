#!/usr/bin/env python3
"""MT5 -> Dashboard sync connector for the "Personal Trading Intelligence" platform.

Reads account info, open positions and dealing history from a locally running
MetaTrader 5 terminal (Windows) via the official ``MetaTrader5`` package,
merges raw deals into per-position trades, and POSTs them to the dashboard's
local sync API (``/api/mt5/sync``).

Usage:
    python sync.py --test                       # connect, print summary, send nothing
    python sync.py --days 180                   # one-shot sync of the last 180 days
    python sync.py --watch 60                   # keep syncing every 60 seconds
    python sync.py --login 12345 --password secret --server "Broker-Server"

Read-only. This script never places, modifies or closes orders.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Sequence

import requests
import MetaTrader5 as mt5

SYNC_PATH = "/api/mt5/sync"

# Deal entries that realize money (close / reduce / reverse the position).
# DEAL_ENTRY_INOUT (reversal) is deliberately included: a reversal closes the
# previous leg and books its profit, so it must count as a closing deal.
CLOSING_ENTRIES = frozenset(
    {mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY, mt5.DEAL_ENTRY_INOUT}
)
# Balance-style deals are cash movements, not trades -> reported as cashflows.
CASHFLOW_DEAL_TYPES = frozenset({mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CREDIT})


# ─────────────────────────────── Data models ─────────────────────────────────
@dataclass
class AccountPayload:
    """Account section of the sync payload (matches the API's SyncBody.account)."""

    name: str
    broker: str
    server: str
    login: Any  # int account number; the API stores it as a string
    currency: str
    leverage: int


@dataclass
class TradeRecord:
    """One merged position = one trade file (matches the API's SyncTrade)."""

    positionId: int
    symbol: str
    direction: str  # "BUY" | "SELL"
    volume: float
    openTime: str  # ISO-8601 UTC, ends with "Z"
    closeTime: Optional[str] = None
    openPrice: float = 0.0
    closePrice: Optional[float] = None
    stopLoss: Optional[float] = None
    takeProfit: Optional[float] = None
    commission: float = 0.0
    swap: float = 0.0
    profit: float = 0.0
    netProfit: float = 0.0
    pips: Optional[float] = None
    rMultiple: Optional[float] = None
    holdingMinutes: Optional[int] = None
    status: str = "OPEN"  # "OPEN" | "CLOSED"


@dataclass
class Cashflow:
    """Deposit / withdrawal distilled from balance & credit deals."""

    ts: str  # ISO-8601 UTC, ends with "Z"
    type: str  # "DEPOSIT" | "WITHDRAWAL"
    amount: float  # always positive; direction is encoded in `type`
    comment: Optional[str] = None


# ─────────────────────────────── Small helpers ───────────────────────────────
def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _err(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR: {msg}", file=sys.stderr, flush=True)


def _num(value: Any, default: float = 0.0) -> float:
    """Defensive float conversion — MT5 namedtuples occasionally carry None."""
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _from_epoch(seconds: Any) -> datetime:
    """MT5 epoch seconds -> timezone-aware UTC datetime."""
    return datetime.fromtimestamp(int(seconds or 0), tz=timezone.utc)


def _iso_z(dt: datetime) -> str:
    """Timezone-aware datetime -> ISO-8601 string ending in 'Z'."""
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _vwap(deals: Sequence[Any]) -> Optional[float]:
    """Volume-weighted average price of a deal list (None when no volume)."""
    volume = sum(_num(d.volume) for d in deals)
    if volume <= 0.0:
        return None
    notional = sum(_num(d.price) * _num(d.volume) for d in deals)
    return notional / volume


# ──────────────────────── Deal merging (history -> trades) ───────────────────
def _build_trade_from_group(position_id: int, group: Sequence[Any]) -> TradeRecord:
    """Merge all deals of one MT5 position into a single trade record."""
    in_deals = [d for d in group if int(d.entry) == mt5.DEAL_ENTRY_IN]
    out_deals = [d for d in group if int(d.entry) in CLOSING_ENTRIES]

    # Direction comes from the first IN deal. If the position was opened before
    # the history window there is no IN deal — infer direction from the first
    # closing deal instead (a closing deal is traded in the OPPOSITE direction).
    if in_deals:
        direction = "BUY" if int(in_deals[0].type) == mt5.DEAL_TYPE_BUY else "SELL"
        open_time = _from_epoch(in_deals[0].time)
    elif out_deals:
        direction = "SELL" if int(out_deals[0].type) == mt5.DEAL_TYPE_BUY else "BUY"
        open_time = _from_epoch(min(int(d.time) for d in group))
    else:  # unreachable in practice; keep something sane
        direction, open_time = "BUY", _from_epoch(min(int(d.time) for d in group))

    open_price = _vwap(in_deals)
    if open_price is None:  # opened before the window: fall back to exit prices
        open_price = _vwap(out_deals) or 0.0

    close_price = _vwap(out_deals)
    close_time = _from_epoch(max(int(d.time) for d in out_deals)) if out_deals else None

    commission = sum(_num(d.commission) for d in group)  # ALL deals: IN + OUT
    swap = sum(_num(d.swap) for d in group)
    # Realized P/L books on closing deals only (IN deals carry profit 0.0).
    profit = sum(_num(d.profit) for d in out_deals)

    holding_minutes: Optional[int] = None
    if close_time is not None:
        holding_minutes = max(0, int((close_time - open_time).total_seconds() // 60))

    in_volume = sum(_num(d.volume) for d in in_deals)
    volume = in_volume if in_deals else sum(_num(d.volume) for d in out_deals)
    symbol = next((str(d.symbol) for d in group if d.symbol), "")

    return TradeRecord(
        positionId=position_id,
        symbol=symbol,
        direction=direction,
        volume=round(volume, 8),
        openTime=_iso_z(open_time),
        closeTime=_iso_z(close_time) if close_time else None,
        openPrice=round(open_price, 8),
        closePrice=round(close_price, 8) if close_price is not None else None,
        # Stops are not stored on deals; open positions already carry them.
        stopLoss=None,
        takeProfit=None,
        commission=commission,
        swap=swap,
        profit=profit,
        netProfit=profit + commission + swap,
        pips=None,
        rMultiple=None,
        holdingMinutes=holding_minutes,
        status="CLOSED" if out_deals else "OPEN",
    )


def merge_history_deals(
    deals: Sequence[Any],
) -> tuple[dict[int, TradeRecord], list[Cashflow], int]:
    """Group raw deals by ``position_id`` and build one record per position.

    Balance/credit deals are routed to cashflows instead. Returns
    ``(records_by_position_id, cashflows, skipped_count)``.
    """
    groups: dict[int, list[Any]] = {}
    cashflows: list[Cashflow] = []
    skipped = 0

    for deal in deals:
        try:
            deal_type = int(deal.type)
            if deal_type in CASHFLOW_DEAL_TYPES:
                profit = _num(deal.profit)
                cashflows.append(
                    Cashflow(
                        ts=_iso_z(_from_epoch(deal.time)),
                        type="DEPOSIT" if profit >= 0 else "WITHDRAWAL",
                        amount=abs(profit),
                        comment=deal.comment or None,
                    )
                )
                continue
            if deal_type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
                continue  # charge/correction/bonus/... are not position deals
            position_id = int(deal.position_id)
            if position_id <= 0:  # defensive: trade deals always have a position
                continue
            groups.setdefault(position_id, []).append(deal)
        except Exception as exc:  # one bad deal must never kill the sync
            skipped += 1
            _err(f"skipping malformed deal {getattr(deal, 'ticket', '?')}: {exc}")

    records: dict[int, TradeRecord] = {}
    for position_id, group in groups.items():
        try:
            records[position_id] = _build_trade_from_group(position_id, group)
        except Exception as exc:
            skipped += 1
            _err(f"skipping position {position_id}: {exc}")

    return records, cashflows, skipped


def _build_trade_from_position(position: Any, hist_commission: Optional[float]) -> TradeRecord:
    """Build an OPEN trade record from a live position (positions_get).

    ``commission`` defaults to the 0.0 estimate, but when the position's deals
    are inside the history window we use the real summed commission instead —
    actual data beats an estimate.
    """
    direction = "BUY" if int(position.type) == mt5.POSITION_TYPE_BUY else "SELL"
    profit = _num(position.profit)
    swap = _num(position.swap)
    commission = round(hist_commission, 2) if hist_commission is not None else 0.0
    # MT5 reports 0.0 when no stop is set — normalize that to null.
    stop_loss = _num(position.sl) if position.sl else None
    take_profit = _num(position.tp) if position.tp else None

    return TradeRecord(
        positionId=int(position.ticket),
        symbol=str(position.symbol or ""),
        direction=direction,
        volume=round(_num(position.volume), 8),
        openTime=_iso_z(_from_epoch(position.time)),
        closeTime=None,
        openPrice=round(_num(position.price_open), 8),
        closePrice=None,
        stopLoss=round(stop_loss, 8) if stop_loss is not None else None,
        takeProfit=round(take_profit, 8) if take_profit is not None else None,
        commission=commission,
        swap=swap,
        profit=profit,
        netProfit=profit + commission + swap,
        pips=None,
        rMultiple=None,
        holdingMinutes=None,
        status="OPEN",
    )


# ──────────────────────────────── Connection ─────────────────────────────────
def _ensure_login(args: argparse.Namespace) -> bool:
    """Optionally log in via mt5.login(); True when the terminal is ready."""
    if args.login is None and args.password is None:
        if args.server:
            _log("--server given without --login/--password — assuming the terminal is already logged in")
        return True  # assume the terminal is already logged in
    if args.login is None or not args.password:
        _err("--login and --password must be provided together for mt5.login()")
        return False
    kwargs: dict[str, Any] = {"login": int(args.login), "password": args.password}
    if args.server:
        kwargs["server"] = args.server
    if not mt5.login(**kwargs):
        code, desc = mt5.last_error()
        _err(f"mt5.login() failed: ({code}) {desc}")
        return False
    _log(f"Logged in to account {args.login}" + (f" on {args.server}" if args.server else ""))
    return True


def _print_test_summary(
    account: AccountPayload,
    info: Any,
    deal_count: int,
    position_count: int,
    merged_count: int,
    cashflow_count: int,
    skipped: int,
) -> None:
    _log("── --test mode: connection OK, nothing will be sent ──")
    _log(f"Account : {account.name} | broker: {account.broker} | server: {account.server}")
    _log(f"          login {account.login} | currency {account.currency} | leverage 1:{account.leverage}")
    _log(f"Balance : {_num(info.balance):.2f} {account.currency} | equity: {_num(info.equity):.2f}")
    _log(f"Open positions        : {position_count}")
    _log(f"History deals fetched : {deal_count}")
    _log(f"Merged position groups: {merged_count} | cashflow entries: {cashflow_count}")
    if skipped:
        _log(f"Skipped malformed records: {skipped}")


# ──────────────────────────────── Sync cycle ─────────────────────────────────
def run_sync(args: argparse.Namespace) -> bool:
    """One full connect -> collect -> (maybe) POST cycle. Returns success."""
    if not mt5.initialize():
        code, desc = mt5.last_error()
        _err(
            f"mt5.initialize() failed: ({code}) {desc} — "
            "make sure the MetaTrader 5 terminal is running and logged in"
        )
        return False
    try:
        if not _ensure_login(args):
            return False

        info = mt5.account_info()
        if info is None:
            code, desc = mt5.last_error()
            _err(f"account_info() failed: ({code}) {desc} — is the terminal logged in?")
            return False

        # `company` lives on terminal_info() in most package versions; use it
        # as a fallback so `broker` is never None.
        terminal = mt5.terminal_info()
        broker = (
            getattr(info, "company", None)
            or getattr(terminal, "company", None)
            or "Unknown"
        )
        account = AccountPayload(
            name=f"MT5 {info.login}",
            broker=str(broker),
            server=str(info.server or "Unknown"),
            login=info.login,
            currency=str(info.currency or "USD"),
            leverage=int(info.leverage or 0),
        )

        # ── Open positions (live) ────────────────────────────────────────────
        positions_raw = mt5.positions_get()
        if positions_raw is None:
            code, desc = mt5.last_error()
            _err(f"positions_get() failed: ({code}) {desc} — continuing without open positions")
            positions_raw = []

        # ── Dealing history ──────────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        date_from = now - timedelta(days=args.days)
        deals_raw = mt5.history_deals_get(date_from, now)
        if deals_raw is None:
            code, desc = mt5.last_error()
            _err(f"history_deals_get() failed: ({code}) {desc} — continuing without history")
            deals_raw = []

        merged, cashflows, skipped = merge_history_deals(deals_raw)
        live_ids = {int(p.ticket) for p in positions_raw}

        # Live positions win over their history group: the dashboard keys trades
        # by positionId, so emitting both (e.g. for a partially-closed position)
        # would produce two records with the same key. The live record carries
        # current profit/SL/TP; its commission is enriched from the deals.
        trades: list[TradeRecord] = []
        for position in positions_raw:
            try:
                pid = int(position.ticket)
                hist_commission = merged[pid].commission if pid in merged else None
                trades.append(_build_trade_from_position(position, hist_commission))
            except Exception as exc:
                skipped += 1
                _err(f"skipping open position {getattr(position, 'ticket', '?')}: {exc}")
        for pid, record in merged.items():
            if pid in live_ids:
                continue  # superseded by the live position above
            trades.append(record)

        open_count = sum(1 for t in trades if t.status == "OPEN")
        closed_count = len(trades) - open_count
        snapshot = {"balance": _num(info.balance), "equity": _num(info.equity)}

        if args.test:
            _print_test_summary(
                account, info, len(deals_raw), len(positions_raw), len(merged),
                len(cashflows), skipped,
            )
            return True

        # ── POST to the dashboard ────────────────────────────────────────────
        payload = {
            "account": asdict(account),
            "trades": [asdict(t) for t in trades],
            "cashflows": [asdict(c) for c in cashflows],
            "snapshot": snapshot,
        }
        url = args.api.rstrip("/") + SYNC_PATH
        _log(
            f"POST {len(trades)} trades ({open_count} open / {closed_count} closed), "
            f"{len(cashflows)} cashflows -> {url}"
        )
        try:
            response = requests.post(url, json=payload, timeout=30)
        except requests.RequestException as exc:
            _err(f"request failed: {exc} — is the dashboard running at {args.api}?")
            return False
        if response.status_code != 200:
            _err(
                f"sync API returned HTTP {response.status_code}: {response.text[:500]}"
            )
            return False
        try:
            result = response.json()
        except ValueError:
            _err(f"sync API returned non-JSON response: {response.text[:200]}")
            return False

        _log(
            f"Sync complete: inserted={result.get('inserted')} "
            f"updated={result.get('updated')} total={result.get('total')} "
            f"cashflowsAdded={result.get('cashflowsAdded')}"
        )
        if skipped:
            _log(f"Note: {skipped} malformed record(s) were skipped.")
        return True

    except Exception as exc:  # never let one bad cycle kill --watch mode
        _err(f"unexpected error during sync: {exc!r}")
        return False
    finally:
        mt5.shutdown()


# ─────────────────────────────────── CLI ─────────────────────────────────────
def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only MetaTrader 5 -> dashboard sync connector. "
            "Never places, modifies or closes orders."
        )
    )
    parser.add_argument(
        "--api", default="http://127.0.0.1:3000",
        help="Dashboard base URL (default: %(default)s)",
    )
    parser.add_argument(
        "--days", type=int, default=365,
        help="History depth in days (default: %(default)s)",
    )
    parser.add_argument(
        "--login", type=int, default=None,
        help="MT5 account number (optional, use together with --password)",
    )
    parser.add_argument(
        "--password", default=None,
        help="MT5 account password (optional, use together with --login)",
    )
    parser.add_argument(
        "--server", default=None,
        help="MT5 server name, e.g. 'BrokerLive-Server' (optional)",
    )
    parser.add_argument(
        "--watch", type=float, default=None, metavar="SECONDS",
        help="Sync every N seconds forever (default: single run)",
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Connect and print a summary; do NOT POST anything",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if args.days < 0:
        _err("--days must be >= 0")
        return 1
    if args.watch is not None and args.watch <= 0:
        _err("--watch must be a positive number of seconds")
        return 1

    if args.watch is not None:
        _log(f"Watch mode: syncing every {args.watch:g}s. Press Ctrl+C to stop.")
        try:
            while True:
                run_sync(args)  # re-initializes each cycle -> survives terminal restarts
                time.sleep(args.watch)
        except KeyboardInterrupt:
            _log("Watch mode stopped by user.")
        return 0

    return 0 if run_sync(args) else 1


if __name__ == "__main__":
    sys.exit(main())
