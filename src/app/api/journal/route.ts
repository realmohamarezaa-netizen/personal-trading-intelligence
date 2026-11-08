import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveActiveAccount } from '@/lib/server-data'
import { journalQuerySchema } from '@/lib/validation'
import type { JournalResponse, JournalTrade } from '@/lib/types'

export const dynamic = 'force-dynamic'

const EPS = 0.0001

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
    const q = journalQuerySchema.safeParse({
      range: sp.get('range') ?? 'all',
      status: sp.get('status') ?? 'ALL',
      result: sp.get('result') ?? 'ALL',
      mistake: sp.get('mistake') ?? 'ALL',
      emotion: sp.get('emotion') ?? 'ALL',
      symbol: sp.get('symbol') ?? 'ALL',
      strategyId: sp.get('strategyId') ?? 'ALL',
      q: sp.get('q') ?? '',
      limit: sp.get('limit') ?? 200,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      accountId: sp.get('accountId') ?? undefined,
    })
    if (!q.success) {
      return NextResponse.json({ error: 'INVALID_QUERY', issues: q.error.issues.slice(0, 3) }, { status: 400 })
    }
    const { range, status, result, mistake, emotion, symbol, strategyId, queryText, limit, from, to, accountId } = {
      ...q.data,
      queryText: q.data.q,
    }

    const account = await resolveActiveAccount(accountId)
    if (!account) return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })

    const RANGE_MS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180 }
    const closeFrom =
      from ? new Date(from) : range !== 'all' && RANGE_MS[range] ? new Date(Date.now() - RANGE_MS[range] * 864e5) : null
    const closeTo = to ? new Date(to) : null

    const where: Record<string, unknown> = { accountId: account.id }
    if (status === 'OPEN' || status === 'CLOSED') where.status = status
    if (symbol && symbol !== 'ALL') where.symbol = symbol
    if (strategyId && strategyId !== 'ALL') where.strategyId = strategyId
    const timeCond: { gte?: Date; lte?: Date } = {}
    if (closeFrom) timeCond.gte = closeFrom
    if (closeTo) timeCond.lte = closeTo
    if (Object.keys(timeCond).length) where.closeTime = timeCond

    let trades = await db.trade.findMany({
      where,
      orderBy: [{ closeTime: 'desc' }, { openTime: 'desc' }],
      take: 4000,
      include: { strategy: { select: { name: true } } },
    })

    // Post-filters that SQL cannot express on JSON columns
    if (result === 'WIN') trades = trades.filter((t) => t.status === 'CLOSED' && t.netProfit > EPS)
    else if (result === 'LOSS') trades = trades.filter((t) => t.status === 'CLOSED' && t.netProfit < -EPS)
    else if (result === 'BE') trades = trades.filter((t) => t.status === 'CLOSED' && Math.abs(t.netProfit) <= EPS)

    if (mistake && mistake !== 'ALL') trades = trades.filter((t) => parseJsonArray(t.mistakes).includes(mistake))
    if (emotion && emotion !== 'ALL') trades = trades.filter((t) => t.emotion === emotion)
    if (queryText) {
      const needle = queryText.toLowerCase()
      trades = trades.filter(
        (t) =>
          t.symbol.toLowerCase().includes(needle) ||
          (t.notes ?? '').toLowerCase().includes(needle) ||
          (t.emotion ?? '').toLowerCase().includes(needle) ||
          (t.mt5Comment ?? '').toLowerCase().includes(needle) ||
          String(t.positionId ?? '').includes(needle) ||
          String(t.positionTicket ?? '').includes(needle)
      )
    }

    const total = trades.length
    const page: JournalTrade[] = trades.slice(0, limit).map((t) => ({
      id: t.id,
      positionId: t.positionId,
      positionTicket: t.positionTicket !== null ? t.positionTicket.toString() : null,
      dealTicket: t.dealTicket !== null ? t.dealTicket.toString() : null,
      symbol: t.symbol,
      direction: t.direction === 'SELL' ? 'SELL' : 'BUY',
      volume: t.volume,
      openTime: t.openTime.toISOString(),
      closeTime: t.closeTime ? t.closeTime.toISOString() : null,
      openPrice: t.openPrice,
      closePrice: t.closePrice,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      initialStopLoss: t.initialStopLoss,
      riskAmount: t.riskAmount,
      commission: t.commission,
      swap: t.swap,
      profit: t.profit,
      netProfit: t.netProfit,
      pips: t.pips,
      rMultiple: t.rMultiple,
      holdingMinutes: t.holdingMinutes,
      status: t.status,
      incompleteHistory: t.incompleteHistory,
      magicNumber: t.magicNumber !== null ? t.magicNumber.toString() : null,
      mt5Comment: t.mt5Comment,
      strategyId: t.strategyId,
      strategyName: t.strategy?.name ?? null,
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
