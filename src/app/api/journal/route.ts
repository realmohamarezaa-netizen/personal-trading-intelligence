import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { JournalResponse, JournalTrade, RangeKey } from '@/lib/types'

export const dynamic = 'force-dynamic'

const RANGE_MS: Record<Exclude<RangeKey, 'all'>, number> = {
  '7d': 7 * 864e5,
  '30d': 30 * 864e5,
  '90d': 90 * 864e5,
  '180d': 180 * 864e5,
}

function parseJsonArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const range = (sp.get('range') ?? 'all') as RangeKey
    const symbol = sp.get('symbol')
    const result = sp.get('result') // win | loss | be
    const mistake = sp.get('mistake')
    const q = sp.get('q')
    const status = sp.get('status') // OPEN | CLOSED | null(all)
    const limit = Math.min(Number(sp.get('limit') ?? 400), 1000)

    const from =
      range === 'all' ? null : new Date(Date.now() - RANGE_MS[range as Exclude<RangeKey, 'all'>])

    const where: Record<string, unknown> = {}
    if (symbol) where.symbol = symbol
    if (status === 'OPEN' || status === 'CLOSED') where.status = status
    if (from) where.closeTime = { gte: from }

    let trades = await db.trade.findMany({
      where,
      orderBy: [{ closeTime: 'desc' }, { openTime: 'desc' }],
      take: 2000,
    })

    // Post-filters that SQL where cannot express on JSON columns
    if (result === 'win') trades = trades.filter((t) => t.status === 'CLOSED' && t.netProfit > 0.0001)
    else if (result === 'loss') trades = trades.filter((t) => t.status === 'CLOSED' && t.netProfit < -0.0001)
    else if (result === 'be') trades = trades.filter((t) => t.status === 'CLOSED' && Math.abs(t.netProfit) <= 0.0001)

    if (mistake) trades = trades.filter((t) => parseJsonArray(t.mistakes).includes(mistake))
    if (q) {
      const needle = q.toLowerCase()
      trades = trades.filter(
        (t) =>
          t.symbol.toLowerCase().includes(needle) ||
          (t.notes ?? '').toLowerCase().includes(needle) ||
          (t.emotion ?? '').toLowerCase().includes(needle) ||
          String(t.positionId).includes(needle)
      )
    }

    const total = trades.length
    const page: JournalTrade[] = trades.slice(0, limit).map((t) => ({
      id: t.id,
      positionId: t.positionId,
      symbol: t.symbol,
      direction: t.direction === 'SELL' ? 'SELL' : 'BUY',
      volume: t.volume,
      openTime: t.openTime.toISOString(),
      closeTime: t.closeTime ? t.closeTime.toISOString() : null,
      openPrice: t.openPrice,
      closePrice: t.closePrice,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      commission: t.commission,
      swap: t.swap,
      profit: t.profit,
      netProfit: t.netProfit,
      pips: t.pips,
      rMultiple: t.rMultiple,
      holdingMinutes: t.holdingMinutes,
      status: t.status,
      mistakes: parseJsonArray(t.mistakes),
      emotion: t.emotion,
      notes: t.notes,
    }))

    const res: JournalResponse = { trades: page, total }
    return NextResponse.json(res)
  } catch (err) {
    console.error('[api/journal]', err)
    return NextResponse.json({ error: 'JOURNAL_FAILED' }, { status: 500 })
  }
}
