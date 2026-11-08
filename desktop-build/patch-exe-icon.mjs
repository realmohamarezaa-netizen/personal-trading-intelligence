// Replaces the embedded icon group inside a Win32 PE (TradingIntelligence.exe)
// with the PTI icon so the installed exe no longer shows Electron's default
// atom logo in Explorer / file properties.
// Usage: node patch-exe-icon.mjs <target.exe> <icon.ico>
//
// resedit (pure-JS PE resource editor, the cross-platform rcedit replacement
// used by the Electron packaging ecosystem) rewrites ONLY the icon resources —
// version info, cursors, dialogs and everything else stay untouched.
// replaceIconsForResource APPENDS a new group, so every pre-existing icon
// group/icon entry is removed first to guarantee exactly one clean group.
import { Data, Resource, NtExecutable, NtExecutableResource } from 'resedit'
import fs from 'fs'

const [, , exePath, icoPath] = process.argv
if (!exePath || !icoPath) {
  console.error('usage: node patch-exe-icon.mjs <target.exe> <icon.ico>')
  process.exit(1)
}

const counts = (entries) => {
  const o = {}
  for (const e of entries) o[e.type] = (o[e.type] || 0) + 1
  return o
}

const src = fs.readFileSync(exePath)
const exe = NtExecutable.from(src)
const res = NtExecutableResource.from(exe)
const before = { icons: res.entries.filter((e) => e.type === 3).length, groups: res.entries.filter((e) => e.type === 14).length }

const iconFile = Data.IconFile.from(fs.readFileSync(icoPath))
const iconItems = iconFile.icons.map((ic) => ic.data)

// strip every existing icon group + icon entry, then add ours as the only group
res.entries = res.entries.filter((e) => e.type !== 3 && e.type !== 14)
Resource.IconGroupEntry.replaceIconsForResource(res.entries, '1', 0x0409, iconItems)
res.outputResource(exe)

fs.writeFileSync(exePath, Buffer.from(exe.generate()))

// ── verify by re-parsing the written file ────────────────────────────────────
const re = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(exePath)))
const afterIcons = re.entries.filter((e) => e.type === 3)
const groups = re.entries.filter((e) => e.type === 14)
const largest = afterIcons.reduce((a, b) => (Buffer.from(b.bin).length > Buffer.from(a.bin).length ? b : a))
const lb = Buffer.from(largest.bin)
console.log(`patched icon -> ${exePath}`)
console.log(`  icon entries: ${before.icons}->${afterIcons.length} | icon groups: ${before.groups}->${groups.length}`)
console.log(`  largest RT_ICON: ${lb.length}B | DIB-format: ${lb.readUInt32LE(0) === 40} | bpp: ${lb.readUInt16LE(14)}`)
const resCounts = counts(re.entries)
console.log(`  resource types kept: ${Object.entries(resCounts).map(([t, n]) => 'type' + t + 'x' + n).join(', ')}`)
if (afterIcons.length !== 7 || groups.length !== 1 || lb.readUInt32LE(0) !== 40) {
  console.error('VERIFY FAILED')
  process.exit(1)
}
console.log('verify OK')
