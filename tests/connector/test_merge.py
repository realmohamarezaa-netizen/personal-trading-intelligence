#!/usr/bin/env python3
"""Unit tests for the MT5 connector's pure deal-merging logic (sync.py).

Fixtures mimic the real MetaTrader5 namedtuples (TradeDeal / TradePosition)
using SimpleNamespace, so the whole suite runs on Linux/CI without a terminal.
Run: python3 -m unittest discover -s tests/connector -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mt5-connector"))

from mt5_shim import mt5  # noqa: E402  (fallback constants on non-Windows)
from sync import (  # noqa: E402
    REVERSAL_MARKER,
    SymbolSpec,
    _build_open_trade,
    _risk_money,
    build_reversal_stubs,
    merge_history_deals,
)


def deal(
    ticket: int,
    position_id: int,
    *,
    deal_type: int = mt5.DEAL_TYPE_BUY,
    entry: int = mt5.DEAL_ENTRY_IN,
    time: int = 1_700_000_000,
    price: float = 100.0,
    volume: float = 1.0,
    profit: float = 0.0,
    commission: float = 0.0,
    swap: float = 0.0,
    symbol: str = "XAUUSD",
    magic=7,
    comment: str = "test",
    sl=None,
    tp=None,
):
    return NS(
        ticket=ticket,
        position_id=position_id,
        type=deal_type,
        entry=entry,
        time=time,
        price=price,
        volume=volume,
        profit=profit,
        commission=commission,
        swap=swap,
        symbol=symbol,
        magic=magic,
        comment=comment,
        sl=sl,
        tp=tp,
    )


def position(
    ticket: int,
    *,
    symbol: str = "XAUUSD",
    ptype: int = mt5.POSITION_TYPE_BUY,
    volume: float = 1.0,
    time: int = 1_700_000_000,
    price_open: float = 100.0,
    profit: float = 12.0,
    swap: float = -0.5,
    sl=95.0,
    tp=None,
    magic: int = 7,
    comment: str = "live",
):
    return NS(
        ticket=ticket,
        symbol=symbol,
        type=ptype,
        volume=volume,
        time=time,
        price_open=price_open,
        profit=profit,
        swap=swap,
        sl=sl,
        tp=tp,
        magic=magic,
        comment=comment,
    )


GOLD = {"XAUUSD": SymbolSpec(digits=2, point=0.01, tick_size=0.01, tick_value=1.0)}


class TestBuySell(unittest.TestCase):
    def test_buy_full_close_win(self):
        deals = [
            deal(1, 100, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_IN, price=100.0, volume=1.0, commission=-3.0, sl=95.0),
            deal(2, 100, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=102.0, volume=1.0, profit=200.0, commission=-3.0, swap=-0.5, time=1_700_003_600),
        ]
        r = merge_history_deals(deals, GOLD)
        self.assertEqual(len(r.legs), 1)
        leg = r.legs[0]
        self.assertEqual(leg.direction, "BUY")
        self.assertEqual(leg.status, "CLOSED")
        self.assertEqual(leg.profit, 200.0)
        # commission: OUT (-3.0) + IN share (-3.0 * 1.0) = -6.0
        self.assertEqual(leg.commission, -6.0)
        self.assertEqual(leg.netProfit, 200.0 - 6.0 - 0.5)
        self.assertEqual(leg.volume, 1.0)
        self.assertEqual(leg.initialStopLoss, 95.0)
        # risk = |100-95| / 0.01 * 1.0 * 1.0 = 500
        self.assertEqual(leg.riskAmount, 500.0)
        # R = 193.5 / 500 = 0.387
        self.assertAlmostEqual(leg.rMultiple, 0.387, places=3)
        # pips: (102-100)/0.01 = 200
        self.assertEqual(leg.pips, 200.0)
        self.assertEqual(leg.magicNumber, 7)

    def test_sell_loss(self):
        deals = [
            deal(1, 101, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_IN, price=50.0, volume=2.0, commission=-4.0),
            deal(2, 101, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_OUT, price=51.0, volume=2.0, profit=-200.0, commission=-4.0, time=1_700_003_600),
        ]
        r = merge_history_deals(deals, GOLD)
        leg = r.legs[0]
        self.assertEqual(leg.direction, "SELL")
        self.assertLess(leg.netProfit, 0)
        self.assertEqual(leg.commission, -8.0)
        self.assertEqual(leg.volume, 2.0)

    def test_break_even(self):
        deals = [
            deal(1, 102, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_IN, price=10.0, volume=0.1, sl=9.0),
            deal(2, 102, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=10.0, volume=0.1, profit=0.0, time=1_700_001_800),
        ]
        r = merge_history_deals(deals, GOLD)
        leg = r.legs[0]
        self.assertEqual(leg.profit, 0.0)
        self.assertEqual(leg.netProfit, 0.0)
        self.assertEqual(leg.rMultiple, 0.0)  # 0 / risk → exactly 0R (valid R)


class TestPartialClose(unittest.TestCase):
    """1 lot opened, 0.5 closed in profit, 0.5 still open, then full close."""

    def setUp(self):
        self.deals = [
            deal(1, 900_000_000_001, price=100.0, volume=1.0, commission=-3.0, sl=95.0, time=1_700_000_000),
            deal(2, 900_000_000_001, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=102.0, volume=0.5, profit=100.0, commission=-1.5, swap=-0.2, time=1_700_001_800),
        ]

    def test_partial_leg_math(self):
        r = merge_history_deals(self.deals, GOLD)
        self.assertEqual(len(r.legs), 1)
        leg = r.legs[0]
        # realized P/L of the closed HALF only
        self.assertEqual(leg.profit, 100.0)
        self.assertEqual(leg.volume, 0.5)
        # allocated IN commission: -3.0 * (0.5 / 1.0) = -1.5 → total -3.0
        self.assertEqual(leg.commission, -3.0)
        self.assertEqual(leg.netProfit, 96.8)
        # leg risk = 500 * (0.5 / 1.0) = 250 → R = 96.8 / 250
        self.assertAlmostEqual(leg.riskAmount, 250.0)
        self.assertAlmostEqual(leg.rMultiple, 0.387, places=3)
        # position ticket survives the 32-bit boundary
        self.assertEqual(leg.positionTicket, 900_000_000_001)
        self.assertIsNone(leg.positionId)  # does NOT fit in 32 bits

    def test_full_close_sums_without_double_counting(self):
        self.deals.append(
            deal(3, 900_000_000_001, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=101.0, volume=0.5, profit=50.0, commission=-1.5, swap=-0.1, time=1_700_007_200)
        )
        r = merge_history_deals(self.deals, GOLD)
        self.assertEqual(len(r.legs), 2)
        total_profit = sum(l.profit for l in r.legs)
        total_commission = sum(l.commission for l in r.legs)
        total_swap = sum(l.swap for l in r.legs)
        # realized: 100 + 50; commission: -3 (in) + -1.5 -1.5 (out) = -6; swap: -0.3
        self.assertEqual(total_profit, 150.0)
        self.assertEqual(total_commission, -6.0)
        self.assertAlmostEqual(total_swap, -0.3)
        # every deal ticket is unique → no double counting on re-sync
        tickets = [l.dealTicket for l in r.legs]
        self.assertEqual(len(tickets), len(set(tickets)))

    def test_open_position_commission_share(self):
        pos = position(900_000_000_001, volume=0.5)  # remaining half
        r = merge_history_deals(self.deals, GOLD)
        meta = r.meta[900_000_000_001]
        open_row = _build_open_trade(pos, meta, GOLD)
        self.assertEqual(open_row.status, "OPEN")
        self.assertEqual(open_row.volume, 0.5)
        # remaining IN commission: -3.0 * 0.5 = -1.5
        self.assertEqual(open_row.commission, -1.5)
        # floating P/L is NOT an R
        self.assertIsNone(open_row.rMultiple)
        # initial SL from the ENTRY deal (not the current trailing SL)
        self.assertEqual(open_row.initialStopLoss, 95.0)


class TestReversal(unittest.TestCase):
    def test_reversal_books_profit_on_successor(self):
        deals = [
            # old position: opened, then reversed (IN-only group remains)
            deal(1, 700, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_IN, price=100.0, volume=1.0, commission=-2.0),
            # reversal deal: closes the old leg and opens the new position 701
            deal(2, 701, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_INOUT, price=98.0, volume=1.0, profit=200.0, commission=-2.0, time=1_700_003_600),
        ]
        r = merge_history_deals(deals, GOLD)
        self.assertEqual(len(r.legs), 1)  # successor's closing leg
        self.assertEqual(r.legs[0].profit, 200.0)

        from datetime import datetime, timezone
        stubs = build_reversal_stubs(r, live_ids=set(), now=datetime.now(timezone.utc))
        stubs = [s for s in stubs if s.positionTicket == 700]
        self.assertEqual(len(stubs), 1)  # money-neutral marker for the reversed position
        stub = stubs[0]
        self.assertEqual(stub.profit, 0.0)
        self.assertEqual(stub.mt5Comment, REVERSAL_MARKER)
        # no money invented: 200 (real) + 0 (marker)
        self.assertEqual(sum(l.profit for l in r.legs) + sum(s.profit for s in stubs), 200.0)


class TestIncompleteHistory(unittest.TestCase):
    def test_position_opened_before_window(self):
        # only the closing deal is inside the window — no IN deal at all
        deals = [
            deal(9, 800, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_OUT, price=105.0, volume=1.0, profit=-250.0, commission=-2.0, time=1_700_003_600),
        ]
        r = merge_history_deals(deals, GOLD)
        leg = r.legs[0]
        self.assertTrue(leg.incompleteHistory)
        # direction inferred from the closing deal (closing a SELL = BUY deal)
        self.assertEqual(leg.direction, "SELL")
        self.assertEqual(leg.positionId, 800)  # fits 32 bits → legacy column kept
        self.assertIsNone(leg.rMultiple)  # no honest initial risk — never guessed

    def test_no_spec_no_guess(self):
        deals = [
            deal(1, 810, deal_type=mt5.DEAL_TYPE_BUY, entry=mt5.DEAL_ENTRY_IN, price=100.0, volume=1.0, sl=95.0),
            deal(2, 810, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=103.0, volume=1.0, profit=300.0, time=1_700_003_600),
        ]
        r = merge_history_deals(deals, {})  # no symbol specs available
        leg = r.legs[0]
        self.assertIsNone(leg.pips)
        self.assertIsNone(leg.riskAmount)
        self.assertIsNone(leg.rMultiple)
        self.assertEqual(leg.profit, 300.0)  # money is still exact


class TestCashflows(unittest.TestCase):
    def test_all_non_trade_deal_types_preserved(self):
        deals = [
            deal(51, 0, deal_type=mt5.DEAL_TYPE_BALANCE, profit=10_000.0, symbol="", magic=None, comment="Initial deposit"),
            deal(52, 0, deal_type=mt5.DEAL_TYPE_BALANCE, profit=-2_500.0, symbol="", magic=None, comment="Withdrawal"),
            deal(53, 0, deal_type=mt5.DEAL_TYPE_CREDIT, profit=5_000.0, symbol="", magic=None),
            deal(54, 0, deal_type=mt5.DEAL_TYPE_COMMISSION, profit=-12.0, symbol="", magic=None),
            deal(55, 0, deal_type=mt5.DEAL_TYPE_CHARGE, profit=-1.0, symbol="", magic=None),
            deal(56, 0, deal_type=mt5.DEAL_TYPE_INTEREST, profit=0.4, symbol="", magic=None),
            deal(57, 0, deal_type=mt5.DEAL_TYPE_TAX, profit=-40.0, symbol="", magic=None),
            deal(58, 0, deal_type=mt5.DEAL_TYPE_CORRECTION, profit=13.0, symbol="", magic=None),
            deal(59, 0, deal_type=mt5.DEAL_TYPE_DIVIDEND, profit=7.0, symbol="", magic=None),
            deal(60, 0, deal_type=99, profit=1.0, symbol="", magic=None),  # unknown type
        ]
        r = merge_history_deals(deals, GOLD)
        cats = {c.category for c in r.cashflows}
        self.assertEqual(len(r.cashflows), 10)  # nothing silently dropped
        self.assertIn("BALANCE", cats)
        self.assertIn("CREDIT", cats)
        self.assertIn("COMMISSION", cats)
        self.assertIn("CHARGE", cats)
        self.assertIn("INTEREST", cats)
        self.assertIn("TAX", cats)
        self.assertIn("CORRECTION", cats)
        self.assertIn("DIVIDEND", cats)
        self.assertIn("OTHER", cats)
        by_ticket = {c.externalId: c for c in r.cashflows}
        self.assertEqual(by_ticket[51].type, "DEPOSIT")
        self.assertEqual(by_ticket[52].type, "WITHDRAWAL")
        self.assertEqual(by_ticket[52].amount, 2500.0)
        self.assertEqual(by_ticket[53].category, "CREDIT")
        self.assertEqual(by_ticket[60].category, "OTHER")

    def test_risk_money_helper(self):
        spec = GOLD["XAUUSD"]
        self.assertEqual(_risk_money(100.0, 95.0, 2.0, spec), 1000.0)
        self.assertIsNone(_risk_money(100.0, None, 1.0, spec))
        self.assertIsNone(_risk_money(100.0, 95.0, 1.0, None))
        self.assertIsNone(_risk_money(100.0, 100.0, 1.0, spec))  # SL == entry


class TestIdempotentMerge(unittest.TestCase):
    def test_replaying_the_same_deals_is_stable(self):
        deals = [
            deal(1, 100, price=100.0, volume=1.0, commission=-3.0, sl=95.0),
            deal(2, 100, deal_type=mt5.DEAL_TYPE_SELL, entry=mt5.DEAL_ENTRY_OUT, price=102.0, volume=1.0, profit=200.0, commission=-3.0, time=1_700_003_600),
        ]
        a = merge_history_deals(deals, GOLD)
        b = merge_history_deals(deals, GOLD)
        self.assertEqual(len(a.legs), len(b.legs))
        self.assertEqual(
            [l.dealTicket for l in a.legs],
            [l.dealTicket for l in b.legs],
        )
        self.assertEqual(
            sum(l.netProfit for l in a.legs),
            sum(l.netProfit for l in b.legs),
        )


if __name__ == "__main__":
    unittest.main()
