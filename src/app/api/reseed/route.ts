import { NextResponse } from 'next/server'
import { reseedDemo } from '@/lib/seed'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await reseedDemo()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/reseed]', err)
    return NextResponse.json({ error: 'RESEED_FAILED' }, { status: 500 })
  }
}
