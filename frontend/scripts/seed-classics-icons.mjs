/**
 * Reads the classics icon files, converts to base64 data URLs,
 * and outputs a JSON file for seeding the icon library.
 *
 * Run: node scripts/seed-classics-icons.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { resolve, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dir, '../../../../Galaxy channel icons/classics')

// Map: best file for each channel
const CHANNEL_ICONS = {
  'Cartoon Network': 'cartoon-network-seeklogo.png',
  'Boomerang': 'boomerang-seeklogo.png',
  'Disney Channel': 'disney-channel-seeklogo.png',
  'Disney XD': 'disney-xd-seeklogo.png',
  'Nickelodeon': 'nickelodeon-seeklogo.png',
  'Nicktoons': 'nicktoons-seeklogo.png',
  'MTV': 'mtv-seeklogo.png',
}

// Additional icons worth including in the pack
const EXTRA_ICONS = {
  'CN White': 'cn-cartoon-network-white.png',
  'Boomerang CN': 'boomerang-cartoon-network-seeklogo.png',
  'Boomerang LATAM': 'boomerang-latin-america-seeklogo.png',
  'MTV Music TV': 'mtv-music-television-seeklogo.png',
  'MTV New': 'mtv-new-seeklogo.png',
  'Nick at Nite': 'nick-at-nite-seeklogo.png',
  'Nick Jr': 'nick-jr-seeklogo.png',
  'Nick HD': 'nick-hd-seeklogo.png',
  'Nickelodeon 2023': 'nickelodeon-2023-seeklogo.png',
  'Disney Channel OM': 'disney-channel-original-movie-seeklogo.png',
  'Warner Bros': 'warner-bros-seeklogo.png',
  'WB': 'wb-warner-bros-seeklogo.png',
  'Toonami': 'toonami-1997-seeklogo.png',
  '4Kids TV': '4kids-tv-seeklogo.png',
  'Back to the Future': 'back-to-the-future-seeklogo.png',
  'Plex': 'plex.svg',
  'Tunarr': 'tunarr.svg',
}

function toDataUrl(filePath) {
  const ext = extname(filePath).toLowerCase()
  const mime = ext === '.svg' ? 'image/svg+xml'
    : ext === '.webp' ? 'image/webp'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : 'image/png'
  const buf = readFileSync(filePath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

const pack = []

console.log('Building classics icon pack...\n')

for (const [name, file] of Object.entries({ ...CHANNEL_ICONS, ...EXTRA_ICONS })) {
  const filePath = resolve(iconsDir, file)
  try {
    const dataUrl = toDataUrl(filePath)
    const isChannel = name in CHANNEL_ICONS
    pack.push({
      name,
      category: 'classics',
      data: dataUrl,
      channel: isChannel ? name : null,
    })
    console.log(`  ✓ ${name} (${file}, ${Math.round(readFileSync(filePath).length / 1024)}KB)`)
  } catch (err) {
    console.log(`  ✗ ${name} — ${file} not found, skipping`)
  }
}

const outPath = resolve(__dir, '../../classics-icon-pack.json')
writeFileSync(outPath, JSON.stringify({ version: 1, category: 'classics', icons: pack }, null, 2))
console.log(`\nWrote ${pack.length} icons to ${outPath}`)
