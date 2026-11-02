import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface UpdateBody {
  tags?: string[]
  mistakes?: string[]
  emotion?: string | null
  strategyId?: string | null
  notes?: string | null
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = (await req.json()) as UpdateBody

    const existing = await db.trade.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'TRADE_NOT_FOUND' }, { status: 404 })
    }

    if (body.strategyId && body.strategyId !== 'unassigned') {
      const strat = await db.strategy.findUnique({ where: { id: body.strategyId } })
      if (!strat) return NextResponse.json({ error: 'STRATEGY_NOT_FOUND' }, { status: 400 })
    }

    const updated = await db.trade.update({
      where: { id },
      data: {
        tags: Array.isArray(body.tags) ? JSON.stringify(body.tags.slice(0, 12)) : undefined,
        mistakes: Array.isArray(body.mistakes) ? JSON.stringify(body.mistakes.slice(0, 12)) : undefined,
        emotion: body.emotion !== undefined ? (body.emotion || null) : undefined,
        strategyId:
          body.strategyId !== undefined ? (body.strategyId === 'unassigned' ? null : body.strategyId) : undefined,
        notes: body.notes !== undefined ? (body.notes || null) : undefined,
      },
    })

    return NextResponse.json({ ok: true, id: updated.id })
  } catch (err) {
    console.error('[api/trades/PATCH]', err)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
}
