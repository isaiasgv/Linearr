import { useState, useRef, useEffect, useCallback } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { useUIStore } from '@/shared/store/ui.store'
import { useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { post, del } from '@/shared/api/client'

const FONTS = [
  'Arial', 'Helvetica', 'Impact', 'Georgia', 'Courier New',
  'Trebuchet MS', 'Verdana', 'Palatino', 'Garamond', 'Comic Sans MS',
]

const CANVAS_SIZE = 512
const PREVIEW_SIZES = [192, 64, 32]

const TIER_GRADIENTS: Record<string, [string, string]> = {
  'Galaxy Main': ['#4f46e5', '#6366f1'],
  'Classics': ['#d97706', '#f59e0b'],
  'Galaxy Premium': ['#7c3aed', '#a855f7'],
}

export function IconEditorModal() {
  const { modals, closeModal, selectedChannel } = useUIStore()
  const open = modals.iconEditor ?? false
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [text, setText] = useState('')
  const [font, setFont] = useState('Impact')
  const [fontSize, setFontSize] = useState(72)
  const [textColor, setTextColor] = useState('#ffffff')
  const [bgType, setBgType] = useState<'transparent' | 'solid' | 'gradient'>('gradient')
  const [bgColor, setBgColor] = useState('#1e1b4b')
  const [saving, setSaving] = useState(false)

  // Init text from channel name
  useEffect(() => {
    if (open && selectedChannel) {
      setText(selectedChannel.name)
      const tier = selectedChannel.tier
      if (TIER_GRADIENTS[tier]) {
        setBgColor(TIER_GRADIENTS[tier][0])
      }
    }
  }, [open, selectedChannel])

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Background
    if (bgType === 'solid') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    } else if (bgType === 'gradient') {
      const tier = selectedChannel?.tier ?? 'Galaxy Main'
      const [c1, c2] = TIER_GRADIENTS[tier] ?? [bgColor, '#6366f1']
      const grad = ctx.createLinearGradient(0, 0, CANVAS_SIZE, CANVAS_SIZE)
      grad.addColorStop(0, c1)
      grad.addColorStop(1, c2)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    }

    // Text
    if (text) {
      ctx.fillStyle = textColor
      ctx.font = `bold ${fontSize}px "${font}", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Word wrap
      const words = text.split(' ')
      const lines: string[] = []
      let currentLine = ''
      const maxWidth = CANVAS_SIZE * 0.85

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word
        const metrics = ctx.measureText(testLine)
        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) lines.push(currentLine)

      const lineHeight = fontSize * 1.2
      const totalHeight = lines.length * lineHeight
      const startY = (CANVAS_SIZE - totalHeight) / 2 + lineHeight / 2

      lines.forEach((line, i) => {
        ctx.fillText(line, CANVAS_SIZE / 2, startY + i * lineHeight, maxWidth)
      })
    }
  }, [text, font, fontSize, textColor, bgType, bgColor, selectedChannel])

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  async function handleSave() {
    if (!canvasRef.current || !selectedChannel) return
    setSaving(true)
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png')
      await post(`/api/channels/${selectedChannel.number}/icon`, { icon: dataUrl })
      queryClient.invalidateQueries({ queryKey: ['channels'] })
      addToast('Icon saved')
      closeModal('iconEditor')
    } catch (e: any) {
      addToast(e.message || 'Failed to save icon', true)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!selectedChannel) return
    await del(`/api/channels/${selectedChannel.number}/icon`)
    queryClient.invalidateQueries({ queryKey: ['channels'] })
    addToast('Icon removed')
    closeModal('iconEditor')
  }

  function handleImportImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
        // Draw image centered and scaled to fit
        const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (CANVAS_SIZE - w) / 2, (CANVAS_SIZE - h) / 2, w, h)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function handleExportPng() {
    if (!canvasRef.current) return
    const url = canvasRef.current.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedChannel?.name ?? 'channel'}-icon.png`
    a.click()
  }

  return (
    <ModalWrapper open={open} onClose={() => closeModal('iconEditor')} maxWidth="max-w-2xl">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">
          Channel Icon — {selectedChannel?.name ?? ''}
        </h2>
        <button onClick={() => closeModal('iconEditor')} className="text-slate-500 hover:text-slate-300 transition-colors">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6 flex gap-6">
        {/* Canvas preview */}
        <div className="shrink-0">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="w-48 h-48 rounded-xl border border-slate-700 bg-[repeating-conic-gradient(#334155_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
          />
          {/* Size previews */}
          <div className="flex items-center gap-3 mt-3">
            {PREVIEW_SIZES.map((s) => (
              <div key={s} className="text-center">
                <canvas
                  width={s}
                  height={s}
                  className="rounded border border-slate-700"
                  style={{ width: s / 2, height: s / 2 }}
                  ref={(el) => {
                    if (el && canvasRef.current) {
                      const ctx = el.getContext('2d')
                      if (ctx) {
                        ctx.clearRect(0, 0, s, s)
                        ctx.drawImage(canvasRef.current, 0, 0, s, s)
                      }
                    }
                  }}
                />
                <span className="text-xs text-slate-600 block mt-0.5">{s}px</span>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-4">
          {/* Text */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Text</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Font + Size */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Font</label>
              <select
                value={font}
                onChange={(e) => setFont(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Size: {fontSize}px</label>
              <input
                type="range"
                min={24}
                max={160}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Text Color</label>
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)}
                className="w-full h-9 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Background</label>
              <div className="flex gap-1">
                {(['transparent', 'solid', 'gradient'] as const).map((t) => (
                  <button key={t} onClick={() => setBgType(t)}
                    className={`flex-1 px-2 py-1.5 text-xs rounded transition ${
                      bgType === t ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              {bgType === 'solid' && (
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
                  className="w-full h-8 mt-1 bg-slate-900 border border-slate-600 rounded cursor-pointer" />
              )}
            </div>
          </div>

          {/* Import image */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Or import image</label>
            <label className="flex items-center gap-2 px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer w-fit">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              Upload PNG/SVG
              <input type="file" accept=".png,.svg,.jpg,.jpeg,.webp" className="hidden" onChange={handleImportImage} />
            </label>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={handleExportPng}
            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors">
            Export PNG
          </button>
          <button onClick={handleRemove}
            className="px-3 py-1.5 text-xs bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 text-red-400 rounded-lg transition-colors">
            Remove Icon
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => closeModal('iconEditor')}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors">
            {saving ? 'Saving...' : 'Save Icon'}
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}
