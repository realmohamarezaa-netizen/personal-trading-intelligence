// Renders icon.svg to PNGs and assembles a DIB (BMP-format) .ico + icon.png
// Usage: node make-icons.mjs <icon.svg> <output-dir>
//
// v1.3.6: the .ico now embeds classic DIB/BMP entries (32bpp BGRA + AND mask)
// instead of PNG-compressed entries. PNG entries inside .ico are officially
// guaranteed only for the 256x256 slot; DIB entries are rendered by every
// Windows component (Explorer, NSIS resource compiler, LoadIcon, shortcuts,
// registry DisplayIcon) with zero ambiguity.
import { createRequire } from 'module'
const require = createRequire('/home/z/my-project/')
const sharp = require('sharp')
import fs from 'fs'

const [, , svgPath = '/home/z/my-project/desktop-build/icon.svg', outDir = '/home/z/pti-stage/app/resources/app'] = process.argv
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const svg = fs.readFileSync(svgPath)

const pngs = {}
const raws = {}
for (const size of SIZES) {
  pngs[size] = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
  raws[size] = await sharp(svg, { density: 384 }).resize(size, size).ensureAlpha().raw().toBuffer()
}

// 512px png for the Electron window icon
fs.writeFileSync(`${outDir}/icon.png`, pngs[512])

// ─── DIB entry: BITMAPINFOHEADER + bottom-up BGRA XOR plane + zeroed AND mask ─
function dibEntry(rgba, w, h) {
  const xorSize = w * h * 4
  const andStride = Math.ceil(w / 32) * 4 // 1bpp rows padded to 32 bits
  const andSize = andStride * h
  const buf = Buffer.alloc(40 + xorSize + andSize)
  buf.writeUInt32LE(40, 0)        // biSize = sizeof(BITMAPINFOHEADER)
  buf.writeInt32LE(w, 4)          // biWidth
  buf.writeInt32LE(h * 2, 8)      // biHeight = XOR rows + AND rows (doubled)
  buf.writeUInt16LE(1, 12)        // biPlanes
  buf.writeUInt16LE(32, 14)       // biBitCount
  buf.writeUInt32LE(0, 16)        // biCompression = BI_RGB
  buf.writeUInt32LE(xorSize + andSize, 20) // biSizeImage
  // XOR plane: top-down RGBA source -> bottom-up BGRA target
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4
    const dst = 40 + y * w * 4
    for (let x = 0; x < w; x++) {
      const s = src + x * 4
      const d = dst + x * 4
      buf[d] = rgba[s + 2]     // B
      buf[d + 1] = rgba[s + 1] // G
      buf[d + 2] = rgba[s]     // R
      buf[d + 3] = rgba[s + 3] // A (per-pixel alpha drives the rounded corners)
    }
  }
  // AND mask stays all-zero: opacity comes from the alpha channel
  return buf
}

const entrySizes = [16, 24, 32, 48, 64, 128, 256]
const entries = Object.fromEntries(entrySizes.map((s) => [s, dibEntry(raws[s], s, s)]))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(entrySizes.length, 4)

const dir = Buffer.alloc(16 * entrySizes.length)
let offset = 6 + 16 * entrySizes.length
entrySizes.forEach((size, i) => {
  const e = i * 16
  dir.writeUInt8(size === 256 ? 0 : size, e + 0) // width
  dir.writeUInt8(size === 256 ? 0 : size, e + 1) // height
  dir.writeUInt8(0, e + 2) // palette
  dir.writeUInt8(0, e + 3) // reserved
  dir.writeUInt16LE(1, e + 4) // color planes
  dir.writeUInt16LE(32, e + 6) // bits per pixel
  dir.writeUInt32LE(entries[size].length, e + 8) // data size
  dir.writeUInt32LE(offset, e + 12) // data offset
  offset += entries[size].length
})

const ico = Buffer.concat([header, dir, ...entrySizes.map((s) => entries[s])])
fs.writeFileSync(`${outDir}/icon.ico`, ico)
console.log('icon.ico bytes:', ico.length, '(DIB format)', '| icon.png bytes:', pngs[512].length)
