import { NextRequest, NextResponse } from 'next/server'
import { computeAnalytics } from '@/lib/analytics'
import { loadEngineInput, ensureSeeded } from '@/lib/server-data'
import { analyticsQuerySchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const q = analyticsQuerySchema.safeParse({
      range: sp.get('range') ?? 'all',
      symbol: sp.get('symbol') ?? undefined,
      accountId: sp.get('accountId') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
    })
    if (!q.success) {
      return NextResponse.json({ error: 'INVALID_QUERY', issues: q.error.issues.slice(0, 3) }, { status: 400 })
    }
    const { range, symbol, accountId, from, to } = q.data

    // Demo-first: auto-seed if the local DB is COMPLETELY empty (fresh install)
    await ensureSeeded()

    const input = await loadEngineInput(accountId)
    if (!input) {
      return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })
    }

    const data = computeAnalytics(input, {
      range,
      symbol: symbol || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/analytics]', err)
    return NextResponse.json({ error: 'ANALYTICS_FAILED' }, { status: 500 })
  }
}
