// Renders icon.svg to PNGs and assembles a PNG-compressed .ico + icon.png
// Usage: node make-icons.mjs <icon.svg> <output-dir>
import { createRequire } from 'module'
const require = createRequire('/home/z/my-project/')
const sharp = require('sharp')
import fs from 'fs'

const [, , svgPath = '/home/z/my-project/desktop-build/icon.svg', outDir = '/home/z/pti-stage/app/resources/app'] = process.argv
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const svg = fs.readFileSync(svgPath)

const pngs = {}
for (const size of SIZES) {
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer()
  pngs[size] = buf
}

// 512px png for the Electron window icon
fs.writeFileSync(`${outDir}/icon.png`, pngs[512])

// ICO: header + directory entries + embedded PNGs
const entrySizes = [16, 24, 32, 48, 64, 128, 256]
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
  dir.writeUInt32LE(pngs[size].length, e + 8) // data size
  dir.writeUInt32LE(offset, e + 12) // data offset
  offset += pngs[size].length
})

const ico = Buffer.concat([header, dir, ...entrySizes.map((s) => pngs[s])])
fs.writeFileSync(`${outDir}/icon.ico`, ico)
console.log('icon.ico bytes:', ico.length, '| icon.png bytes:', pngs[512].length)
