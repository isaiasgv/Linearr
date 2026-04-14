import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Swal from 'sweetalert2'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useToastStore } from '@/shared/store/toast.store'
import { useSaveIcon, useAssignIconToChannel } from '@/features/icons/hooks'
import { iconsApi } from '@/features/icons/api'
import { IconEditor } from '@/features/icons/editor/IconEditor'
import { defaultComposition, newTextLayer, type Composition } from '@/features/icons/editor/types'
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

export function IconEditorModal() {
  const open = useUIStore((s) => s.modals.iconEditor)
  const closeModal = useUIStore((s) => s.closeModal)
  const selectedChannel = useUIStore((s) => s.selectedChannel)
  const iconEditorCallback = useUIStore((s) => s.iconEditorCallback)
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  const saveIcon = useSaveIcon()
  const assignToChannel = useAssignIconToChannel()

  const [composition, setComposition] = useState<Composition>(defaultComposition())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [iconName, setIconName] = useState('Untitled')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      if (composition.layers.length === 0 && selectedChannel) {
        const layer = newTextLayer(selectedChannel.name)
        setComposition((c) => ({ ...c, layers: [layer] }))
        setSelectedId(layer.id)
        setIconName(selectedChannel.name)
      }
    } else {
      setComposition(defaultComposition())
      setSelectedId(null)
      setIconName('Untitled')
      setEditingId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = () => closeModal('iconEditor')

  const handleSave = async (assign: boolean) => {
    if (composition.layers.length === 0) return
    setBusy(true)
    try {
      const baseName = iconName || 'Untitled'

      // Ask what to save
      const { value: options, isDismissed } = await Swal.fire<string[]>({
        title: 'Save to Library',
        html: `
          <div style="text-align:left;font-size:13px;color:#cbd5e1">
            <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer">
              <input type="checkbox" id="swal-project" checked style="width:16px;height:16px;accent-color:#6366f1">
              <span><b>Project file</b> — editable composition (re-open &amp; edit later)</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer">
              <input type="checkbox" id="swal-png" checked style="width:16px;height:16px;accent-color:#6366f1">
              <span><b>PNG variants</b> — Original, Black, White, Text-White</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer">
              <input type="checkbox" id="swal-svg" style="width:16px;height:16px;accent-color:#6366f1">
              <span><b>SVG variants</b> — scalable vector versions</span>
            </label>
          </div>
        `,
        confirmButtonText: editingId ? 'Save' : 'Save to Library',
        showCancelButton: true,
        cancelButtonText: 'Cancel',
        background: '#1e293b',
        color: '#e2e8f0',
        confirmButtonColor: '#4f46e5',
        preConfirm: () => {
          const result: string[] = []
          if ((document.getElementById('swal-project') as HTMLInputElement)?.checked)
            result.push('project')
          if ((document.getElementById('swal-png') as HTMLInputElement)?.checked) result.push('png')
          if ((document.getElementById('swal-svg') as HTMLInputElement)?.checked) result.push('svg')
          if (result.length === 0) {
            Swal.showValidationMessage('Select at least one option')
            return false
          }
          return result
        },
      })

      if (isDismissed || !options) {
        setBusy(false)
        return
      }

      const wantProject = options.includes('project')
      const wantPng = options.includes('png')
      const wantSvg = options.includes('svg')

      let savedCount = 0

      // If editing existing, ask overwrite or new
      let saveAsNew = true
      if (editingId && wantProject) {
        const { isConfirmed, isDismissed: cancelled } = await Swal.fire({
          title: 'Project exists',
          text: 'Overwrite the existing project or save as new?',
          icon: 'question',
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: 'Save as New (Recommended)',
          denyButtonText: 'Overwrite',
          cancelButtonText: 'Cancel',
          background: '#1e293b',
          color: '#e2e8f0',
          confirmButtonColor: '#4f46e5',
          denyButtonColor: '#475569',
        })
        if (cancelled) {
          setBusy(false)
          return
        }
        saveAsNew = isConfirmed
      }

      // 1. Save project file (composition JSON + original PNG thumbnail)
      if (wantProject) {
        const thumbDataUrl = await compositionToPngDataUrl(composition)
        if (editingId && !saveAsNew) {
          await iconsApi.updateIcon(editingId, {
            name: baseName,
            data: thumbDataUrl,
            composition,
          })
        } else {
          await new Promise<void>((resolve, reject) => {
            saveIcon.mutate(
              { name: baseName, category: 'projects', data: thumbDataUrl, composition },
              { onSuccess: () => resolve(), onError: (e) => reject(e) },
            )
          })
        }
        savedCount++
      }

      // 2. Save PNG variants
      if (wantPng) {
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

      // 3. Save SVG variants
      if (wantSvg) {
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

      // Callback or assign
      if (iconEditorCallback) {
        const dataUrl = await compositionToPngDataUrl(composition)
        iconEditorCallback(dataUrl, composition)
      } else if (assign && selectedChannel) {
        const dataUrl = await compositionToPngDataUrl(composition)
        await new Promise<void>((resolve, reject) => {
          assignToChannel.mutate(
            { channelNumber: selectedChannel.number, iconData: dataUrl },
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

  return (
    <ModalWrapper open={open} onClose={handleClose} maxWidth="max-w-7xl">
      <div className="flex flex-col h-[90vh]">
        {/* Header with save actions */}
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
            <button
              onClick={() => handleSave(false)}
              disabled={busy || composition.layers.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded disabled:opacity-50"
            >
              {busy && <Spinner size="sm" />}
              Save to Library
            </button>
            {selectedChannel && !iconEditorCallback && (
              <button
                onClick={() => handleSave(true)}
                disabled={busy || composition.layers.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50"
              >
                {busy && <Spinner size="sm" />}
                Save & Assign to CH {selectedChannel.number}
              </button>
            )}
            {iconEditorCallback && (
              <button
                onClick={() => handleSave(false)}
                disabled={busy || composition.layers.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50"
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
