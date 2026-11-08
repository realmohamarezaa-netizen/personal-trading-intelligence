import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeStrategyStats } from '@/lib/analytics'
import { loadEngineInput } from '@/lib/server-data'

export const dynamic = 'force-dynamic'

// ─── Strategy library + per-strategy statistics (P4) ─────────────────────────

export async function GET(req: NextRequest) {
  try {
    const accountId = req.nextUrl.searchParams.get('accountId') ?? undefined
    const input = await loadEngineInput(accountId)
    if (!input) return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })

    const strategies = await db.strategy.findMany({ orderBy: { createdAt: 'asc' } })
    const stats = computeStrategyStats(
      input.trades,
      strategies.map((s) => ({ id: s.id, name: s.name, color: s.color })),
      input.account.timezone
    )

    return NextResponse.json({
      strategies: strategies.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        color: s.color,
        magicNumbers: s.magicNumbers,
        createdAt: s.createdAt.toISOString(),
      })),
      stats,
      timezone: input.account.timezone,
      currency: input.account.currency,
    })
  } catch (err) {
    console.error('[api/strategies GET]', err)
    return NextResponse.json({ error: 'STRATEGIES_FAILED' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      description?: unknown
      color?: unknown
      magicNumbers?: unknown
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : ''
    if (!name) return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 })
    const magicNumbers =
      typeof body.magicNumbers === 'string'
        ? body.magicNumbers
            .split(/[,\s]+/)
            .map((m) => m.trim())
            .filter((m) => /^\d{1,15}$/.test(m))
            .join(',')
        : ''
    const color =
      typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null
    const description = typeof body.description === 'string' ? body.description.slice(0, 256) : null

    const existing = await db.strategy.findUnique({ where: { name } })
    if (existing) return NextResponse.json({ error: 'NAME_EXISTS' }, { status: 409 })

    const created = await db.strategy.create({ data: { name, description, color, magicNumbers } })
    return NextResponse.json({ ok: true, strategy: created })
  } catch (err) {
    console.error('[api/strategies POST]', err)
    return NextResponse.json({ error: 'STRATEGY_CREATE_FAILED' }, { status: 500 })
  }
}
