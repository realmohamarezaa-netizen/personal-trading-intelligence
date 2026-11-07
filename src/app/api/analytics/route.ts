import { NextRequest, NextResponse } from 'next/server'
import { computeAnalytics } from '@/lib/analytics'
import type { RangeKey } from '@/lib/types'
import { loadEngineInput } from '@/lib/server-data'

export const dynamic = 'force-dynamic'

const VALID_RANGES: RangeKey[] = ['7d', '30d', '90d', '180d', 'all']

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const rangeParam = (sp.get('range') ?? 'all') as RangeKey
    const range: RangeKey = VALID_RANGES.includes(rangeParam) ? rangeParam : 'all'
    const symbol = sp.get('symbol') ?? undefined

    const input = await loadEngineInput()
    if (!input) {
      return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })
    }

    const data = computeAnalytics(input, { range, symbol })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[api/analytics]', err)
    return NextResponse.json({ error: 'ANALYTICS_FAILED' }, { status: 500 })
  }
}
