import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Update / delete a strategy. Deleting a strategy keeps its trades
// (strategyId → NULL via ON DELETE SET NULL) — never removes trade data.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      description?: unknown
      color?: unknown
      magicNumbers?: unknown
    }

    const data: Record<string, string | null> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 64)
    if (typeof body.description === 'string') data.description = body.description.slice(0, 256)
    if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) data.color = body.color
    if (typeof body.magicNumbers === 'string') {
      data.magicNumbers = body.magicNumbers
        .split(/[,\s]+/)
        .map((m) => m.trim())
        .filter((m) => /^\d{1,15}$/.test(m))
        .join(',')
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 400 })
    }

    try {
      const updated = await db.strategy.update({ where: { id }, data })
      return NextResponse.json({ ok: true, strategy: updated })
    } catch {
      return NextResponse.json({ error: 'STRATEGY_NOT_FOUND_OR_NAME_TAKEN' }, { status: 404 })
    }
  } catch (err) {
    console.error('[api/strategies PATCH]', err)
    return NextResponse.json({ error: 'STRATEGY_UPDATE_FAILED' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    await db.strategy.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'STRATEGY_NOT_FOUND' }, { status: 404 })
  }
}
