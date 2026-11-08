// ─── Desktop user-data layer tests (P0) ──────────────────────────────────────
// Exercises desktop-build/user-data.js: fresh install, legacy migration with
// backup, never-overwrite guarantee, and corrupt-file rejection.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureDatabase, resolveDataPaths, isSqliteFile } from '../desktop-build/user-data.js'

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), 'pti-userdata-'))
}

const SQLITE_HEADER = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4096 - 16, 7)])
const JUNK = Buffer.from('this is definitely not a sqlite database, just noise'.repeat(100))

function makeLegacy(root: string, content: Buffer) {
  const appDir = path.join(root, 'resources', 'app')
  mkdirSync(path.join(appDir, 'db'), { recursive: true })
  const legacy = path.join(appDir, 'db', 'custom.db')
  writeFileSync(legacy, content)
  return { appDir, legacy }
}

describe('user-data paths', () => {
  test('resolveDataPaths puts the db outside the program folder', () => {
    const userDataDir = path.join('/tmp', 'pti-ud')
    const p = resolveDataPaths({ appDir: '/install/resources/app', userDataDir })
    expect(p.dbFile.startsWith(userDataDir)).toBe(true)
    expect(p.dbFile.endsWith('data' + path.sep + 'custom.db')).toBe(true)
    expect(p.dbFile.includes('resources')).toBe(false)
  })

  test('isSqliteFile validates the magic header', () => {
    expect(isSqliteFile('/dev/null')).toBe(false)
  })
})

describe('ensureDatabase scenarios', () => {
  test('fresh install → no db file created here (server creates schema)', async () => {
    const root = scratch()
    try {
      const p = resolveDataPaths({ appDir: path.join(root, 'app'), userDataDir: root })
      const r = await ensureDatabase(p)
      expect(r.status).toBe('fresh')
      expect(existsSync(p.dbFile)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('legacy v1.2.x db → migrated atomically with a backup', async () => {
    const root = scratch()
    try {
      const { appDir, legacy } = makeLegacy(root, SQLITE_HEADER)
      const p = resolveDataPaths({ appDir, userDataDir: root })
      const r = await ensureDatabase(p)
      expect(r.status).toBe('migrated')
      // new db exists with identical bytes
      expect(existsSync(p.dbFile)).toBe(true)
      expect(readFileSync(p.dbFile).equals(SQLITE_HEADER)).toBe(true)
      // independent backup copy exists next to it
      expect(r.backupFile && existsSync(r.backupFile)).toBe(true)
      // legacy original is preserved untouched
      expect(existsSync(legacy)).toBe(true)
      expect(readFileSync(legacy).equals(SQLITE_HEADER)).toBe(true)
      // no temp leftovers
      expect(existsSync(p.dbFile + '.migrating-tmp')).toBe(false)
      // marker documents the migration
      const marker = JSON.parse(readFileSync(path.join(p.dataDir, 'migration.json'), 'utf8'))
      expect(marker.migratedFrom).toBe(legacy)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('existing new-style db is NEVER overwritten (update/reinstall path)', async () => {
    const root = scratch()
    try {
      const { appDir } = makeLegacy(root, SQLITE_HEADER)
      const p = resolveDataPaths({ appDir, userDataDir: root })
      await ensureDatabase(p)
      // simulate newer data
      const newer = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4096 - 16, 9)])
      writeFileSync(p.dbFile, newer)
      const r2 = await ensureDatabase(p)
      expect(r2.status).toBe('reused')
      // the newer database was NOT replaced by the older legacy copy
      expect(readFileSync(p.dbFile).equals(newer)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('corrupt legacy file is refused, never propagated', async () => {
    const root = scratch()
    try {
      const { appDir, legacy } = makeLegacy(root, JUNK)
      const p = resolveDataPaths({ appDir, userDataDir: root })
      const r = await ensureDatabase(p)
      expect(r.status).toBe('fresh-after-corrupt-legacy')
      expect(existsSync(p.dbFile)).toBe(false)
      expect(existsSync(legacy)).toBe(true) // untouched for manual recovery
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('empty legacy file → fresh (nothing to migrate)', async () => {
    const root = scratch()
    try {
      const { appDir } = makeLegacy(root, Buffer.alloc(0))
      const p = resolveDataPaths({ appDir, userDataDir: root })
      const r = await ensureDatabase(p)
      expect(r.status).toBe('fresh')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
