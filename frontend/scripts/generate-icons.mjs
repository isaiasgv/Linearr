/**
 * Generates favicon.ico and PNG icons from favicon/icon SVGs using sharp + to-ico.
 * Run: npm run generate-icons
 */
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import sharp from 'sharp'
import toIco from 'to-ico'

const __dir = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dir, '../public')

async function svgToPng(svgPath, size) {
  return sharp(readFileSync(svgPath)).resize(size, size).png().toBuffer()
}

// favicon.ico (16 + 32 + 48px from favicon.svg)
console.log('Generating favicon.ico...')
const icoBuffers = await Promise.all([16, 32, 48].map((s) => svgToPng(resolve(publicDir, 'favicon.svg'), s)))
const ico = await toIco(icoBuffers)
writeFileSync(resolve(publicDir, 'favicon.ico'), ico)
console.log(`  favicon.ico written (${ico.length} bytes)`)

// icon-192.png (PWA, required by Chrome for install prompt)
console.log('Generating icon-192.png...')
const png192 = await svgToPng(resolve(publicDir, 'icon-192.svg'), 192)
writeFileSync(resolve(publicDir, 'icon-192.png'), png192)
console.log(`  icon-192.png written (${png192.length} bytes)`)

// icon-512.png (PWA splash / maskable)
console.log('Generating icon-512.png...')
const png512 = await svgToPng(resolve(publicDir, 'icon-512.svg'), 512)
writeFileSync(resolve(publicDir, 'icon-512.png'), png512)
console.log(`  icon-512.png written (${png512.length} bytes)`)
