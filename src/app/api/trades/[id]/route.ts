import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface UpdateBody {
  mistakes?: string[]
  emotion?: string | null
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

    const updated = await db.trade.update({
      where: { id },
      data: {
        mistakes: Array.isArray(body.mistakes) ? JSON.stringify(body.mistakes.slice(0, 12)) : undefined,
        emotion: body.emotion !== undefined ? (body.emotion || null) : undefined,
        notes: body.notes !== undefined ? (body.notes || null) : undefined,
      },
    })

    return NextResponse.json({ ok: true, id: updated.id })
  } catch (err) {
    console.error('[api/trades/PATCH]', err)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
}
