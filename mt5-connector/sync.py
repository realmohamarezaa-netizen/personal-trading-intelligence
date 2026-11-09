#!/usr/bin/env python3
"""MT5 -> Dashboard sync connector for the "Personal Trading Intelligence" platform.

Reads account info, open positions and dealing history from a locally running
MetaTrader 5 terminal (Windows) via the official ``MetaTrader5`` package,
merges raw deals into per-deal trade legs, and POSTs them to the dashboard's
local sync API (``/api/mt5/sync``).

v1.3.0 semantics (matches prisma Trade model):
  * one record per CLOSING deal (partial closes become separate legs, each
    carrying its realized profit, allocated commission and swap) plus one
    live record per OPEN position (remaining volume, floating P/L);
  * full 64-bit MT5 tickets (positionTicket / dealTicket) — the legacy
    32-bit ``positionId`` is only filled when the ticket actually fits;
  * initial stop-loss + initial risk money from the ENTRY deal (never from
    the current/trailing SL), so R-Multiple is only produced when a real
    initial risk is known;
  * every non-trade deal type is preserved as a categorized cashflow
    (BALANCE/CREDIT/BONUS/CHARGE/COMMISSION/INTEREST/TAX/…), nothing is
    silently dropped;
  * positions opened before the history window are healed with
    ``history_deals_get(position=…)``; if the broker cannot restore the
    entry, the leg is flagged ``incompleteHistory`` instead of being
    silently mispriced;
  * the payload carries ``positionsRead`` — True only when ``positions_get()``
    actually succeeded — so the dashboard can treat the open-position set as
    authoritative and finalize stale OPEN rows it can no longer see.

Usage:
    python sync.py --test                       # connect, print summary, send nothing
    python sync.py --days 180                   # one-shot sync of the last 180 days
    python sync.py --watch 60                   # keep syncing every 60 seconds
    python sync.py --login 12345 --password secret --server "Broker-Server"
    python sync.py --token <PTI sync token>     # authenticate against the dashboard

Read-only. This script never places, modifies or closes orders.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Sequence

from mt5_shim import mt5, HAVE_MT5

SYNC_PATH = "/api/mt5/sync"

# Deal entries that realize money (close / reduce / reverse the position).
# DEAL_ENTRY_INOUT (reversal) is deliberately included: a reversal books the
# closed leg's profit on the reversal deal itself.
CLOSING_ENTRIES = frozenset(
    {mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY, mt5.DEAL_ENTRY_INOUT}
)

# Cashflow category per MT5 deal type name. Any deal type that is not a
# position trade (BUY/SELL) is PRESERVED as a cashflow row with one of these
# categories — unknown types fall back to "OTHER" so nothing disappears.
_CASHFLOW_CATEGORY_BY_NAME = {
    "BALANCE": "BALANCE",
    "CREDIT": "CREDIT",
    "CHARGE": "CHARGE",
    "CORRECTION": "CORRECTION",
    "BONUS": "BONUS",
    "COMMISSION": "COMMISSION",
    "COMMISSION_DAILY": "COMMISSION",
    "COMMISSION_MONTHLY": "COMMISSION",
    "COMMISSION_AGENT_DAILY": "COMMISSION",
    "COMMISSION_AGENT_OVERNIGHT": "COMMISSION",
    "COMMISSION_AGENT_MARKUP": "COMMISSION",
    "INTEREST": "INTEREST",
    "TAX": "TAX",
    "DIVIDEND": "DIVIDEND",
    "DIVIDEND_FRANKED": "DIVIDEND",
}

# Maximum positions whose full deal history we request per cycle to heal
# pre-window entries (bounded latency for the 45s watch loop).
MAX_HEAL_PER_CYCLE = 150

# Marker comment identifying reversed-position stub rows. MUST match
# REVERSAL_MARKER in src/lib/mt5-sync.ts — the dashboard upserts these rows
# keyed on this exact comment.
REVERSAL_MARKER = "reversed — P/L booked on the reversal deal"


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
    tradeMode: str = "REAL"  # REAL | DEMO | CONTEST (from account_info().trade_mode)


@dataclass
class TradeRecord:
    """One sync unit: a closing-deal leg or a live open position.

    Matches the API's SyncTrade schema (see src/app/api/mt5/sync route).
    """

    symbol: str
    direction: str  # "BUY" | "SELL"
    volume: float
    openTime: str  # ISO-8601 UTC, ends with "Z"
    openPrice: float
    status: str  # "OPEN" | "CLOSED"
    # 64-bit identifiers (JSON ints — MT5 tickets stay far below 2^53)
    positionTicket: Optional[int] = None
    dealTicket: Optional[int] = None
    # legacy 32-bit ticket, only when it truly fits
    positionId: Optional[int] = None
    closeTime: Optional[str] = None
    closePrice: Optional[float] = None
    stopLoss: Optional[float] = None
    takeProfit: Optional[float] = None
    initialStopLoss: Optional[float] = None
    riskAmount: Optional[float] = None
    commission: float = 0.0
    swap: float = 0.0
    profit: float = 0.0
    netProfit: float = 0.0
    pips: Optional[float] = None
    rMultiple: Optional[float] = None
    holdingMinutes: Optional[int] = None
    magicNumber: Optional[int] = None
    mt5Comment: Optional[str] = None
    incompleteHistory: bool = False


@dataclass
class Cashflow:
    """One non-trade MT5 deal, preserved with its category and ticket."""

    ts: str  # ISO-8601 UTC, ends with "Z"
    type: str  # "DEPOSIT" | "WITHDRAWAL" (polarity; amount always positive)
    amount: float
    category: str = "BALANCE"  # BALANCE|CREDIT|BONUS|CHARGE|COMMISSION|INTEREST|TAX|CORRECTION|DIVIDEND|OTHER
    externalId: Optional[int] = None  # MT5 deal ticket
    comment: Optional[str] = None


@dataclass
class SymbolSpec:
    """Everything needed to compute pips and money risk for one symbol."""

    digits: int = 0
    point: float = 0.0
    tick_size: float = 0.0
    tick_value: float = 0.0  # value of one tick of one lot, in ACCOUNT currency

    @property
    def pip_size(self) -> float:
        # Standard FX convention: on 5- and 3-digit symbols a pip is 10 points.
        return self.point * 10 if self.digits in (3, 5) else self.point

    @property
    def usable(self) -> bool:
        return self.point > 0 and self.tick_size > 0 and self.tick_value > 0


@dataclass
class PositionMeta:
    """Entry-side facts of one MT5 position, distilled from its deals."""

    position_id: int
    symbol: str = ""
    direction: str = "BUY"
    entry_vwap: float = 0.0
    entry_time: Optional[datetime] = None
    initial_sl: Optional[float] = None
    total_in_volume: float = 0.0
    in_commission: float = 0.0
    magic: Optional[int] = None
    comment: Optional[str] = None
    has_entry: bool = False  # an IN deal was seen (possibly after healing)

    @property
    def risk_total(self) -> Optional[float]:
        """Initial money risk of the WHOLE position (needs specs + initial SL)."""
        return None  # filled by the caller that owns the symbol specs


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


def _ticket_int(value: Any) -> Optional[int]:
    """64-bit-safe ticket conversion (None when absent/invalid)."""
    try:
        iv = int(value or 0)
        return iv if iv > 0 else None
    except (TypeError, ValueError):
        return None


def _legacy_32bit(ticket: Optional[int]) -> Optional[int]:
    """Return the ticket as a legacy 32-bit int when (and only when) it fits."""
    if ticket is None or ticket > 2_147_483_647:
        return None
    return ticket


def _vwap(deals: Sequence[Any]) -> Optional[float]:
    """Volume-weighted average price of a deal list (None when no volume)."""
    volume = sum(_num(d.volume) for d in deals)
    if volume <= 0.0:
        return None
    notional = sum(_num(d.price) * _num(d.volume) for d in deals)
    return notional / volume


def _cashflow_category(deal_type: int) -> str:
    name = getattr(mt5, "DEAL_TYPE_BALANCE", 2)  # anchor lookup class
    # Map the numeric type back to its MT5 constant name, then to a category.
    for const_name in dir(mt5):
        if const_name.startswith("DEAL_TYPE_"):
            try:
                if int(getattr(mt5, const_name)) == int(deal_type):
                    return _CASHFLOW_CATEGORY_BY_NAME.get(
                        const_name.removeprefix("DEAL_TYPE_"), "OTHER"
                    )
            except (TypeError, ValueError):
                continue
    return "OTHER"


# ──────────────────────── Deal merging (history -> legs) ─────────────────────
@dataclass
class MergeResult:
    legs: list[TradeRecord] = field(default_factory=list)          # closed legs
    meta: dict[int, PositionMeta] = field(default_factory=dict)    # entry facts per position
    cashflows: list[Cashflow] = field(default_factory=list)
    skipped: int = 0
    positions_without_entry: list[int] = field(default_factory=list)


def _build_meta(position_id: int, group: Sequence[Any], specs: dict[str, SymbolSpec]) -> PositionMeta:
    in_deals = [d for d in group if int(d.entry) == mt5.DEAL_ENTRY_IN]
    meta = PositionMeta(position_id=position_id)
    meta.symbol = next((str(d.symbol) for d in group if d.symbol), "")
    meta.total_in_volume = sum(_num(d.volume) for d in in_deals)
    meta.in_commission = sum(_num(d.commission) for d in in_deals)

    if in_deals:
        first = in_deals[0]
        meta.direction = "BUY" if int(first.type) == mt5.DEAL_TYPE_BUY else "SELL"
        meta.entry_time = _from_epoch(first.time)
        meta.entry_vwap = _vwap(in_deals) or 0.0
        meta.has_entry = True
        # The IN deal's SL field holds the stop registered AT ENTRY — this is
        # the true initial risk anchor (a later trailing stop never changes it).
        sl = _num(first.sl) if getattr(first, "sl", None) else 0.0
        meta.initial_sl = round(sl, 8) if sl > 0 else None
    else:
        # Opened before the history window — the caller may heal this.
        meta.direction = "BUY"  # refined by caller from closing deals
        meta.entry_time = _from_epoch(min(int(d.time) for d in group))
        meta.entry_vwap = 0.0
        meta.has_entry = False

    magics = [int(d.magic) for d in group if getattr(d, "magic", None)]
    meta.magic = magics[0] if magics else None
    comments = [str(d.comment) for d in group if getattr(d, "comment", None)]
    meta.comment = comments[0] if comments else None
    return meta


def _risk_money(entry: float, initial_sl: Optional[float], volume: float, spec: Optional[SymbolSpec]) -> Optional[float]:
    """Initial money risk for the given volume, in account currency."""
    if initial_sl is None or entry <= 0 or spec is None or not spec.usable:
        return None
    ticks = abs(entry - initial_sl) / spec.tick_size
    if ticks <= 0:
        return None
    return ticks * spec.tick_value * volume


def _leg_pips(entry: float, exit_price: float, direction: str, spec: Optional[SymbolSpec]) -> Optional[float]:
    if spec is None or spec.pip_size <= 0 or entry <= 0 or exit_price <= 0:
        return None
    diff = exit_price - entry
    return round((diff if direction == "BUY" else -diff) / spec.pip_size, 1)


def merge_history_deals(
    deals: Sequence[Any],
    specs: Optional[dict[str, SymbolSpec]] = None,
) -> MergeResult:
    """Group raw deals by ``position_id`` and build one record per closing deal.

    Balance/credit/commission/interest/… deals are routed to categorized
    cashflows instead — never dropped. Returns a :class:`MergeResult`.
    """
    specs = specs or {}
    result = MergeResult()
    groups: dict[int, list[Any]] = {}

    for deal in deals:
        try:
            deal_type = int(deal.type)
            if deal_type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL):
                position_id = _ticket_int(getattr(deal, "position_id", 0))
                if position_id is None:
                    result.skipped += 1
                    _err(f"skipping trade deal without position_id (ticket {_ticket_int(getattr(deal, 'ticket', 0))})")
                    continue
                groups.setdefault(position_id, []).append(deal)
                continue
            # ── Non-trade deal types: preserved as categorized cashflows ──
            profit = _num(deal.profit)
            result.cashflows.append(
                Cashflow(
                    ts=_iso_z(_from_epoch(deal.time)),
                    type="DEPOSIT" if profit >= 0 else "WITHDRAWAL",
                    amount=round(abs(profit), 8),
                    category=_cashflow_category(deal_type),
                    externalId=_ticket_int(getattr(deal, "ticket", 0)),
                    comment=getattr(deal, "comment", None) or None,
                )
            )
        except Exception as exc:  # one bad deal must never kill the sync
            result.skipped += 1
            _err(f"skipping malformed deal {getattr(deal, 'ticket', '?')}: {exc}")

    # position_meta + legs
    live_out_cache: dict[int, list[Any]] = {}
    for position_id, group in groups.items():
        try:
            meta = _build_meta(position_id, group, specs)
            out_deals = [d for d in group if int(d.entry) in CLOSING_ENTRIES]
            live_out_cache[position_id] = out_deals

            if not meta.has_entry and out_deals:
                # Direction of a pre-window position: closing deals trade in
                # the OPPOSITE direction of the position itself.
                meta.direction = "SELL" if int(out_deals[0].type) == mt5.DEAL_TYPE_BUY else "BUY"
                meta.entry_vwap = _vwap(out_deals) or 0.0
                result.positions_without_entry.append(position_id)
            if not meta.has_entry and not out_deals:
                result.positions_without_entry.append(position_id)

            total_volume = meta.total_in_volume or sum(_num(d.volume) for d in out_deals)
            spec = specs.get(meta.symbol)
            risk_total = _risk_money(meta.entry_vwap, meta.initial_sl, total_volume, spec) if total_volume > 0 else None

            for out in out_deals:
                leg_volume = _num(out.volume)
                share = leg_volume / total_volume if total_volume > 0 else 0.0
                commission = _num(out.commission) + meta.in_commission * share
                swap = _num(out.swap)
                profit = _num(out.profit)
                net = profit + commission + swap
                leg_risk = risk_total * share if risk_total is not None else None
                close_time = _from_epoch(out.time)
                open_time = meta.entry_time or _from_epoch(min(int(d.time) for d in group))
                leg = TradeRecord(
                    symbol=meta.symbol,
                    direction=meta.direction,
                    volume=round(leg_volume, 8),
                    openTime=_iso_z(open_time),
                    openPrice=round(meta.entry_vwap, 8),
                    status="CLOSED",
                    positionTicket=_ticket_int(getattr(out, "position_id", position_id)),
                    dealTicket=_ticket_int(getattr(out, "ticket", 0)),
                    positionId=_legacy_32bit(position_id),
                    closeTime=_iso_z(close_time),
                    closePrice=round(_num(out.price), 8),
                    stopLoss=round(_num(out.sl), 8) if getattr(out, "sl", None) else None,
                    takeProfit=round(_num(out.tp), 8) if getattr(out, "tp", None) else None,
                    initialStopLoss=meta.initial_sl,
                    riskAmount=round(leg_risk, 2) if leg_risk else None,
                    commission=round(commission, 2),
                    swap=round(swap, 2),
                    profit=round(profit, 2),
                    netProfit=round(net, 2),
                    pips=_leg_pips(meta.entry_vwap, _num(out.price), meta.direction, spec),
                    rMultiple=round(net / leg_risk, 3) if leg_risk else None,
                    holdingMinutes=max(0, int((close_time - open_time).total_seconds() // 60)),
                    magicNumber=meta.magic,
                    mt5Comment=meta.comment,
                    # A reversed position keeps only its IN deals; its P/L is
                    # booked on the successor's INOUT deal. Keep an honest,
                    # money-neutral marker row instead of losing the position.
                    incompleteHistory=not meta.has_entry,
                )
                result.legs.append(leg)
            result.meta[position_id] = meta
        except Exception as exc:
            result.skipped += 1
            _err(f"skipping position {position_id}: {exc}")

    return result


def _build_open_trade(
    position: Any,
    meta: Optional[PositionMeta],
    specs: dict[str, SymbolSpec],
) -> TradeRecord:
    """Build the live OPEN record from a position (positions_get).

    ``commission`` is the entry commission share still owned by the remaining
    volume (the closed share already lives on the closing legs).
    """
    direction = "BUY" if int(position.type) == mt5.POSITION_TYPE_BUY else "SELL"
    volume = _num(position.volume)
    entry = _num(position.price_open)
    spec = specs.get(str(position.symbol or ""))
    # MT5 reports 0.0 when no stop is set — normalize that to null.
    current_sl = _num(position.sl) if position.sl else None
    current_tp = _num(position.tp) if position.tp else None

    # Initial risk: ONLY the stop registered at entry counts. If the entry
    # deal is known (history/heal) use its SL; the current SL may already be
    # trailing and must never silently become the risk anchor.
    initial_sl: Optional[float] = None
    in_commission = 0.0
    magic: Optional[int] = None
    comment: Optional[str] = None
    incomplete = False
    if meta is not None and meta.has_entry:
        initial_sl = meta.initial_sl
        total = meta.total_in_volume or volume
        in_commission = meta.in_commission * (volume / total) if total > 0 else 0.0
        magic = meta.magic
        comment = meta.comment
    else:
        incomplete = True  # entry deal unknown → no honest initial risk
        magic = int(position.magic) if getattr(position, "magic", None) else None
        comment = str(position.comment) if getattr(position, "comment", None) else None

    risk_total = _risk_money(entry, initial_sl, volume, spec)

    return TradeRecord(
        symbol=str(position.symbol or ""),
        direction=direction,
        volume=round(volume, 8),
        openTime=_iso_z(_from_epoch(position.time)),
        openPrice=round(entry, 8),
        status="OPEN",
        positionTicket=_ticket_int(position.ticket),
        dealTicket=None,
        positionId=_legacy_32bit(_ticket_int(position.ticket)),
        closeTime=None,
        closePrice=None,
        stopLoss=round(current_sl, 8) if current_sl is not None else None,
        takeProfit=round(current_tp, 8) if current_tp is not None else None,
        initialStopLoss=initial_sl,
        riskAmount=round(risk_total, 2) if risk_total else None,
        commission=round(in_commission, 2),
        swap=round(_num(position.swap), 2),
        profit=round(_num(position.profit), 2),
        netProfit=round(_num(position.profit) + _num(position.swap) + in_commission, 2),
        pips=None,
        rMultiple=None,  # floating R is not meaningful; R is computed on realized legs
        holdingMinutes=None,
        magicNumber=magic,
        mt5Comment=comment,
        incompleteHistory=incomplete,
    )


def load_symbol_specs(symbols: Sequence[str]) -> dict[str, SymbolSpec]:
    """Fetch tick/pip data for the given symbols (best effort, cached per call)."""
    out: dict[str, SymbolSpec] = {}
    for sym in dict.fromkeys(symbols):  # de-duplicated, order preserved
        if not sym:
            continue
        try:
            info = mt5.symbol_info(sym)
            if info is None and hasattr(mt5, "symbol_info_select"):
                info = mt5.symbol_info_select(sym)
            if info is None:
                continue
            spec = SymbolSpec(
                digits=int(getattr(info, "digits", 0) or 0),
                point=_num(getattr(info, "point", 0.0)),
                tick_size=_num(getattr(info, "trade_tick_size", 0.0)) or _num(getattr(info, "tick_size", 0.0)),
                tick_value=_num(getattr(info, "trade_tick_value", 0.0)) or _num(getattr(info, "tick_value", 0.0)),
            )
            if spec.point > 0:
                out[sym] = spec
        except Exception as exc:
            _err(f"symbol_info({sym}) failed: {exc}")
    return out


def _heal_missing_entries(
    missing: Sequence[int],
    specs: dict[str, SymbolSpec],
) -> tuple[dict[int, list[Any]], int]:
    """Fetch the FULL deal history of positions lacking their entry deal.

    MT5 can return every deal of a position regardless of the date window —
    this restores real entry time/price/initial-SL for trades opened before
    the sync window. Returns ``(deals_by_position, healed_count)``.
    """
    healed: dict[int, list[Any]] = {}
    for position_id in list(missing)[:MAX_HEAL_PER_CYCLE]:
        try:
            full = mt5.history_deals_get(position=position_id)
        except Exception as exc:
            _err(f"history_deals_get(position={position_id}) failed: {exc}")
            continue
        if full:
            healed[position_id] = list(full)
    if healed:
        _log(f"healed entry data for {len(healed)} position(s) opened before the sync window")
    return healed, len(healed)


# ──────────────────────────────── Connection ─────────────────────────────────
def build_reversal_stubs(
    merged: "MergeResult",
    live_ids: set,
    now: datetime,
) -> list[TradeRecord]:
    """Money-neutral marker rows for REVERSED positions.

    A reversal (DEAL_ENTRY_INOUT) books the closed leg's profit on the
    successor's deal, so the old position group keeps only its IN deals.
    Without a marker row that position would silently vanish from the journal;
    with it, realized money stays exact (stub profit = 0).
    """
    stubs: list[TradeRecord] = []
    for pid, meta in merged.meta.items():
        if pid in live_ids:
            continue
        if any(l.positionTicket == pid for l in merged.legs):
            continue
        group_time = meta.entry_time or now
        stubs.append(
            TradeRecord(
                symbol=meta.symbol,
                direction=meta.direction,
                volume=round(meta.total_in_volume, 8),
                openTime=_iso_z(group_time),
                openPrice=round(meta.entry_vwap, 8),
                status="CLOSED",
                positionTicket=_legacy_32bit(pid) or pid,
                dealTicket=None,
                positionId=_legacy_32bit(pid),
                closeTime=_iso_z(now),
                closePrice=round(meta.entry_vwap, 8),
                initialStopLoss=meta.initial_sl,
                commission=round(meta.in_commission, 2),
                profit=0.0,
                netProfit=round(-meta.in_commission, 2),
                magicNumber=meta.magic,
                mt5Comment=REVERSAL_MARKER,
                incompleteHistory=not meta.has_entry,
            )
        )
    return stubs


def _terminal_candidates() -> list[str]:
    """Common MetaTrader 5 terminal paths (portable / multi-terminal setups).
    The MetaTrader5 package normally locates the terminal via the registry —
    these fallbacks cover portable installs where that lookup fails."""
    import glob
    import os

    pats = [
        os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "MetaTrader 5*", "terminal64.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "MetaTrader 5*", "terminal64.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", r"C:\Users\x\AppData\Local"), "Programs", "MetaTrader 5*", "terminal64.exe"),
    ]
    out: list[str] = []
    for pat in pats:
        for exe in glob.glob(pat):
            low = exe.lower()
            if low not in {o.lower() for o in out}:
                out.append(exe)
    return out


def _initialize_mt5() -> bool:
    """mt5.initialize() with explicit-path fallbacks; logs the real reason."""
    if not HAVE_MT5:
        _err(
            "the MetaTrader5 package is not installed — the connector can only run "
            "on Windows with the bundled runtime (or: pip install MetaTrader5)"
        )
        return False
    if mt5.initialize():
        return True
    code, desc = mt5.last_error()
    for exe in _terminal_candidates():
        _log(f"plain initialize() failed ({code}) {desc} — trying explicit terminal path: {exe}")
        if mt5.initialize(path=exe):
            _log(f"attached to terminal: {exe}")
            return True
    _err(
        f"mt5.initialize() failed: ({code}) {desc} — open MetaTrader 5, "
        "log in to your account and keep the terminal running"
    )
    return False


def _ensure_login(args: argparse.Namespace) -> bool:
    """Optionally log in via mt5.login(); True when the terminal is ready.

    The password is never echoed or logged — errors only carry MT5's own
    numeric code and description.
    """
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
    leg_count: int,
    cashflow_count: int,
    skipped: int,
    incomplete: int,
) -> None:
    _log("── --test mode: connection OK, nothing will be sent ──")
    _log(f"Account : {account.name} | broker: {account.broker} | server: {account.server}")
    _log(f"          login {account.login} | currency {account.currency} | leverage 1:{account.leverage} | mode {account.tradeMode}")
    _log(f"Balance : {_num(info.balance):.2f} {account.currency} | equity: {_num(info.equity):.2f}")
    _log(f"Open positions        : {position_count}")
    _log(f"History deals fetched : {deal_count}")
    _log(f"Closed legs: {leg_count} | cashflow entries: {cashflow_count}")
    if incomplete:
        _log(f"Positions with incomplete entry history: {incomplete}")
    if skipped:
        _log(f"Skipped malformed records: {skipped}")


# ──────────────────────────────── Sync cycle ─────────────────────────────────
def run_sync(args: argparse.Namespace) -> bool:
    """One full connect -> collect -> (maybe) POST cycle. Returns success."""
    if not _initialize_mt5():
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
        trade_mode = int(getattr(info, "trade_mode", mt5.ACCOUNT_TRADE_MODE_REAL))
        mode_name = {
            int(mt5.ACCOUNT_TRADE_MODE_DEMO): "DEMO",
            int(mt5.ACCOUNT_TRADE_MODE_CONTEST): "CONTEST",
            int(mt5.ACCOUNT_TRADE_MODE_REAL): "REAL",
        }.get(trade_mode, "REAL")
        account = AccountPayload(
            name=f"MT5 {info.login}",
            broker=str(broker),
            server=str(info.server or "Unknown"),
            login=info.login,
            currency=str(info.currency or "USD"),
            leverage=int(info.leverage or 0),
            tradeMode=mode_name,
        )
        if mode_name == "DEMO":
            _log(f"connected to a DEMO account (login {info.login}) — its data stays fully separate from real accounts")

        # ── Open positions (live) ────────────────────────────────────────
        # positions_get() returning a tuple (possibly EMPTY) is the complete,
        # authoritative truth about what is open RIGHT NOW. None means the
        # read itself failed — the dashboard then must NOT reconcile its
        # OPEN rows against an empty set (that would close live positions).
        positions_read = False
        positions_raw = mt5.positions_get()
        if positions_raw is None:
            code, desc = mt5.last_error()
            _err(f"positions_get() failed: ({code}) {desc} — continuing without open positions")
            positions_raw = []
        else:
            positions_read = True

        # ── Dealing history ──────────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        date_from = now - timedelta(days=args.days)
        deals_raw = mt5.history_deals_get(date_from, now)
        if deals_raw is None:
            code, desc = mt5.last_error()
            _err(f"history_deals_get() failed: ({code}) {desc} — continuing without history")
            deals_raw = []
        deals_raw = list(deals_raw)

        specs = load_symbol_specs(
            [str(getattr(d, "symbol", "") or "") for d in deals_raw]
            + [str(getattr(p, "symbol", "") or "") for p in positions_raw]
        )

        merged = merge_history_deals(deals_raw, specs)

        # ── Heal pre-window entries (bounded per cycle) ─────────────────────
        if merged.positions_without_entry:
            healed_deals, healed_count = _heal_missing_entries(merged.positions_without_entry, specs)
            if healed_count:
                flat = [d for deals in healed_deals.values() for d in deals]
                healed = merge_history_deals(flat, specs)
                # healed merge supersedes the windowed view of those positions
                healed_ids = set(healed_deals.keys())
                merged.legs = [l for l in merged.legs if l.positionTicket not in healed_ids]
                merged.legs.extend(healed.legs)
                for pid, meta in healed.meta.items():
                    merged.meta[pid] = meta
                merged.cashflows.extend(
                    cf for cf in healed.cashflows
                    if cf.externalId is not None
                    and all(cf.externalId != old.externalId for old in merged.cashflows)
                )
                merged.positions_without_entry = [
                    p for p in merged.positions_without_entry if p not in healed_ids
                ]
                merged.skipped += healed.skipped

        still_incomplete = len(merged.positions_without_entry)
        if still_incomplete:
            _log(
                f"{still_incomplete} position(s) opened before the {args.days}-day window "
                "have no entry data — their legs are flagged 'incomplete history'. "
                "Open 'Account History' in MetaTrader 5, right-click and choose "
                "'All Periods' so the terminal loads older deals."
            )

        live_ids = {_ticket_int(p.ticket) for p in positions_raw}

        # ── Open positions stay live records; closed legs carry realized P/L ─
        trades: list[TradeRecord] = []
        for position in positions_raw:
            try:
                pid = _ticket_int(position.ticket)
                meta = merged.meta.get(pid) if pid is not None else None
                trades.append(_build_open_trade(position, meta, specs))
            except Exception as exc:
                merged.skipped += 1
                _err(f"skipping open position {getattr(position, 'ticket', '?')}: {exc}")
        # closed legs of positions that are NOT live anymore
        trades.extend(l for l in merged.legs if l.positionTicket not in live_ids)

        # Reversed positions: an IN-only group whose P/L moved to the successor
        # deal still deserves a visible (money-neutral) record.
        trades.extend(build_reversal_stubs(merged, live_ids, now))
        # de-duplicate reversed stubs against healed legs by (position, None-ticket)
        seen_stub: set[int] = set()
        deduped: list[TradeRecord] = []
        for t in trades:
            key = (t.positionTicket, t.dealTicket)
            if t.dealTicket is None and t.status == "CLOSED" and key in seen_stub:
                continue
            seen_stub.add(key)
            deduped.append(t)
        trades = deduped

        open_count = sum(1 for t in trades if t.status == "OPEN")
        closed_count = len(trades) - open_count
        snapshot = {"balance": _num(info.balance), "equity": _num(info.equity)}

        if args.test:
            _print_test_summary(
                account, info, len(deals_raw), len(positions_raw), closed_count,
                len(merged.cashflows), merged.skipped, still_incomplete,
            )
            return True

        # ── POST to the dashboard ────────────────────────────────────────────
        payload = {
            "account": asdict(account),
            "trades": [asdict(t) for t in trades],
            "cashflows": [asdict(c) for c in merged.cashflows],
            "snapshot": snapshot,
            # Authoritative-open-set flag (v1.3.7): when True the dashboard may
            # finalize every OPEN row that is absent from this payload's live set.
            "positionsRead": positions_read,
        }
        url = args.api.rstrip("/") + SYNC_PATH
        _log(
            f"POST {len(trades)} records ({open_count} open / {closed_count} closed legs), "
            f"{len(merged.cashflows)} cashflows -> {url}"
        )
        return _post_payload(url, payload, args)

    except Exception as exc:  # never let one bad cycle kill --watch mode
        _err(f"unexpected error during sync: {exc!r}")
        return False
    finally:
        if HAVE_MT5:
            mt5.shutdown()


def _post_payload(url: str, payload: dict, args: argparse.Namespace) -> bool:
    try:
        import requests
    except ImportError:
        _err("the 'requests' package is required to POST sync payloads (pip install requests)")
        return False

    headers = {"Content-Type": "application/json"}
    token = getattr(args, "token", None)
    if token:
        headers["X-PTI-Token"] = str(token)
    try:
        response = requests.post(url, json=payload, timeout=60, headers=headers)
    except requests.RequestException as exc:
        _err(f"request failed: {exc} — is the dashboard running at {args.api}?")
        return False
    if response.status_code != 200:
        _err(f"sync API returned HTTP {response.status_code}: {response.text[:500]}")
        return False
    try:
        result = response.json()
    except ValueError:
        _err(f"sync API returned non-JSON response: {response.text[:200]}")
        return False

    _log(
        f"Sync complete: inserted={result.get('inserted')} "
        f"updated={result.get('updated')} total={result.get('total')} "
        f"cashflowsAdded={result.get('cashflowsAdded')} "
        f"openRowsClosed={result.get('openRowsClosed')}"
    )
    recon = result.get("reconciliation")
    if isinstance(recon, dict):
        diff = recon.get("diff")
        _log(
            "Balance reconciliation: "
            f"initial {recon.get('initialBalance')} + net cash {recon.get('netCash')} "
            f"+ closed P/L {recon.get('closedPnl')} = {recon.get('expected')} "
            f"vs MT5 balance {recon.get('reported')} (diff {diff})"
        )
        if isinstance(diff, (int, float)) and abs(diff) > 0.01:
            _log("WARNING: balance mismatch > 0.01 — some history may not be imported yet")
    if merged_skipped := result.get("skippedDeals"):
        _log(f"Note: the dashboard skipped {merged_skipped} malformed record(s).")
    return True


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
        "--token", default=None,
        help="Sync token issued by the dashboard (sent as X-PTI-Token)",
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
