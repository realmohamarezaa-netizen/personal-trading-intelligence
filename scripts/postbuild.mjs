#!/usr/bin/env node
// Cross-platform post-build step (replaces the old bash-only `sh -c` pipe):
// Next.js "standalone" output does NOT include static assets — copy
// <distDir>/static into <distDir>/standalone/<distDir-basename>/static so the
// packaged server can serve /_next/static. Works identically on Windows,
// Linux and macOS (no shell pipes, no tee).

import fs from 'node:fs'
import path from 'node:path'

const distDir = process.env.NEXT_DIST_DIR || '.next'
const distStatic = path.join(process.cwd(), distDir, 'static')

// Next 16 standalone layout: <distDir>/standalone/<distName>/ is the packaged
// server root, and /_next/static must live under it (baked distDir name).
const distName = path.basename(distDir)
const standaloneRoot = path.join(process.cwd(), distDir, 'standalone')
let standaloneStatic = path.join(standaloneRoot, distName, 'static')
if (!fs.existsSync(path.join(standaloneRoot, distName))) {
  // fallback for older layouts where the server root is standalone/ itself
  standaloneStatic = path.join(standaloneRoot, 'static')
}

if (!fs.existsSync(distStatic)) {
  console.error(`[postbuild] ERROR: ${path.relative(process.cwd(), distStatic)} not found — did "next build" produce static assets?`)
  process.exit(1)
}
if (!fs.existsSync(path.dirname(standaloneStatic))) {
  console.error(`[postbuild] ERROR: ${path.relative(process.cwd(), path.dirname(standaloneStatic))} not found — did "next build" run with output: "standalone"?`)
  process.exit(1)
}

fs.rmSync(standaloneStatic, { recursive: true, force: true })
fs.cpSync(distStatic, standaloneStatic, { recursive: true })

// Also mirror public/ into the standalone output so /logo.svg etc. resolve
// from the packaged server directory.
const publicDir = path.join(process.cwd(), 'public')
const standalonePublic = path.join(path.dirname(standaloneStatic), '..', 'public')
if (fs.existsSync(publicDir)) {
  fs.rmSync(standalonePublic, { recursive: true, force: true })
  fs.cpSync(publicDir, standalonePublic, { recursive: true })
}

console.log(`[postbuild] static assets -> ${path.relative(process.cwd(), standaloneStatic)} ✓`)
