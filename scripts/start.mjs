#!/usr/bin/env node
// Cross-platform production start (no bun, no shell pipes):
//   node scripts/start.mjs
// Runs the Next.js standalone server on the loopback interface by default —
// the dashboard is a local-only application and must never silently bind
// 0.0.0.0 (P5). Override with HOSTNAME/PORT env vars if you really need to.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const distDir = process.env.NEXT_DIST_DIR || '.next'
const serverJs = path.join(root, distDir, 'standalone', 'server.js')

if (!fs.existsSync(serverJs)) {
  console.error(`[start] ${path.relative(root, serverJs)} not found.`)
  console.error('[start] Run the production build first:  npm run build  (or bun run build)')
  process.exit(1)
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: process.env.PORT || '3000',
  HOSTNAME: process.env.HOSTNAME || '127.0.0.1', // loopback by default
}

console.log(`[start] serving on http://${env.HOSTNAME}:${env.PORT} (local-only)`)
const child = spawn(process.execPath, [serverJs], {
  cwd: path.dirname(serverJs),
  env,
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
