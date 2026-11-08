// Manual database bootstrap runner (dev tooling).
//   bun run scripts/db-bootstrap.ts
// Applies pending guarded migrations to the database DATABASE_URL points at
// and prints a row-count summary afterwards for quick verification.

import { db } from '../src/lib/db'
import { bootstrapDatabase } from '../src/lib/db-bootstrap'

async function main() {
  const { applied, skipped } = await bootstrapDatabase()
  console.log('Applied :', applied.length ? applied.join(', ') : '(nothing pending)')
  console.log('Skipped :', skipped.length ? skipped.join(', ') : '(none)')

  const tables = ['Account', 'Trade', 'Strategy', 'EquitySnapshot', 'CashFlow', 'SyncLog']
  console.log('--- row counts ---')
  for (const t of tables) {
    try {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) as n FROM "${t}"`)
      console.log(`  ${t}: ${rows[0]?.n ?? '?'}`)
    } catch {
      console.log(`  ${t}: (missing)`)
    }
  }
  await db.$disconnect()
}

main().catch((err) => {
  console.error('bootstrap failed:', err)
  process.exit(1)
})
