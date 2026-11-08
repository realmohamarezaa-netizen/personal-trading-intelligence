// ─── Next.js instrumentation hook ────────────────────────────────────────────
// Runs once per server process start (dev + packaged standalone). The very
// first thing the app does is bring the SQLite schema up to date — BEFORE any
// API route can touch the database. This is what makes a fresh desktop
// install work with an empty database file and makes upgrades over v1.2.x
// migrate the user's trading data safely (see src/lib/db-bootstrap.ts).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { bootstrapDatabase } = await import('./lib/db-bootstrap')
    const { applied, skipped } = await bootstrapDatabase()
    if (applied.length) {
      console.log(`[instrumentation] database migrations applied: ${applied.join(', ')}`)
    }
    if (process.env.PTI_DEBUG_MIGRATIONS === '1') {
      console.log(`[instrumentation] migrations skipped (up to date): ${skipped.join(', ') || 'none'}`)
    }
  } catch (err) {
    // Fail loudly: a broken migration must never leave the server silently
    // serving wrong answers. The API health endpoint reports degraded state.
    console.error('[instrumentation] DATABASE BOOTSTRAP FAILED', err)
    throw err
  }
}
