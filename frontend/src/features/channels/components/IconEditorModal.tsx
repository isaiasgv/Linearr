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

const COLOR_VARIANTS: Array<{ id: ColorMode; suffix: string }> = [
  { id: 'original', suffix: '' },
  { id: 'all-black', suffix: '-black' },
  { id: 'all-white', suffix: '-white' },
  { id: 'text-white-image-original', suffix: '-text-white' },
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

  // Seed composition with channel name on open if no layers yet
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

  /** Generate PNG data URLs for all color variants */
  async function generateVariants(
    comp: Composition,
  ): Promise<Array<{ suffix: string; data: string }>> {
    const results: Array<{ suffix: string; data: string }> = []
    for (const v of COLOR_VARIANTS) {
      const recolored = applyColorMode(comp, v.id)
      const svg = await renderSVGWithFonts(recolored)
      const blob = await rasterizeToPng(svg, comp.size)
      const dataUrl = await blobToDataUrl(blob)
      results.push({ suffix: v.suffix, data: dataUrl })
    }
    return results
  }

  const handleSave = async (assign: boolean) => {
    setBusy(true)
    try {
      // Generate original PNG
      const dataUrl = await compositionToPngDataUrl(composition)

      // If editing existing icon, ask overwrite or new
      let saveAsNew = true
      if (editingId) {
        const { isConfirmed, isDismissed } = await Swal.fire({
          title: 'Save Icon',
          text: 'Overwrite the existing icon or save as new?',
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
        if (isDismissed) {
          setBusy(false)
          return
        }
        saveAsNew = isConfirmed // confirmed = new, denied = overwrite
      }

      // Generate all color variants
      const variants = await generateVariants(composition)

      if (editingId && !saveAsNew) {
        // Overwrite existing
        await iconsApi.updateIcon(editingId, {
          name: iconName || 'Untitled',
          data: dataUrl,
          composition,
        })
        addToast('Icon updated')
      } else {
        // Save as new — save the project (original PNG + composition)
        await new Promise<void>((resolve, reject) => {
          saveIcon.mutate(
            {
              name: iconName || 'Untitled',
              category: 'custom',
              data: dataUrl,
              composition,
            },
            { onSuccess: () => resolve(), onError: (e) => reject(e) },
          )
        })
      }

      // Save all color variants to library
      for (const v of variants) {
        if (v.suffix === '') continue // skip original, already saved above
        await iconsApi.saveIcon({
          name: `${iconName || 'Untitled'}${v.suffix}`,
          category: 'variants',
          data: v.data,
        })
      }

      void queryClient.invalidateQueries({ queryKey: ['icons', 'library'] })

      // Callback or assign
      if (iconEditorCallback) {
        iconEditorCallback(dataUrl, composition)
      } else if (assign && selectedChannel) {
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
                Editing #{editingId}
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

        {/* Reusable editor */}
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
