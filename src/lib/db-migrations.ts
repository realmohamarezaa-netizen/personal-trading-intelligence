// ─── Personal Trading Intelligence — SQLite migration scripts ────────────────
// Runtime-safe migrations for the packaged desktop app (no Prisma CLI ships
// inside the installer). Every script is:
//   - guarded (applies only to the exact legacy state it upgrades),
//   - additive (existing user data is copied forward — never wiped),
//   - transactional (runner wraps each script; a failure rolls it back).
//
// 0001_baseline     — brand-new/empty database files (first install)
// 0002_risk_strategy— v1.2.x databases (positionId Int @unique, no Strategy…)
//
// SQL below is generated with `prisma migrate diff` from the schema.prisma
// of this exact version and reviewed line-by-line: the table redefinitions
// copy EVERY legacy column forward with INSERT…SELECT; nothing is deleted.

/** Baseline DDL for a fresh database (v1.3.0 schema). */
const BASELINE_SQL = `
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'demo',
    "name" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "mt5Login" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "initialBalance" REAL NOT NULL,
    "tradeMode" TEXT NOT NULL DEFAULT 'REAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "positionId" INTEGER,
    "positionTicket" BIGINT,
    "dealTicket" BIGINT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME,
    "openPrice" REAL NOT NULL,
    "closePrice" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "initialStopLoss" REAL,
    "riskAmount" REAL,
    "commission" REAL NOT NULL DEFAULT 0,
    "swap" REAL NOT NULL DEFAULT 0,
    "profit" REAL NOT NULL DEFAULT 0,
    "netProfit" REAL NOT NULL DEFAULT 0,
    "pips" REAL,
    "rMultiple" REAL,
    "holdingMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "incompleteHistory" BOOLEAN NOT NULL DEFAULT false,
    "magicNumber" BIGINT,
    "mt5Comment" TEXT,
    "strategyId" TEXT,
    "mistakes" TEXT NOT NULL DEFAULT '[]',
    "emotion" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "magicNumbers" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "balance" REAL NOT NULL,
    "equity" REAL NOT NULL,
    CONSTRAINT "EquitySnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CashFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'BALANCE',
    "externalId" BIGINT,
    "comment" TEXT,
    CONSTRAINT "CashFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MT5_SYNC',
    "status" TEXT NOT NULL DEFAULT 'OK',
    "message" TEXT NOT NULL,
    "tradesInserted" INTEGER NOT NULL DEFAULT 0,
    "tradesUpdated" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SyncLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Trade_accountId_closeTime_idx" ON "Trade"("accountId", "closeTime");
CREATE INDEX "Trade_accountId_status_idx" ON "Trade"("accountId", "status");
CREATE INDEX "Trade_accountId_positionTicket_idx" ON "Trade"("accountId", "positionTicket");
CREATE INDEX "Trade_accountId_strategyId_idx" ON "Trade"("accountId", "strategyId");
CREATE INDEX "Trade_symbol_idx" ON "Trade"("symbol");
CREATE UNIQUE INDEX "Trade_accountId_dealTicket_key" ON "Trade"("accountId", "dealTicket");
CREATE UNIQUE INDEX "Strategy_name_key" ON "Strategy"("name");
CREATE UNIQUE INDEX "EquitySnapshot_accountId_ts_key" ON "EquitySnapshot"("accountId", "ts");
CREATE INDEX "CashFlow_accountId_ts_idx" ON "CashFlow"("accountId", "ts");
CREATE UNIQUE INDEX "CashFlow_accountId_externalId_key" ON "CashFlow"("accountId", "externalId");
CREATE INDEX "SyncLog_accountId_ts_idx" ON "SyncLog"("accountId", "ts");
`

/**
 * v1.2.x → v1.3.0. Generated by `prisma migrate diff` (old real database →
 * new schema datamodel) and extended with two data-preserving backfills:
 * positionTicket mirrors the legacy 32-bit positionId, and the seeded demo
 * account is labelled DEMO. The Trade rebuild REMOVES the legacy global
 * unique index on positionId (32-bit) — full 64-bit tickets now live in
 * positionTicket/dealTicket with per-account uniqueness.
 */
