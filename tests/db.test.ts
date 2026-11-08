// ─── Database safety tests: migrations, sync processing, retention ───────────
// Runs against a THROWAWAY SQLite file in the OS temp dir — never touches the
// developer's real db/custom.db.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = mkdtempSync(path.join(os.tmpdir(), 'pti-dbtest-'))
process.env.DATABASE_URL = 'file:' + path.join(TMP, 'test.db')

// Dynamic import AFTER the env var is set (ESM imports hoist — the singleton
// PrismaClient must be constructed with the test database).
let db: import('@prisma/client').PrismaClient
// bootstrapDatabase statically imports the db singleton → dynamic only
type Bootstrap = () => Promise<{ applied: string[]; skipped: string[] }>
let bootstrapDatabase: Bootstrap

import { splitSql } from '../src/lib/db-migrations'

async function raw<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return db.$queryRawUnsafe(sql)
}
async function exec(sql: string): Promise<void> {
  await db.$executeRawUnsafe(sql)
}

/** Drop EVERYTHING (guarded migration re-runs need a clean slate). */
async function wipeSchema(): Promise<void> {
  const { resetBootstrapMemo } = await import('../src/lib/db-bootstrap')
  resetBootstrapMemo()
  await exec(`PRAGMA foreign_keys=OFF`)
  for (const t of ['SyncLog', 'EquitySnapshot', 'CashFlow', 'Trade', 'Strategy', 'Account', '_PtiMigration', 'new_Trade', 'new_Account', 'new_CashFlow']) {
    await exec(`DROP TABLE IF EXISTS "${t}"`)
  }
  await exec(`PRAGMA foreign_keys=ON`)
}

beforeAll(async () => {
  const mod = await import('../src/lib/db')
  db = mod.db
  const boot = await import('../src/lib/db-bootstrap')
  bootstrapDatabase = boot.bootstrapDatabase
})

afterAll(async () => {
  try {
    await db.$disconnect()
  } catch {}
  rmSync(TMP, { recursive: true, force: true })
})

describe('SQL script splitting', () => {
  test('splits on top-level semicolons, keeps quoted semicolons intact', () => {
    const parts = splitSql(`INSERT INTO t VALUES ('a;b');
CREATE TABLE "x" ("v" TEXT);
-- just a comment
UPDATE t SET v='it''s';`)
    expect(parts.length).toBe(3)
    expect(parts[0]).toContain("'a;b'")
    expect(parts[2]).toContain("it''s")
  })
})

