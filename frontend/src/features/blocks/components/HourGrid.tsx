import { useBlockStore } from '@/features/blocks/store'
import { useBlockSlots, useRemoveSlot, useUpdateSlot, useSwapSlots } from '@/features/blocks/hooks'
import { hoursInBlock, getHourState, to12h, durationLabel } from '@/features/blocks/utils'
import type { Block, BlockSlot } from '@/shared/types'
import { Spinner } from '@/shared/components/ui/Spinner'
import { SlotEditor } from './SlotEditor'

interface HourGridProps {
  blockId: number
  block: Block
}

function PlexThumbInline({ thumb, title }: { thumb: string | null; title: string }) {
  if (!thumb) {
    return (
      <div className="w-8 h-12 flex-shrink-0 bg-slate-700 rounded flex items-center justify-center">
        <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 4h16v16H4z" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={`/api/plex/thumb?path=${encodeURIComponent(thumb)}`}
      alt={title}
      loading="lazy"
      className="w-8 h-12 flex-shrink-0 object-cover rounded"
      onError={(e) => {
        const el = e.currentTarget
        el.style.display = 'none'
      }}
    />
  )
}

export function HourGrid({ blockId, block }: HourGridProps) {
  const {
    expandedBlockId,
    addingSlotForBlockId,
    slotTargetHour,
    draggingSlot,
    dragOverHour,
    startAddingSlot,
    setDraggingSlot,
    setDragOverHour,
  } = useBlockStore()

  const { data: slots = [], isLoading } = useBlockSlots(blockId, expandedBlockId === blockId)
  const removeSlot = useRemoveSlot()
  const updateSlot = useUpdateSlot()
  const swapSlots = useSwapSlots()

  const hours = hoursInBlock(block)

  function handleDragStart(slot: BlockSlot, e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'move'
    setDraggingSlot(slot)
  }

  function handleDragEnd() {
    setDraggingSlot(null)
    setDragOverHour(null)
  }

  function handleDragOver(e: React.DragEvent, hour: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverHour(hour)
  }

  function handleDrop(e: React.DragEvent, hour: string) {
    e.preventDefault()
    if (!draggingSlot || draggingSlot.block_id !== blockId) {
      setDraggingSlot(null)
      setDragOverHour(null)
      return
    }
    if (draggingSlot.slot_time === hour) {
      setDraggingSlot(null)
      setDragOverHour(null)
      return
    }
    const targetState = getHourState(slots, hour)
    if (targetState.type === 'start' && targetState.slot) {
      // Swap with occupied slot
      swapSlots.mutate({ blockId, slotId1: draggingSlot.id, slotId2: targetState.slot.id })
    } else if (targetState.type === 'empty') {
      // Move to empty hour
      updateSlot.mutate({ slotId: draggingSlot.id, data: { slot_time: hour } })
    }
    setDraggingSlot(null)
    setDragOverHour(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className="py-2 px-3 space-y-0.5">
      {hours.map((hour) => {
        const state = getHourState(slots, hour)
        const isAddingHere = addingSlotForBlockId === blockId && slotTargetHour === hour
        const isDragOver = dragOverHour === hour

        return (
          <div key={hour}>
            {/* Hour row */}
            <div
              onDragOver={(e) => handleDragOver(e, hour)}
              onDrop={(e) => handleDrop(e, hour)}
              className="relative"
            >
              {state.type === 'empty' && (
                <div
                  className={`flex items-center gap-2 rounded px-2 py-1.5 min-h-[36px] border transition-colors ${
                    isDragOver
                      ? 'border-blue-500 border-dashed bg-blue-900/20'
                      : 'border-slate-700 border-dashed bg-transparent hover:border-slate-600'
                  }`}
                >
                  <span className="text-xs text-slate-500 w-16 flex-shrink-0 tabular-nums">
                    {to12h(hour)}
                  </span>
                  <button
                    onClick={() => startAddingSlot(blockId, hour)}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-300 transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>Add</span>
                  </button>
                </div>
              )}

              {state.type === 'start' && (
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(state.slot, e)}
                  onDragEnd={handleDragEnd}
                  className="flex items-center gap-2 rounded px-2 py-1.5 bg-slate-750 border border-slate-600 hover:border-slate-500 cursor-grab active:cursor-grabbing transition-colors"
                >
                  {/* Drag handle */}
                  <svg
                    className="w-3.5 h-3.5 text-slate-600 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>

                  <span className="text-xs text-slate-400 w-16 flex-shrink-0 tabular-nums">
                    {to12h(hour)}
                  </span>

                  <PlexThumbInline thumb={state.slot.plex_thumb} title={state.slot.plex_title} />

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-100 truncate">
                      {state.slot.plex_title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {state.slot.plex_year && (
                        <span className="text-xs text-slate-500">{state.slot.plex_year}</span>
                      )}
                      <span className="text-xs bg-slate-700 text-slate-400 rounded px-1 py-0.5">
                        {durationLabel(state.slot.duration_minutes)}
                      </span>
                      <span
                        className={`text-xs rounded px-1 py-0.5 ${
                          state.slot.plex_type === 'show'
                            ? 'bg-blue-900/50 text-blue-400'
                            : 'bg-purple-900/50 text-purple-400'
                        }`}
                      >
                        {state.slot.plex_type === 'show' ? 'TV' : 'Movie'}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => removeSlot.mutate({ blockId, slotId: state.slot.id })}
                    disabled={removeSlot.isPending}
                    title="Remove slot"
                    className="flex-shrink-0 p-1 text-slate-600 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {removeSlot.isPending ? (
                      <Spinner size="sm" />
                    ) : (
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                </div>
              )}

              {state.type === 'continuation' && (
                <div className="flex items-center gap-2 rounded px-2 py-1.5 min-h-[36px] bg-slate-900/40 border border-slate-800/50 opacity-60">
                  <span className="text-xs text-slate-600 w-16 flex-shrink-0 tabular-nums">
                    {to12h(hour)}
                  </span>
                  <span className="text-slate-600 text-sm">↓</span>
                  <span className="text-xs text-slate-600 truncate italic">
                    {state.slot.plex_title}
                  </span>
                </div>
              )}
            </div>

            {/* Inline slot editor */}
            {isAddingHere && (
              <div className="mt-1 mb-2">
                <SlotEditor blockId={blockId} targetHour={hour} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
