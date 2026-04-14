// Font registry. Web-safe + Google Fonts via link injection.

export interface FontDef {
  name: string
  family: string // CSS font-family value
  google?: boolean // load from Google Fonts
}

export const FONTS: FontDef[] = [
  { name: 'Inter', family: 'Inter, sans-serif', google: true },
  { name: 'Bebas Neue', family: '"Bebas Neue", sans-serif', google: true },
  { name: 'Baloo Thambi', family: '"Baloo Thambi", cursive', google: true },
  { name: 'Baloo Thambi 2', family: '"Baloo Thambi 2", cursive', google: true },
  { name: 'Impact', family: 'Impact, "Arial Black", sans-serif' },
  { name: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { name: 'Helvetica', family: 'Helvetica, Arial, sans-serif' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Courier New', family: '"Courier New", monospace' },
  { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
  { name: 'Verdana', family: 'Verdana, sans-serif' },
  { name: 'Palatino', family: '"Palatino Linotype", serif' },
  { name: 'Garamond', family: 'Garamond, serif' },
  { name: 'Comic Sans MS', family: '"Comic Sans MS", cursive' },
]

const loaded = new Set<string>()

export function loadGoogleFont(name: string) {
  if (loaded.has(name)) return
  loaded.add(name)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@100;300;400;500;700;900&display=swap`
  document.head.appendChild(link)
}

export function ensureFontLoaded(fontName: string) {
  const def = FONTS.find((f) => f.name === fontName)
  if (def?.google) loadGoogleFont(def.name)
}

export function familyFor(fontName: string): string {
  return FONTS.find((f) => f.name === fontName)?.family ?? fontName
}

// ── Font embedding for SVG export ──────────────────────────────────────────

const fontDataCache = new Map<string, string>()

/**
 * Fetch a Google Font's CSS, extract the woff2 URL, download and convert
 * to a base64 data URL. Returns a `@font-face` CSS block that can be
 * embedded in an SVG `<style>` element so the font renders correctly
 * when rasterized to PNG via canvas.
 */
export async function getEmbeddableFontFace(fontName: string): Promise<string | null> {
  const def = FONTS.find((f) => f.name === fontName)
  if (!def?.google) return null

  const cached = fontDataCache.get(fontName)
  if (cached) return cached

  try {
    // Fetch CSS — use a woff2-capable user agent so Google returns woff2
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@100;300;400;500;700;900&display=swap`
    const cssResp = await fetch(cssUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    const cssText = await cssResp.text()

    // Extract all @font-face blocks and inline the font files
    const faceBlocks: string[] = []
    const faceRegex = /@font-face\s*\{[^}]+\}/g
    const faces = cssText.match(faceRegex) || []

    for (const face of faces) {
      const urlMatch = face.match(/url\(([^)]+)\)\s*format\(['"]?woff2['"]?\)/)
      if (!urlMatch) continue
      const fontUrl = urlMatch[1].replace(/['"]/g, '')

      try {
        const fontResp = await fetch(fontUrl)
        const fontBlob = await fontResp.blob()
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(fontBlob)
        })

        // Replace the remote URL with the base64 data URL
        const inlined = face.replace(
          /url\([^)]+\)\s*format\(['"]?woff2['"]?\)/,
          `url(${base64}) format('woff2')`,
        )
        faceBlocks.push(inlined)
      } catch {
        // Skip this weight if fetch fails
      }
    }

    if (faceBlocks.length === 0) return null

    const result = faceBlocks.join('\n')
    fontDataCache.set(fontName, result)
    return result
  } catch {
    return null
  }
}

/**
 * Collect all unique Google Font names used in a composition's text layers.
 */
export function getUsedGoogleFonts(layers: Array<{ kind: string; font?: string }>): string[] {
  const names = new Set<string>()
  for (const l of layers) {
    if (l.kind === 'text' && l.font) {
      const def = FONTS.find((f) => f.name === l.font)
      if (def?.google) names.add(def.name)
    }
  }
  return [...names]
}
