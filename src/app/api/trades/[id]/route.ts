import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tradePatchSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    // Content-length guard + strict validation (journal annotations only)
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > 64 * 1024) {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
    }
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
    }
    const body = tradePatchSchema.safeParse(raw)
    if (!body.success) {
      return NextResponse.json(
        { error: 'INVALID_BODY', issues: body.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 },
      )
    }

    const existing = await db.trade.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'TRADE_NOT_FOUND' }, { status: 404 })
    }

    const updated = await db.trade.update({
      where: { id },
      data: {
        ...(body.data.mistakes !== undefined ? { mistakes: JSON.stringify(body.data.mistakes) } : {}),
        ...(body.data.emotion !== undefined ? { emotion: body.data.emotion } : {}),
        ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
        // Manual strategy (re-)assignment — wins over the magic-number mapping
        ...(body.data.strategyId !== undefined ? { strategyId: body.data.strategyId } : {}),
      },
    })

    return NextResponse.json({ ok: true, id: updated.id })
  } catch (err) {
    console.error('[api/trades/PATCH]', err)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
}