describe('migration 0002 — v1.2.x upgrade preserves every row', () => {
  test('legacy schema → new schema with backfills, no data loss', async () => {
    await wipeSchema()
    // recreate the EXACT v1.2.x schema (positionId Int @unique, no Strategy…)
    await exec(`CREATE TABLE "Account" (
      "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'demo',
      "name" TEXT NOT NULL, "broker" TEXT NOT NULL, "server" TEXT NOT NULL,
      "mt5Login" TEXT, "currency" TEXT NOT NULL DEFAULT 'USD',
      "leverage" INTEGER NOT NULL DEFAULT 100, "initialBalance" REAL NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`)
    await exec(`CREATE TABLE "Trade" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "accountId" TEXT NOT NULL, "positionId" INTEGER NOT NULL,
      "symbol" TEXT NOT NULL, "direction" TEXT NOT NULL, "volume" REAL NOT NULL,
      "openTime" DATETIME NOT NULL, "closeTime" DATETIME,
      "openPrice" REAL NOT NULL, "closePrice" REAL,
      "stopLoss" REAL, "takeProfit" REAL,
      "commission" REAL NOT NULL DEFAULT 0, "swap" REAL NOT NULL DEFAULT 0,
      "profit" REAL NOT NULL DEFAULT 0, "netProfit" REAL NOT NULL DEFAULT 0,
      "pips" REAL, "rMultiple" REAL, "holdingMinutes" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'CLOSED', "mistakes" TEXT NOT NULL DEFAULT '[]',
      "emotion" TEXT, "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE)`)
    await exec(`CREATE TABLE "CashFlow" ("id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "ts" DATETIME NOT NULL, "type" TEXT NOT NULL, "amount" REAL NOT NULL, "comment" TEXT)`)
    await exec(`CREATE TABLE "EquitySnapshot" ("id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "ts" DATETIME NOT NULL, "balance" REAL NOT NULL, "equity" REAL NOT NULL)`)
    await exec(`CREATE TABLE "SyncLog" ("id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "source" TEXT NOT NULL DEFAULT 'MT5_SYNC', "status" TEXT NOT NULL DEFAULT 'OK', "message" TEXT NOT NULL, "tradesInserted" INTEGER NOT NULL DEFAULT 0, "tradesUpdated" INTEGER NOT NULL DEFAULT 0)`)
    await exec(`CREATE UNIQUE INDEX "Trade_positionId_key" ON "Trade"("positionId")`)

    await exec(`INSERT INTO "Account" ("id","name","broker","server","mt5Login","currency","leverage","initialBalance","createdAt","updatedAt")
                VALUES ('demo','Old Account','BrokerX','Srv','51234567','USD',100,10000,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    await exec(`INSERT INTO "Trade" ("id","accountId","positionId","symbol","direction","volume","openTime","closeTime","openPrice","closePrice","commission","swap","profit","netProfit","status","mistakes","notes","createdAt","updatedAt")
                VALUES ('t1','demo',4242,'EURUSD','BUY',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1.1,1.2,-3,0,100,97,'CLOSED','[]','real trader note',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    await exec(`INSERT INTO "Trade" ("id","accountId","positionId","symbol","direction","volume","openTime","openPrice","commission","swap","profit","netProfit","status","mistakes","notes","createdAt","updatedAt")
                VALUES ('t2','demo',999999999,'XAUUSD','SELL',0.5,CURRENT_TIMESTAMP,2400,-2,0,0,-2,'OPEN','[]',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    await exec(`INSERT INTO "CashFlow" ("id","accountId","ts","type","amount","comment") VALUES ('c1','demo',CURRENT_TIMESTAMP,'DEPOSIT',10000,'Initial deposit')`)

    const { applied } = await bootstrapDatabase()
    expect(applied).toContain('0002_risk_strategy_multiaccount')

    // every legacy row survived
    const trades = await raw<{ id: string; positionId: number; positionTicket: bigint | null; notes: string | null; netProfit: number }>(`SELECT * FROM "Trade" ORDER BY "id"`)
    expect(trades.length).toBe(2)
    const t1 = trades.find((t) => t.id === 't1')!
    expect(t1.notes).toBe('real trader note')
    expect(t1.netProfit).toBe(97)
    expect(Number(t1.positionTicket)).toBe(4242) // backfilled from positionId
    const t2 = trades.find((t) => t.id === 't2')!
    // 999,999,999 fits in 32 bits → legacy column kept AND backfilled
    expect(Number(t2.positionTicket)).toBe(999999999)
    // new columns exist with safe defaults
    expect(trades.every((t) => !('dealTicket' in t ? false : false))).toBe(true)
    const cols = await raw(`PRAGMA table_info("Trade")`)
    const names = cols.map((c) => String((c as Record<string, unknown>).name))
    for (const expected of ['positionTicket', 'dealTicket', 'magicNumber', 'strategyId', 'initialStopLoss', 'riskAmount', 'incompleteHistory']) {
      expect(names).toContain(expected)
    }
    // the 32-bit global unique index is GONE (per-account 64-bit identity now)
    const indexes = await raw(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Trade'`)
    const idxNames = indexes.map((i) => String((i as Record<string, unknown>).name))
    expect(idxNames).not.toContain('Trade_positionId_key')
    expect(idxNames).toContain('Trade_accountId_dealTicket_key')
    // cashflow rows preserved + new columns present
    const cfs = await raw<Record<string, unknown>[]>(`SELECT * FROM "CashFlow"`)
    expect(cfs.length).toBe(1)
    const cfCols = (await raw(`PRAGMA table_info("CashFlow")`)).map((c) => String((c as Record<string, unknown>).name))
    expect(cfCols).toContain('category')
    expect(cfCols).toContain('externalId')
    // demo account labelled DEMO
    const acc = (await raw<{ tradeMode: string }>(`SELECT "tradeMode" FROM "Account" WHERE id='demo'`))[0]
    expect(acc.tradeMode).toBe('DEMO')
  })
})

describe('migration 0001 — fresh database baseline', () => {
  test('creates the whole schema; second run is a no-op', async () => {
    await wipeSchema()
    const { applied } = await bootstrapDatabase()
    expect(applied).toContain('0001_baseline')
    for (const t of ['Account', 'Trade', 'Strategy', 'EquitySnapshot', 'CashFlow', 'SyncLog']) {
      const rows = await raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`)
      expect(rows.length).toBe(1)
    }
    // idempotent (memo reset — bootstrap never runs twice per process)
    const { resetBootstrapMemo } = await import('../src/lib/db-bootstrap')
    resetBootstrapMemo()
    const second = await bootstrapDatabase()
    expect(second.applied.length).toBe(0)
  })
})

// ─── Sync payload processing (P1) ────────────────────────────────────────────

function legBody(login: number, server: string, dealTicket: number, positionTicket: string) {
  return {
    account: { login, server, name: `acc-${login}`, currency: 'USD', leverage: 100, tradeMode: 'REAL' as const },
    trades: [
      {
        positionTicket,
        dealTicket: String(dealTicket),
        positionId: null,
        symbol: 'XAUUSD',
        direction: 'BUY' as const,
        volume: 1,
        openTime: '2024-01-01T10:00:00Z',
        closeTime: '2024-01-01T11:00:00Z',
        openPrice: 100,
        closePrice: 102,
        commission: -3,
        swap: 0,
        profit: 200,
        netProfit: 197,
        status: 'CLOSED' as const,
      },
    ],
    cashflows: [],
    snapshot: { balance: 1197, equity: 1197 },
  }
}

async function cleanRows(): Promise<void> {
  await exec('DELETE FROM "SyncLog"')
  await exec('DELETE FROM "EquitySnapshot"')
  await exec('DELETE FROM "CashFlow"')
  await exec('DELETE FROM "Trade"')
  await exec('DELETE FROM "Strategy"')
  await exec('DELETE FROM "Account"')
}

describe('processSyncPayload — identity & idempotency', () => {
  test('two accounts with the SAME position ticket stay fully independent', async () => {
    const { processSyncPayload } = await import('../src/lib/mt5-sync')
    await cleanRows()
    const a = await processSyncPayload(legBody(111, 'Server-One', 5001, '42424242424') as never, { db })
    const b = await processSyncPayload(legBody(222, 'Server-Two', 5001, '42424242424') as never, { db })
    expect(a.inserted).toBe(1)
    expect(b.inserted).toBe(1)
    const trades = await raw<{ accountId: string }>(`SELECT "accountId" FROM "Trade"`)
    expect(trades.length).toBe(2)
    expect(new Set(trades.map((t) => t.accountId)).size).toBe(2)
    // account ids are structured and distinct
    expect(a.accountId).not.toBe(b.accountId)
  })

  test('replaying the same payload never duplicates', async () => {
    const { processSyncPayload } = await import('../src/lib/mt5-sync')
    await cleanRows()
    const body = legBody(333, 'Replay-Server', 6001, '42424242425') as never
    const first = await processSyncPayload(body, { db })
    expect(first.inserted).toBe(1)
    const second = await processSyncPayload(body, { db })
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(1)
    const count = (await raw<{ n: bigint }>(`SELECT COUNT(*) as n FROM "Trade"`))[0]
    expect(Number(count.n)).toBe(1)
  })
})

describe('processSyncPayload — partial close lifecycle', () => {
  test('open row → partial leg → full close removes the shell row exactly once', async () => {
    const { processSyncPayload } = await import('../src/lib/mt5-sync')
    await cleanRows()
    const acc = { login: 777, server: 'Partial-Server', tradeMode: 'REAL' as const }

    // 1) live open position (1 lot)
    await processSyncPayload(
      {
        account: acc,
        trades: [
          {
            positionTicket: '9888', dealTicket: null, positionId: null, symbol: 'XAUUSD',
            direction: 'BUY' as const, volume: 1, openTime: '2024-02-01T10:00:00Z', closeTime: null,
            openPrice: 100, closePrice: null, commission: 0, swap: 0, profit: 150, netProfit: 150,
            status: 'OPEN' as const,
          },
        ],
        snapshot: { balance: 1000, equity: 1150 },
      } as never,
      { db }
    )
    let rows = await raw<{ id: string; status: string }>(`SELECT id, status FROM "Trade"`)
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('OPEN')

    // 2) partial close: 0.5 lot realized; position still open (0.5 remaining)
    await processSyncPayload(
      {
        account: acc,
        trades: [
          {
            positionTicket: '9888', dealTicket: '6001', positionId: null, symbol: 'XAUUSD',
            direction: 'BUY' as const, volume: 0.5, openTime: '2024-02-01T10:00:00Z',
            closeTime: '2024-02-01T11:00:00Z', openPrice: 100, closePrice: 103,
            commission: -2, swap: -0.2, profit: 150, netProfit: 147.8,
            status: 'CLOSED' as const,
          },
          {
            positionTicket: '9888', dealTicket: null, positionId: null, symbol: 'XAUUSD',
            direction: 'BUY' as const, volume: 0.5, openTime: '2024-02-01T10:00:00Z', closeTime: null,
            openPrice: 100, closePrice: null, commission: 0, swap: 0, profit: 80, netProfit: 80,
            status: 'OPEN' as const,
          },
        ],
        snapshot: { balance: 1147.8, equity: 1227.8 },
      } as never,
      { db }
    )
    rows = await raw<{ id: string; status: string; dealTicket: bigint | null }>(`SELECT id, status, "dealTicket" FROM "Trade" ORDER BY status`)
    expect(rows.length).toBe(2) // one OPEN shell + one realized leg
    expect(rows.filter((r) => r.status === 'CLOSED').length).toBe(1)
    expect(rows.filter((r) => r.status === 'OPEN').length).toBe(1)

    // 3) full close: second leg arrives, no live position → shell row removed
    const res = await processSyncPayload(
      {
        account: acc,
        trades: [
          {
            positionTicket: '9888', dealTicket: '6001', positionId: null, symbol: 'XAUUSD',
            direction: 'BUY' as const, volume: 0.5, openTime: '2024-02-01T10:00:00Z',
            closeTime: '2024-02-01T11:00:00Z', openPrice: 100, closePrice: 103,
            commission: -2, swap: -0.2, profit: 150, netProfit: 147.8,
            status: 'CLOSED' as const,
          },
          {
            positionTicket: '9888', dealTicket: '6002', positionId: null, symbol: 'XAUUSD',
            direction: 'BUY' as const, volume: 0.5, openTime: '2024-02-01T10:00:00Z',
            closeTime: '2024-02-01T12:00:00Z', openPrice: 100, closePrice: 99,
            commission: -2, swap: -0.1, profit: -50, netProfit: -52.1,
            status: 'CLOSED' as const,
          },
        ],
        snapshot: { balance: 1095.7, equity: 1095.7 },
      } as never,
      { db }
    )
    expect(res.openRowsClosed).toBe(1)
    rows = await raw<{ id: string; status: string; dealTicket: bigint | null }>(`SELECT id, status, "dealTicket" FROM "Trade"`)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.status === 'CLOSED')).toBe(true)
    // realized money = sum of legs — nothing lost, nothing duplicated
    const sum = (await raw<{ s: number }>(`SELECT ROUND(SUM("netProfit"),2) as s FROM "Trade"`))[0]
    expect(sum.s).toBe(95.7)
  })
})

describe('processSyncPayload — balance identity & reconciliation', () => {
  test('initial balance reconstructs exactly; CREDIT is excluded from the identity', async () => {
    const { processSyncPayload } = await import('../src/lib/mt5-sync')
    await cleanRows()
    const res = await processSyncPayload(
      {
        account: { login: 999, server: 'Recon-Server', tradeMode: 'REAL' as const },
        trades: [
          {
            positionTicket: '9777', dealTicket: '7001', positionId: null, symbol: 'EURUSD',
            direction: 'SELL' as const, volume: 1, openTime: '2024-03-01T10:00:00Z',
            closeTime: '2024-03-01T12:00:00Z', openPrice: 1.1, closePrice: 1.09,
            commission: -4, swap: -1, profit: 305, netProfit: 300,
            status: 'CLOSED' as const,
          },
        ],
        cashflows: [
          { ts: '2024-03-01T09:00:00Z', type: 'DEPOSIT' as const, amount: 10000, category: 'BALANCE' as const, externalId: '900', comment: 'Initial deposit' },
          { ts: '2024-03-01T09:30:00Z', type: 'DEPOSIT' as const, amount: 5000, category: 'CREDIT' as const, externalId: '901', comment: 'credit' },
        ],
        snapshot: { balance: 10300, equity: 10300 },
      } as never,
      { db }
    )
    // identity: 10300 = initial + 10000 (CREDIT excluded!) + 300 → initial = 0
    const acc = (await raw<{ initialBalance: number }>(`SELECT "initialBalance" FROM "Account"`))[0]
    expect(acc.initialBalance).toBe(0)
    expect(res.reconciliation.diff).toBe(0)
    expect(res.reconciliation.netCash).toBe(10000)
    // replay → cashflows not duplicated
    const again = await processSyncPayload(
      {
        account: { login: 999, server: 'Recon-Server', tradeMode: 'REAL' as const },
        trades: [],
        cashflows: [
          { ts: '2024-03-01T09:00:00Z', type: 'DEPOSIT' as const, amount: 10000, category: 'BALANCE' as const, externalId: '900', comment: 'Initial deposit' },
        ],
        snapshot: { balance: 10300, equity: 10300 },
      } as never,
      { db }
    )
    expect(again.cashflowsAdded).toBe(0)
  })
})

describe('processSyncPayload — transaction atomicity', () => {
  test('a failure mid-transaction leaves ZERO traces', async () => {
    const { processSyncPayload } = await import('../src/lib/mt5-sync')
    await cleanRows()

    // wrapper db that injects a failure into the SECOND cashflow insert
    let cfCalls = 0
    const failingDb = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
        db.$transaction(async (tx) => {
          const wrapped = {
            account: tx.account,
            trade: tx.trade,
            equitySnapshot: tx.equitySnapshot,
            cashFlow: {
              ...tx.cashFlow,
              create: async (args: unknown) => {
                cfCalls++
                if (cfCalls >= 2) throw new Error('INJECTED_FAILURE')
                return tx.cashFlow.create(args as never)
              },
            },
          }
          return fn(wrapped)
        }, opts as never),
    }

    await expect(
      processSyncPayload(
        {
          account: { login: 555, server: 'Atomic-Server', tradeMode: 'REAL' as const },
          trades: [legBody(555, 'Atomic-Server', 8001, '42424242426').trades[0]],
          cashflows: [
            { ts: '2024-03-01T09:00:00Z', type: 'DEPOSIT' as const, amount: 100, category: 'BALANCE' as const, externalId: '910', comment: null },
            { ts: '2024-03-01T09:05:00Z', type: 'DEPOSIT' as const, amount: 200, category: 'BALANCE' as const, externalId: '911', comment: null },
          ],
          snapshot: { balance: 300, equity: 300 },
        } as never,
        { db: failingDb as never }
      )
    ).rejects.toThrow('INJECTED_FAILURE')

    // nothing persisted: no account, no trade, no cashflow from that payload
    const accounts = await raw<{ n: bigint }>(`SELECT COUNT(*) as n FROM "Account"`)
    const trades = await raw<{ n: bigint }>(`SELECT COUNT(*) as n FROM "Trade"`)
    const cfs = await raw<{ n: bigint }>(`SELECT COUNT(*) as n FROM "CashFlow"`)
    expect(Number(accounts[0].n)).toBe(0)
    expect(Number(trades[0].n)).toBe(0)
    expect(Number(cfs[0].n)).toBe(0)
  })
})

describe('retention policy (P5)', () => {
  test('old snapshots downsample to one per day; sync log capped at 200', async () => {
    const { pruneRetention } = await import('../src/lib/retention')
    await cleanRows()
    const acc = await db.account.create({
      data: { id: 'ret', name: 'Retention', broker: 'b', server: 's', initialBalance: 1 },
    })
    // 40 snapshots on 10 fixed UTC days (midday ±1h → always one UTC day per
    // group) 51–60 days ago + 5 fresh raw rows
    for (let d = 0; d < 10; d++) {
      for (const hour of [11, 12, 13, 14]) {
        const day = new Date(Date.now() - (60 - d) * 864e5)
        await db.equitySnapshot.create({
          data: {
            accountId: acc.id,
            ts: new Date(
              Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0)
            ),
            balance: 1000,
            equity: 1000,
          },
        })
      }
    }
    for (let i = 0; i < 5; i++) {
      await db.equitySnapshot.create({
        data: { accountId: acc.id, ts: new Date(Date.now() - i * 60_000), balance: 1000, equity: 1000 },
      })
    }
    // 210 sync logs
    for (let i = 0; i < 210; i++) {
      await db.syncLog.create({ data: { accountId: acc.id, message: `log ${i}` } })
    }

    await pruneRetention(db, acc.id)

    const snaps = await db.equitySnapshot.count({ where: { accountId: acc.id } })
    // 10 old days → 10 daily rows + 5 fresh raw rows = 15 (was 45)
    expect(snaps).toBe(15)
    const logs = await db.syncLog.count({ where: { accountId: acc.id } })
    expect(logs).toBe(200)
  })
})
