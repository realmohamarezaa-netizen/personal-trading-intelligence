import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processSyncPayload } from '@/lib/mt5-sync'
import { syncBodySchema, SYNC_MAX_BODY_BYTES } from '@/lib/validation'
import { checkSyncToken, SYNC_TOKEN_HEADER } from '@/lib/security'
import { pruneRetention } from '@/lib/retention'

export const dynamic = 'force-dynamic'

// ─── MT5 Python connector sync endpoint ──────────────────────────────────────
// The connector runs locally on the trader's machine and pushes account info,
// per-deal trade legs, open positions, categorized cashflows and a snapshot
// to this API. Everything is validated (zod), applied in ONE transaction and
// is idempotent — replaying a payload never duplicates data.
// No order-execution capability exists anywhere in this project (read-only).

export async function POST(req: NextRequest) {
  try {
    // 1) content-length guard (a local misbehaving process must not be able
    //    to push an unbounded body into the server)
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (contentLength > SYNC_MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
    }

    // 2) connector authentication (token is minted per launch by the
    //    dashboard and passed to the Python connector). Plain dev setups
    //    without any configured token stay working (loopback-only).
    const token = checkSyncToken(req.headers.get(SYNC_TOKEN_HEADER))
    if (!token.ok) {
      return NextResponse.json({ error: 'UNAUTHORIZED_SYNC', message: token.reason }, { status: 401 })
    }

    // 3) strict schema validation — the database never sees unchecked input
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
    }
    const parsed = syncBodySchema.safeParse(raw)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      return NextResponse.json({ error: 'INVALID_PAYLOAD', issues }, { status: 400 })
    }

    const result = await processSyncPayload(parsed.data, { db })

    // 4) retention policy (snapshots / sync log growth is bounded) — runs
    //    after the transaction; failure here must never fail the sync.
    try {
      await pruneRetention(db, result.accountId)
    } catch (err) {
      console.error('[api/mt5/sync] retention pruning failed', err)
    }

    const partial = result.skippedDeals > 0 || result.warnings.length > 0
    await db.syncLog.create({
      data: {
        accountId: result.accountId,
        source: 'MT5_SYNC',
        status: partial ? 'PARTIAL' : 'OK',
        message:
          `Synced ${parsed.data.trades.length} records (${result.inserted} new, ${result.updated} updated)` +
          `${result.openRowsClosed ? `, ${result.openRowsClosed} open rows finalized` : ''}` +
          `${result.cashflowsAdded ? `, ${result.cashflowsAdded} cashflows` : ''}` +
          `${result.skippedDeals ? `, ${result.skippedDeals} skipped` : ''}` +
          `${result.reconciliation.diff !== null ? ` | balance diff ${result.reconciliation.diff}` : ''}` +
          `${result.incompleteHistory ? ` | ${result.incompleteHistory} incomplete-history rows` : ''}` +
          (partial ? ` | warnings: ${result.warnings.slice(0, 3).join(' / ')}` : ''),
        tradesInserted: result.inserted,
        tradesUpdated: result.updated,
      },
    })

    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      updated: result.updated,
      total: parsed.data.trades.length,
      cashflowsAdded: result.cashflowsAdded,
      openRowsClosed: result.openRowsClosed,
      skippedDeals: result.skippedDeals,
      incompleteHistory: result.incompleteHistory,
      warnings: result.warnings,
      reconciliation: result.reconciliation,
    })
  } catch (err) {
    console.error('[api/mt5/sync]', err)
    return NextResponse.json({ error: 'SYNC_FAILED' }, { status: 500 })
  }
}
