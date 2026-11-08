// ─── Data retention policies ─────────────────────────────────────────────────
// Equity snapshots arrive every ~45 s while the connector runs (~1,900 rows a
// day) and sync logs grow by one row per cycle. Without pruning, a year of
// usage would stack tens of millions of rows. Policy:
//   * EquitySnapshot: raw rows younger than 30 days are all kept; beyond that
//     only the LAST snapshot of each day survives (enough for day-level
//     drawdown/equity reconstruction, 98%+ smaller).
//   * SyncLog: keep the newest 200 rows per account.
//
// SQLite type-ordering TRAP (found by the test-suite): an INTEGER column is
// ALWAYS < a TEXT value in SQLite comparisons. Prisma stores DateTime as
// integer ms, so comparing "ts" < datetime('now', …) — an INTEGER against
// TEXT — is true for EVERY row and the prune would downsample fresh data
// too. All timestamp comparisons therefore normalize to integer milliseconds
// first (raw-SQL TEXT rows are converted via strftime).

import { Prisma, type PrismaClient, type Prisma as PrismaTx } from '@prisma/client'

const SNAPSHOT_RAW_DAYS = 30
const SYNCLOG_KEEP = 200

/** "ts" as integer milliseconds regardless of integer/TEXT storage. */
const TS_MS = `CASE WHEN typeof("ts") = 'integer'
  THEN "ts"
  ELSE CAST(strftime('%s', "ts") AS INTEGER) * 1000 END`

/** Day-bucket expression for the same mixed storage. */
const DAY_OF_TS = `CASE WHEN typeof("ts") = 'integer'
  THEN date("ts" / 1000, 'unixepoch')
  ELSE date("ts") END`

export async function pruneRetention(db: PrismaClient | PrismaTx.TransactionClient, accountId: string): Promise<void> {
  const cutoffMs = Date.now() - SNAPSHOT_RAW_DAYS * 864e5

  // Snapshots: keep last-30-days raw + one row per day before that.
  await db.$executeRaw`
    DELETE FROM "EquitySnapshot"
    WHERE "accountId" = ${accountId}
      AND ${Prisma.raw(TS_MS)} < ${cutoffMs}
      AND "id" NOT IN (
        SELECT "id" FROM (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY ${Prisma.raw(DAY_OF_TS)}
                   ORDER BY "ts" DESC
                 ) AS rn
          FROM "EquitySnapshot"
          WHERE "accountId" = ${accountId}
            AND ${Prisma.raw(TS_MS)} < ${cutoffMs}
        )
        WHERE rn = 1
      )
  `

  // Sync log: newest 200 rows per account.
  await db.$executeRaw`
    DELETE FROM "SyncLog"
    WHERE "accountId" = ${accountId}
      AND "id" NOT IN (
        SELECT "id" FROM "SyncLog"
        WHERE "accountId" = ${accountId}
        ORDER BY "ts" DESC
        LIMIT ${SYNCLOG_KEEP}
      )
  `
}