const UPGRADE_V12_TO_V13_SQL = `
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "magicNumbers" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'demo',
    "name" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "mt5Login" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "initialBalance" REAL NOT NULL,
    "tradeMode" TEXT NOT NULL DEFAULT 'REAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Account" ("broker", "createdAt", "currency", "id", "initialBalance", "leverage", "mt5Login", "name", "server", "updatedAt") SELECT "broker", "createdAt", "currency", "id", "initialBalance", "leverage", "mt5Login", "name", "server", "updatedAt" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE TABLE "new_CashFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'BALANCE',
    "externalId" BIGINT,
    "comment" TEXT,
    CONSTRAINT "CashFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CashFlow" ("accountId", "amount", "comment", "id", "ts", "type") SELECT "accountId", "amount", "comment", "id", "ts", "type" FROM "CashFlow";
DROP TABLE "CashFlow";
ALTER TABLE "new_CashFlow" RENAME TO "CashFlow";
CREATE INDEX "CashFlow_accountId_ts_idx" ON "CashFlow"("accountId", "ts");
CREATE UNIQUE INDEX "CashFlow_accountId_externalId_key" ON "CashFlow"("accountId", "externalId");
CREATE TABLE "new_Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "positionId" INTEGER,
    "positionTicket" BIGINT,
    "dealTicket" BIGINT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME,
    "openPrice" REAL NOT NULL,
    "closePrice" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "initialStopLoss" REAL,
    "riskAmount" REAL,
    "commission" REAL NOT NULL DEFAULT 0,
    "swap" REAL NOT NULL DEFAULT 0,
    "profit" REAL NOT NULL DEFAULT 0,
    "netProfit" REAL NOT NULL DEFAULT 0,
    "pips" REAL,
    "rMultiple" REAL,
    "holdingMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "incompleteHistory" BOOLEAN NOT NULL DEFAULT false,
    "magicNumber" BIGINT,
    "mt5Comment" TEXT,
    "strategyId" TEXT,
    "mistakes" TEXT NOT NULL DEFAULT '[]',
    "emotion" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Trade" ("accountId", "closePrice", "closeTime", "commission", "createdAt", "direction", "emotion", "holdingMinutes", "id", "mistakes", "netProfit", "notes", "openPrice", "openTime", "pips", "positionId", "profit", "rMultiple", "status", "stopLoss", "swap", "symbol", "takeProfit", "updatedAt", "volume") SELECT "accountId", "closePrice", "closeTime", "commission", "createdAt", "direction", "emotion", "holdingMinutes", "id", "mistakes", "netProfit", "notes", "openPrice", "openTime", "pips", "positionId", "profit", "rMultiple", "status", "stopLoss", "swap", "symbol", "takeProfit", "updatedAt", "volume" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE INDEX "Trade_accountId_closeTime_idx" ON "Trade"("accountId", "closeTime");
CREATE INDEX "Trade_accountId_status_idx" ON "Trade"("accountId", "status");
CREATE INDEX "Trade_accountId_positionTicket_idx" ON "Trade"("accountId", "positionTicket");
CREATE INDEX "Trade_accountId_strategyId_idx" ON "Trade"("accountId", "strategyId");
CREATE INDEX "Trade_symbol_idx" ON "Trade"("symbol");
CREATE UNIQUE INDEX "Trade_accountId_dealTicket_key" ON "Trade"("accountId", "dealTicket");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
CREATE UNIQUE INDEX "Strategy_name_key" ON "Strategy"("name");
CREATE INDEX "SyncLog_accountId_ts_idx" ON "SyncLog"("accountId", "ts");
-- data-preserving backfills (v1.3.0)
UPDATE "Trade" SET "positionTicket" = "positionId" WHERE "positionTicket" IS NULL AND "positionId" IS NOT NULL;
UPDATE "Account" SET "tradeMode" = 'DEMO' WHERE "id" = 'demo';
`

export interface MigrationScript {
  id: string
  description: string
  /**
   * Idempotency guard: true when this script still needs to run.
   * Evaluated via PRAGMA lookups so it works on any legacy state.
   */
  pending: (q: MigrationQueryRunner) => Promise<boolean>
  statements: string[]
  /**
   * Scripts that rebuild tables (DROP/CREATE with FK references) MUST run
   * with `PRAGMA foreign_keys=OFF` — and that pragma is a NO-OP inside a
   * transaction, so the runner has to set it in autocommit BEFORE opening
   * the transaction, then verify with `PRAGMA foreign_key_check` before
   * committing. Without this, dropping a parent table CASCADE-DELETES the
   * rows of every child table still referencing it (data loss!).
   */
  foreignKeysOff?: boolean
}

export interface MigrationQueryRunner {
  /** SELECT … as typed rows (used for PRAGMA table_info etc.). */
  query: (sql: string) => Promise<Record<string, unknown>[]>
  /** Single raw statement (no result expected). */
  execute: (sql: string) => Promise<unknown>
}

async function tableExists(q: MigrationQueryRunner, table: string): Promise<boolean> {
  const rows = await q.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
  )
  return rows.length > 0
}

async function columnExists(q: MigrationQueryRunner, table: string, column: string): Promise<boolean> {
  const rows = await q.query(`PRAGMA table_info("${table}")`)
  return rows.some((r) => String(r.name) === column)
}

export const MIGRATIONS: MigrationScript[] = [
  {
    id: '0001_baseline',
    description: 'Fresh database — create every table/index of the v1.3.0 schema',
    pending: async (q) => !(await tableExists(q, 'Account')),
    statements: splitSql(
      BASELINE_SQL.replace(/\bCREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/\bCREATE UNIQUE INDEX /g, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
        .replace(/\bCREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ')
    ),
  },
  {
    id: '0002_risk_strategy_multiaccount',
    description:
      'v1.2.x → v1.3.0: 64-bit trade identity, per-deal legs, Strategy, cashflow categories — all legacy rows copied forward',
    pending: async (q) =>
      (await tableExists(q, 'Account')) && !(await columnExists(q, 'Account', 'tradeMode')),
    foreignKeysOff: true, // table redefinitions: DROP TABLE Account must NOT cascade into child rows
    statements: splitSql(UPGRADE_V12_TO_V13_SQL),
  },
]

/** Split a SQL script into single statements on top-level semicolons. */
export function splitSql(script: string): string[] {
  const out: string[] = []
  let current = ''
  let inString = false
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    if (ch === "'") {
      // SQLite escapes single quotes by doubling them
      if (inString && script[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = !inString
    }
    if (ch === ';' && !inString) {
      const stmt = current.trim()
      if (stmt && !stmt.split('\n').every((l) => l.trim().startsWith('--') || l.trim() === '')) {
        out.push(stmt)
      }
      current = ''
      continue
    }
    current += ch
  }
  const tail = current.trim()
  if (tail && !tail.split('\n').every((l) => l.trim().startsWith('--') || l.trim() === '')) {
    out.push(tail)
  }
  return out
}
