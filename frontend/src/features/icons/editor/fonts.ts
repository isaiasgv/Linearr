// Font registry. Web-safe + Google Fonts via link injection.

export interface FontDef {
  name: string
  family: string // CSS font-family value
  google?: boolean // load from Google Fonts
}

export const FONTS: FontDef[] = [
  { name: 'Inter', family: 'Inter, sans-serif', google: true },
  { name: 'Bebas Neue', family: '"Bebas Neue", sans-serif', google: true },
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
