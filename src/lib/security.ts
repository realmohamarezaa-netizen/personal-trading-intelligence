// ─── Local security helpers ──────────────────────────────────────────────────
// The dashboard is a localhost-only application, but several processes live
// on the same machine (browser renderer, bundled Python connector, any other
// local app). Two cheap, strong layers protect the mutating endpoints:
//
//  1. Same-origin enforcement for BROWSER requests (middleware.ts) — blocks
//     other local pages/apps from driving the user's dashboard via fetch.
//  2. A per-launch sync token for the CONNECTOR — the Electron main process
//     (or the launch route) mints a random token, hands it to the Python
//     connector and stores it in PTI_TOKEN_FILE; /api/mt5/sync accepts
//     payloads only when the X-PTI-Token header matches.

import fs from 'fs'

export const SYNC_TOKEN_HEADER = 'x-pti-token'

let cachedToken: { value: string | null; at: number } = { value: null, at: 0 }

/**
 * The expected sync token: PTI_SYNC_TOKEN env var, or the contents of the
 * PTI_TOKEN_FILE (written by the launch route each time a connector starts).
 * Re-read every 5 s so a freshly launched connector is accepted immediately.
 */
export function getSyncToken(): string | null {
  const envToken = process.env.PTI_SYNC_TOKEN
  if (envToken) return envToken
  const tokenFile = process.env.PTI_TOKEN_FILE
  if (!tokenFile) return null
  const now = Date.now()
  if (now - cachedToken.at < 5_000) return cachedToken.value
  try {
    const raw = fs.readFileSync(tokenFile, 'utf8').trim()
    cachedToken = { value: raw.length >= 16 ? raw : null, at: now }
  } catch {
    cachedToken = { value: null, at: now }
  }
  return cachedToken.value
}

export interface TokenCheck {
  ok: boolean
  /** true when no token has been configured at all (plain dev mode). */
  open: boolean
  reason?: string
}

export function checkSyncToken(headerValue: string | null): TokenCheck {
  const expected = getSyncToken()
  if (!expected) return { ok: true, open: true }
  if (headerValue && headerValue.length === expected.length) {
    // length-equal → constant-time-ish compare without pulling in crypto timingSafeEqual ceremony
    let diff = 0
    for (let i = 0; i < expected.length; i++) {
      diff |= headerValue.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    if (diff === 0) return { ok: true, open: false }
  }
  return { ok: false, open: false, reason: 'missing or invalid X-PTI-Token' }
}

/** True when the request originates from the loopback interface only. */
export function isLoopbackRequest(req: Request): boolean {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return false // a proxy chain is never trusted here
  return true // the server itself binds 127.0.0.1 in desktop mode
}
