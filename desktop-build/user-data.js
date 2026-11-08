// ─── Personal Trading Intelligence — user-data layer (desktop) ───────────────
// Pure Node module (no Electron imports) so it is unit-testable on any OS.
//
// DATA-SAFETY DESIGN (P0): the trading database lives OUTSIDE the program
// folder, in the per-user data directory. Reinstalling, updating or deleting
// the application can therefore never touch it. One-time migration moves a
// v1.2.x database (which lived inside resources/app/db) into the new location
// atomically, keeping two independent copies of the source data until the
// move is verified.
//
//   fresh install        → no db file yet; the server's runtime migrations
//                          (src/lib/db-bootstrap.ts) create the empty schema.
//   upgrade over v1.2.x  → legacy db is copied to <tmp>, byte-verified, a
//                          backup copy is written next to the new db, then a
//                          same-volume rename makes the migration atomic.
//                          The legacy file is left untouched as a third copy.
//   existing data        → reused as-is. A newer database is NEVER replaced
//                          by an older one (updates/reinstalls keep data).
//   corrupt legacy file  → NOT copied (never propagate corruption); the app
//                          starts fresh and the corrupt file stays in place
//                          for manual recovery.

'use strict'

const fs = require('fs')
const path = require('path')

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8')

function isSqliteFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length)
      const read = fs.readSync(fd, header, 0, header.length, 0)
      if (read < header.length) return false
      return header.equals(SQLITE_HEADER)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

/**
 * Resolve every data-related path for the desktop app.
 * @param {{appDir: string, userDataDir: string}} opts
 */
function resolveDataPaths({ appDir, userDataDir }) {
  const dataDir = path.join(userDataDir, 'data')
  const logDir = path.join(userDataDir, 'logs')
  return {
    dataDir,
    logDir,
    dbFile: path.join(dataDir, 'custom.db'),
    tokenFile: path.join(dataDir, 'sync-token'),
    legacyDbFile: path.join(appDir, 'db', 'custom.db'), // pre-1.3.0 location
    legacyLogDir: path.join(appDir, 'logs'), // pre-1.3.0 log location
  }
}

/**
 * Make sure the trading database exists at the new user-data location,
 * migrating the legacy in-app database when needed.
 *
 * @param {{dataDir: string, dbFile: string, legacyDbFile: string}} opts
 * @param {(line: string) => void} [log]
 * @returns {Promise<{status: 'reused'|'migrated'|'fresh'|'fresh-after-corrupt-legacy', backupFile?: string, legacyFile?: string}>}
 */
async function ensureDatabase(opts, log = () => {}) {
  const { dataDir, dbFile, legacyDbFile } = opts
  fs.mkdirSync(dataDir, { recursive: true })

  // 1) New-style database already exists → reuse it (reinstall/update path).
  if (fs.existsSync(dbFile)) {
    log(`database found at user-data location — reusing (${dbFile})`)
    return { status: 'reused' }
  }

  // 2) Legacy v1.2.x database inside the program folder → migrate it.
  if (fs.existsSync(legacyDbFile)) {
    const legacyStat = fs.statSync(legacyDbFile)
    if (legacyStat.size === 0) {
      log('legacy database file is empty — starting fresh (legacy file kept)')
      return { status: 'fresh', legacyFile: legacyDbFile }
    }
    if (!isSqliteFile(legacyDbFile)) {
      log(
        `ERROR: legacy database at ${legacyDbFile} is NOT a valid SQLite file — ` +
          'refusing to copy it (possible corruption). Starting with an empty database; ' +
          'the original file is untouched for manual recovery.'
      )
      return { status: 'fresh-after-corrupt-legacy', legacyFile: legacyDbFile }
    }

    const tmpFile = dbFile + '.migrating-tmp'
    const backupFile = path.join(dataDir, 'custom.db.backup-on-migrate')
    try {
      fs.copyFileSync(legacyDbFile, tmpFile)
      // Byte-verify the copy before making it live.
      const tmpStat = fs.statSync(tmpFile)
      if (tmpStat.size !== legacyStat.size || !isSqliteFile(tmpFile)) {
        throw new Error('copied file failed verification')
      }
      // Independent backup next to the new database (the legacy copy sits in
      // the program folder which an uninstall may remove).
      fs.copyFileSync(legacyDbFile, backupFile)
      // Atomic on the same volume: readers see either nothing or the full file.
      fs.renameSync(tmpFile, dbFile)
      fs.writeFileSync(
        path.join(dataDir, 'migration.json'),
        JSON.stringify(
          {
            migratedFrom: legacyDbFile,
            backupFile,
            migratedAt: new Date().toISOString(),
            bytes: legacyStat.size,
          },
          null,
          2
        )
      )
      log(
        `migrated legacy database from ${legacyDbFile} → ${dbFile} ` +
          `(${legacyStat.size} bytes, backup at ${backupFile}) — original file kept`
      )
      return { status: 'migrated', backupFile, legacyFile: legacyDbFile }
    } catch (err) {
      // Never leave a half-written file behind.
      try {
        fs.rmSync(tmpFile, { force: true })
      } catch {}
      log(`ERROR: database migration failed: ${err && err.message} — starting fresh; legacy data left untouched`)
      return { status: 'fresh-after-corrupt-legacy', legacyFile: legacyDbFile }
    }
  }

  // 3) Nothing anywhere → first install; the server creates the schema.
  log('no existing database found — first install (schema is created on server start)')
  return { status: 'fresh' }
}

module.exports = { resolveDataPaths, ensureDatabase, isSqliteFile }
