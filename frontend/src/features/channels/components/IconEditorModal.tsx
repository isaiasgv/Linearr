import { useEffect, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Swal from 'sweetalert2'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useToastStore } from '@/shared/store/toast.store'
import { useSaveIcon, useAssignIconToChannel } from '@/features/icons/hooks'
import { iconsApi } from '@/features/icons/api'
import { IconEditor } from '@/features/icons/editor/IconEditor'
import {
  defaultComposition,
  newTextLayer500,
  newTextLayer400,
  type Composition,
} from '@/features/icons/editor/types'
import {
  compositionToPngDataUrl,
  applyColorMode,
  renderSVGWithFonts,
  rasterizeToPng,
  blobToDataUrl,
} from '@/features/icons/editor/render'
import type { ColorMode } from '@/features/icons/editor/types'

const COLOR_VARIANTS: Array<{ id: ColorMode; label: string; suffix: string }> = [
  { id: 'original', label: 'Original', suffix: '' },
  { id: 'all-black', label: 'All Black', suffix: '-black' },
  { id: 'all-white', label: 'All White', suffix: '-white' },
  { id: 'text-white-image-original', label: 'Text White', suffix: '-text-white' },
]

type SaveMode = 'png' | 'svg' | 'all'

export function IconEditorModal() {
  const open = useUIStore((s) => s.modals.iconEditor)
  const closeModal = useUIStore((s) => s.closeModal)
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const iconEditorCallback = useUIStore((s) => s.iconEditorCallback)
  const incomingComposition = useUIStore((s) => s.iconEditorComposition)
  const incomingId = useUIStore((s) => s.iconEditorId)
  const incomingName = useUIStore((s) => s.iconEditorName)
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  const saveIcon = useSaveIcon()
  const assignToChannel = useAssignIconToChannel()

  const [composition, setComposition] = useState<Composition>(defaultComposition())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [iconName, setIconName] = useState('Untitled')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) {
      if (incomingComposition && typeof incomingComposition === 'object') {
        const comp = incomingComposition as Composition
        if (comp.layers && comp.layers.length > 0) {
          setComposition(comp)
          setSelectedId(comp.layers[0].id)
          setEditingId(incomingId ?? null)
          setIconName(incomingName || 'Untitled')
          return
        }
      }
      if (composition.layers.length === 0) {
        // Default: two text layers (weight 500 + 400)
        let line1 = 'Galaxy'
        let line2 = 'Channel'
        if (selectedChannel) {
          const words = selectedChannel.name.split(/\s+/)
          if (words.length >= 2) {
            line1 = words[0]
            line2 = words.slice(1).join(' ')
          } else {
            line1 = 'Galaxy'
            line2 = selectedChannel.name
          }
          setIconName(selectedChannel.name)
        }
        const l1 = newTextLayer500(line1)
        const l2 = newTextLayer400(line2)
        setComposition((c) => ({ ...c, layers: [l1, l2] }))
        setSelectedId(l1.id)
      }
    } else {
      setComposition(defaultComposition())
      setSelectedId(null)
      setIconName('Untitled')
      setEditingId(null)
      setDropdownOpen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = () => closeModal('iconEditor')

  /** Save project file (composition JSON + thumbnail) */
  async function saveProject(baseName: string, thumbDataUrl: string) {
    if (editingId) {
      const { isConfirmed, isDismissed } = await Swal.fire({
        title: 'Project exists',
        text: 'Overwrite or save as new?',
        icon: 'question',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Save as New',
        denyButtonText: 'Overwrite',
        cancelButtonText: 'Cancel',
        background: '#1e293b',
        color: '#e2e8f0',
        confirmButtonColor: '#4f46e5',
        denyButtonColor: '#475569',
      })
      if (isDismissed) return 0
      if (!isConfirmed) {
        await iconsApi.updateIcon(editingId, {
          name: baseName,
          data: thumbDataUrl,
          composition,
        })
        return 1
      }
    }
    await new Promise<void>((resolve, reject) => {
      saveIcon.mutate(
        { name: baseName, category: 'projects', data: thumbDataUrl, composition },
        { onSuccess: () => resolve(), onError: (e) => reject(e) },
      )
    })
    return 1
  }

  /** Save project only (no variant export) */
  async function handleSaveProjectOnly() {
    if (composition.layers.length === 0) return
    setBusy(true)
    try {
      const baseName = iconName || 'Untitled'
      const thumbDataUrl = await compositionToPngDataUrl(composition)
      await saveProject(baseName, thumbDataUrl)
      void queryClient.invalidateQueries({ queryKey: ['icons', 'library'] })
      addToast('Project saved')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to save project', true)
    } finally {
      setBusy(false)
    }
  }

  /** Main save handler */
  async function handleExport(mode: SaveMode, assign: boolean) {
    if (composition.layers.length === 0) return
    setBusy(true)
    setDropdownOpen(false)
    try {
      const baseName = iconName || 'Untitled'
      const thumbDataUrl = await compositionToPngDataUrl(composition)
      let savedCount = 0

      // Always save the project file
      savedCount += await saveProject(baseName, thumbDataUrl)

      // Save PNG variants
      if (mode === 'png' || mode === 'all') {
        for (const v of COLOR_VARIANTS) {
          const recolored = applyColorMode(composition, v.id)
          const svg = await renderSVGWithFonts(recolored)
          const blob = await rasterizeToPng(svg, composition.size)
          const dataUrl = await blobToDataUrl(blob)
          await iconsApi.saveIcon({
            name: `${baseName}${v.suffix}`,
            category: 'png',
            data: dataUrl,
          })
          savedCount++
        }
      }

      // Save SVG variants
      if (mode === 'svg' || mode === 'all') {
        for (const v of COLOR_VARIANTS) {
          const recolored = applyColorMode(composition, v.id)
          const svg = await renderSVGWithFonts(recolored)
          const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
          await iconsApi.saveIcon({
            name: `${baseName}${v.suffix}`,
            category: 'svg',
            data: svgDataUrl,
          })
          savedCount++
        }
      }

      void queryClient.invalidateQueries({ queryKey: ['icons', 'library'] })
      addToast(`Saved ${savedCount} item${savedCount !== 1 ? 's' : ''} to library`)

      if (iconEditorCallback) {
        iconEditorCallback(thumbDataUrl, composition)
      } else if (assign && selectedChannel) {
        await new Promise<void>((resolve, reject) => {
          assignToChannel.mutate(
            { channelNumber: selectedChannel.number, iconData: thumbDataUrl },
            { onSuccess: () => resolve(), onError: (e) => reject(e) },
          )
        })
        void queryClient.invalidateQueries({ queryKey: ['channels'] })
      }
      handleClose()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to save icon', true)
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || composition.layers.length === 0

  return (
    <ModalWrapper open={open} onClose={handleClose} maxWidth="max-w-7xl">
      <div className="flex flex-col h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-100">Icon Editor</h2>
            {editingId && (
              <span className="text-xs bg-amber-900/40 text-amber-300 rounded-full px-2 py-0.5">
                Editing project
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Save project only */}
            <button
              onClick={handleSaveProjectOnly}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded disabled:opacity-50"
            >
              {busy && <Spinner size="sm" />}
              Save Project
            </button>
            {/* Export to Galaxy — button with dropdown */}
            <div className="relative" ref={dropdownRef}>
              <div className="flex">
                {/* Main button — PNG (default) */}
                <button
                  onClick={() => handleExport('png', false)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-l disabled:opacity-50"
                >
                  {busy && <Spinner size="sm" />}
                  Export to Galaxy
                </button>
                {/* Dropdown toggle */}
                <button
                  onClick={() => setDropdownOpen((v) => !v)}
                  disabled={disabled}
                  className="flex items-center px-1.5 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-r border-l border-indigo-500 disabled:opacity-50"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              {/* Dropdown menu */}
              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1">
                  <button
                    onClick={() => handleExport('png', false)}
                    disabled={disabled}
                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="w-5 text-center text-indigo-400 font-bold">P</span>
                    Save PNG to Library
                    <span className="ml-auto text-[10px] text-slate-500">default</span>
                  </button>
                  <button
                    onClick={() => handleExport('svg', false)}
                    disabled={disabled}
                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="w-5 text-center text-emerald-400 font-bold">S</span>
                    Save SVG to Library
                  </button>
                  <div className="border-t border-slate-700 my-1" />
                  <button
                    onClick={() => handleExport('all', false)}
                    disabled={disabled}
                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                  >
                    <span className="w-5 text-center text-amber-400 font-bold">A</span>
                    Save All Variants to Library
                    <span className="ml-auto text-[10px] text-slate-500">PNG + SVG</span>
                  </button>
                </div>
              )}
            </div>

            {/* Assign to channel */}
            {selectedChannel && !iconEditorCallback && (
              <button
                onClick={() => handleExport('png', true)}
                disabled={disabled}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50"
              >
                {busy && <Spinner size="sm" />}
                Assign to CH {selectedChannel.number}
              </button>
            )}
            {iconEditorCallback && (
              <button
                onClick={() => handleExport('png', false)}
                disabled={disabled}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50"
              >
                {busy && <Spinner size="sm" />}
                Use Icon
              </button>
            )}
            <button onClick={handleClose} className="text-slate-400 hover:text-slate-200 px-2">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <IconEditor
          composition={composition}
          onChange={setComposition}
          selectedId={selectedId}
          onSelect={setSelectedId}
          iconName={iconName}
          onNameChange={setIconName}
        />
      </div>
    </ModalWrapper>
  )
}
