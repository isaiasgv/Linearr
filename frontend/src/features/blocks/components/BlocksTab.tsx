import { useUIStore } from '@/shared/store/ui.store'
import { useChannelBlocks, useCreateBlock } from '@/features/blocks/hooks'
import { useAiGenerateDay } from '@/features/ai/hooks'
import { BLOCK_PRESETS } from '@/features/blocks/types'
import { Spinner } from '@/shared/components/ui/Spinner'
import { BlockCard } from './BlockCard'
import { NetworkSuggestionsPanel } from './NetworkSuggestionsPanel'

interface BlocksTabProps {
  channelNumber: number
}

export function BlocksTab({ channelNumber }: BlocksTabProps) {
  const { openModal, selectedChannel } = useUIStore()

  const { data: blocks = [], isLoading, isError } = useChannelBlocks(channelNumber)

  const createBlock = useCreateBlock()
  const aiGenerateDay = useAiGenerateDay()

  function handleAiGenerateDay() {
    if (!selectedChannel) return
    aiGenerateDay.mutate({
      channel_number: channelNumber,
      style: 'cable',
    })
  }

  function handleQuickCreate(preset: (typeof BLOCK_PRESETS)[number]) {
    createBlock.mutate({
      name: preset.name,
      start_time: preset.start_time,
      end_time: preset.end_time,
      days: preset.days,
      content_type: preset.content_type,
      notes: '',
      channel_number: channelNumber,
    })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => openModal('blockForm')}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-indigo-700 hover:bg-indigo-600 text-indigo-100 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Block
        </button>

        <button
          onClick={() => openModal('templatesLibrary')}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 6h16M4 10h16M4 14h10M4 18h6" />
          </svg>
          Load Templates
        </button>

        <button
          onClick={handleAiGenerateDay}
          disabled={aiGenerateDay.isPending || !selectedChannel}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-800 hover:bg-emerald-700 text-emerald-100 rounded-lg border border-emerald-700 transition-colors disabled:opacity-50"
        >
          {aiGenerateDay.isPending ? (
            <Spinner size="sm" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
            </svg>
          )}
          AI Generate Day
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">Failed to load blocks. Please refresh.</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && blocks.length === 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl px-6 py-8 text-center">
          <div className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1">No schedule blocks yet</h3>
          <p className="text-xs text-slate-500 mb-5">
            Create blocks to organize your channel's programming schedule.
          </p>

          {/* Preset quick-create chips */}
          <div className="flex flex-wrap gap-2 justify-center">
            {BLOCK_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handleQuickCreate(preset)}
                disabled={createBlock.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-slate-100 rounded-full border border-slate-600 hover:border-slate-500 transition-colors disabled:opacity-50"
              >
                {createBlock.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Block list */}
      {!isLoading && !isError && blocks.length > 0 && (
        <div className="space-y-2">
          {blocks.map((block) => (
            <BlockCard key={block.id} block={block} />
          ))}
        </div>
      )}

      {/* Network suggestions */}
      <NetworkSuggestionsPanel channelNumber={channelNumber} />
    </div>
  )
}
