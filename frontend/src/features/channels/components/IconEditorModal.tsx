import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useToastStore } from '@/shared/store/toast.store'
import { useSaveIcon, useAssignIconToChannel } from '@/features/icons/hooks'
import { IconEditor } from '@/features/icons/editor/IconEditor'
import { defaultComposition, newTextLayer, type Composition } from '@/features/icons/editor/types'
import { compositionToPngDataUrl } from '@/features/icons/editor/render'

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = () => closeModal('iconEditor')

  const handleSave = async (assign: boolean) => {
    setBusy(true)
    try {
      const dataUrl = await compositionToPngDataUrl(composition)
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
          <h2 className="text-lg font-semibold text-slate-100">Icon Editor</h2>
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
