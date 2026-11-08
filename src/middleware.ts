// ─── API security middleware ─────────────────────────────────────────────────
// 1) Same-origin enforcement for browser-driven mutating requests: any other
//    local page/app that tries fetch('http://127.0.0.1:3517/api/reseed', …)
//    from a different origin is rejected before it reaches a route.
//    (/api/mt5/sync is exempt — its client is the Python connector, which
//     sends no Origin header; it is protected by the X-PTI-Token check.)
// 2) Baseline security headers on every API response.

import { NextRequest, NextResponse } from 'next/server'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/')

  if (isApi && MUTATING.has(req.method) && !req.nextUrl.pathname.startsWith('/api/mt5/sync')) {
    const origin = req.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = null
      }
      const host = req.headers.get('host')
      if (!originHost || !host || originHost !== host) {
        return NextResponse.json(
          { error: 'CROSS_ORIGIN_BLOCKED', message: 'Mutating requests must come from the dashboard itself.' },
          { status: 403 },
        )
      }
    }
    // No Origin header at all → not a browser fetch (curl/connector/testing).
    // Browser same-site POSTs always carry Origin for cross-site and most
    // same-origin cases; loopback tooling is acceptable here by design.
  }

  const res = NextResponse.next()
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

export const config = {
  matcher: '/api/:path*',
}
