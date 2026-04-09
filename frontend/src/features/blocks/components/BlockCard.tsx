import { useUIStore } from '@/shared/store/ui.store'
import { useBlockStore } from '@/features/blocks/store'
import {
  useDeleteBlock,
  useClearSlots,
  useAiAutofill,
  useApplyBlock,
  useBlockSlots,
} from '@/features/blocks/hooks'
import { blockTimeColor, to12h, blockFillHours } from '@/features/blocks/utils'
import type { Block } from '@/shared/types'
import { Spinner } from '@/shared/components/ui/Spinner'
import { HourGrid } from './HourGrid'

interface BlockCardProps {
  block: Block
}

const CONTENT_TYPE_LABEL: Record<Block['content_type'], string> = {
  shows: 'Shows',
  movies: 'Movies',
  both: 'Both',
}

const CONTENT_TYPE_COLOR: Record<Block['content_type'], string> = {
  shows: 'bg-blue-900/50 text-blue-300 border border-blue-700',
  movies: 'bg-purple-900/50 text-purple-300 border border-purple-700',
  both: 'bg-slate-700 text-slate-300 border border-slate-600',
}

export function BlockCard({ block }: BlockCardProps) {
  const { openModal, selectedChannel } = useUIStore()
  const { expandedBlockId, expandBlock } = useBlockStore()

  const isExpanded = expandedBlockId === block.id
  const isGeneric = block.channel_number === null

  const { data: slots } = useBlockSlots(block.id, true)

  const deleteBlock = useDeleteBlock()
  const clearSlots = useClearSlots()
  const aiAutofill = useAiAutofill()
  const applyBlock = useApplyBlock()

  const fill = blockFillHours(block, slots)
  const borderColor = blockTimeColor(block.start_time)

  function handleEdit() {
    openModal('blockForm', { editingBlock: block })
  }

  function handleDelete() {
    if (!confirm(`Delete block "${block.name}"?`)) return
    deleteBlock.mutate({ id: block.id, channelNumber: block.channel_number })
  }

  function handleClear() {
    if (!confirm(`Clear all slots in "${block.name}"?`)) return
    clearSlots.mutate(block.id)
  }

  function handleAiAutofill() {
    aiAutofill.mutate({ blockId: block.id })
  }

  function handleApply() {
    if (!selectedChannel) return
    applyBlock.mutate({ blockId: block.id, channelNumber: selectedChannel.number })
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      {/* Header row — click to toggle expand */}
      <div
        className={`border-l-4 ${borderColor} px-4 py-3 flex items-center gap-3 cursor-pointer select-none`}
        onClick={() => expandBlock(block.id)}
      >
        {/* Block info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100">{block.name}</span>
            <span className="text-xs text-slate-400">
              {to12h(block.start_time)} – {to12h(block.end_time)}
            </span>
            {block.days.length > 0 && (
              <span className="text-xs text-slate-500">{block.days.join(', ')}</span>
            )}
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium ${CONTENT_TYPE_COLOR[block.content_type]}`}
            >
              {CONTENT_TYPE_LABEL[block.content_type]}
            </span>
          </div>
        </div>

        {/* Fill status */}
        <div className="flex-shrink-0 text-xs text-slate-400 tabular-nums">
          {fill ? (
            <span className={fill.covered === fill.total ? 'text-emerald-400' : ''}>
              {fill.covered}/{fill.total}h
            </span>
          ) : (
            <span className="text-slate-600">–/–h</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isGeneric && selectedChannel && (
            <button
              onClick={handleApply}
              disabled={applyBlock.isPending}
              title="Apply to channel"
              className="px-2 py-1 text-xs bg-indigo-700 hover:bg-indigo-600 text-indigo-100 rounded transition-colors disabled:opacity-50"
            >
              {applyBlock.isPending ? <Spinner size="sm" /> : 'Apply'}
            </button>
          )}

          <button
            onClick={handleAiAutofill}
            disabled={aiAutofill.isPending}
            title="AI Autofill"
            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
          >
            {aiAutofill.isPending ? (
              <Spinner size="sm" />
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
              </svg>
            )}
          </button>

          <button
            onClick={handleEdit}
            title="Edit block"
            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>

          <button
            onClick={handleClear}
            disabled={clearSlots.isPending}
            title="Clear slots"
            className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
          >
            {clearSlots.isPending ? (
              <Spinner size="sm" />
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            )}
          </button>

          <button
            onClick={handleDelete}
            disabled={deleteBlock.isPending}
            title="Delete block"
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
          >
            {deleteBlock.isPending ? (
              <Spinner size="sm" />
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
            )}
          </button>

          <button
            onClick={() => expandBlock(block.id)}
            title={isExpanded ? 'Collapse' : 'Expand'}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Slot thumbnail preview (collapsed) */}
      {!isExpanded && slots && slots.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-700/50 flex gap-1 overflow-hidden">
          {slots
            .filter((s) => s.plex_thumb)
            .slice(0, 10)
            .map((s) => (
              <div
                key={s.id}
                className="w-8 h-12 shrink-0 rounded overflow-hidden bg-slate-700 relative"
                title={`${to12h(s.slot_time)} — ${s.plex_title}`}
              >
                <img
                  src={`/api/plex/thumb?path=${encodeURIComponent(s.plex_thumb!)}`}
                  alt={s.plex_title}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>
            ))}
          {slots.length > 10 && (
            <span className="flex items-center text-xs text-slate-600 shrink-0 pl-1">
              +{slots.length - 10}
            </span>
          )}
        </div>
      )}

      {/* Expanded hour grid */}
      {isExpanded && (
        <div className="border-t border-slate-700">
          <HourGrid blockId={block.id} block={block} />
        </div>
      )}
    </div>
  )
}
