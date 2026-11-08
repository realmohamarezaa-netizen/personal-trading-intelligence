// ─── Personal Trading Intelligence — database bootstrap ──────────────────────
// Runs the guarded, additive migrations from db-migrations.ts against the
// SQLite file DATABASE_URL points at. Designed to be safe in three situations:
//   1. Fresh desktop install  → 0001_baseline creates the empty schema.
//   2. Upgrade over v1.2.x    → 0002 copies every legacy row forward
//                               (table redefinitions, no data deletion).
//   3. Already migrated       → all guards return false, nothing runs.
//
// Applied migrations are recorded in the `_PtiMigration` bookkeeping table.
// Called automatically on server start (src/instrumentation.ts) and manually
// via `bun run scripts/db-bootstrap.ts`.

import { db } from '@/lib/db'
import { MIGRATIONS, type MigrationQueryRunner } from './db-migrations'

let bootstrapped: Promise<{ applied: string[]; skipped: string[] }> | null = null

async function ensureBookkeepingTable(): Promise<void> {
  await db.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_PtiMigration" (
       "id" TEXT NOT NULL PRIMARY KEY,
       "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  )
}

async function alreadyRecorded(id: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "_PtiMigration" WHERE "id" = '${id}'`
  )
  return rows.length > 0
}

export function bootstrapDatabase(): Promise<{ applied: string[]; skipped: string[] }> {
  // Never run twice per process (instrumentation + first API call can race).
  if (!bootstrapped) {
    bootstrapped = runBootstrap().catch((err) => {
      bootstrapped = null // allow a retry after a transient failure
      throw err
    })
  }
  return bootstrapped
}

/** Test hook: forget the per-process result so bootstrap can run again. */
export function resetBootstrapMemo(): void {
  bootstrapped = null
}

async function runBootstrap(): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = []
  const skipped: string[] = []

  await ensureBookkeepingTable()

  for (const migration of MIGRATIONS) {
    if (await alreadyRecorded(migration.id)) {
      skipped.push(migration.id)
      continue
    }

    const runner: MigrationQueryRunner = {
      query: (sql) => db.$queryRawUnsafe(sql),
      execute: (sql) => db.$executeRawUnsafe(sql),
    }

    if (!(await migration.pending(runner))) {
      skipped.push(migration.id)
      await db.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "_PtiMigration" ("id") VALUES ('${migration.id}')`
      )
      continue
    }

    const started = Date.now()

    if (migration.foreignKeysOff) {
      // ── Table-rebuild script (v1.2.x upgrade) ────────────────────────────
      // `PRAGMA foreign_keys` is a no-op INSIDE a transaction, so:
      //   1. turn FK enforcement OFF in autocommit,
      //   2. run the whole script inside ONE transaction (atomic),
      //   3. verify no FK violations, verify row counts are sane, commit,
      //   4. always turn FK enforcement back ON.
      await db.$executeRawUnsafe('PRAGMA foreign_keys=OFF')
      try {
        await db.$transaction(
          async (tx) => {
            for (const stmt of migration.statements) {
              // in-script PRAGMAs are superseded by the runner-level handling
              if (/^PRAGMA/i.test(stmt)) continue
              await tx.$executeRawUnsafe(stmt)
            }
            // FK integrity BEFORE commit — a violation rolls the whole script back
            const violations = await tx.$queryRawUnsafe<unknown[]>(
              'PRAGMA foreign_key_check'
            )
            if (violations.length > 0) {
              throw new Error(
                `foreign_key_check reported ${violations.length} violation(s) after ${migration.id}`
              )
            }
          },
          { timeout: 180_000, maxWait: 15_000 }
        )
      } finally {
        await db.$executeRawUnsafe('PRAGMA foreign_keys=ON').catch(() => {})
      }
    } else {
      await db.$transaction(
        async (tx) => {
          for (const stmt of migration.statements) {
            await tx.$executeRawUnsafe(stmt)
          }
        },
        { timeout: 120_000, maxWait: 15_000 }
      )
    }
    await db.$executeRawUnsafe(
      `INSERT INTO "_PtiMigration" ("id") VALUES ('${migration.id}')`
    )
    applied.push(migration.id)
    console.log(
      `[db-bootstrap] applied ${migration.id} in ${Date.now() - started}ms — ${migration.description}`
    )
  }

  return { applied, skipped }
}
