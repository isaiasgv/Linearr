import { useUIStore } from '@/shared/store/ui.store'
import { useGenericBlocks } from '@/features/blocks/hooks'
import { useBlockStore } from '@/features/blocks/store'
import { BlockCard } from '@/features/blocks/components/BlockCard'
import { NetworkSuggestionsPanel } from '@/features/blocks/components/NetworkSuggestionsPanel'
import { Spinner } from '@/shared/components/ui/Spinner'

export function GenericBlocksView() {
  const openModal = useUIStore((s) => s.openModal)
  const { data: blocks = [], isLoading, isError } = useGenericBlocks()
  const networkSuggestionsOpen = useBlockStore((s) => s.networkSuggestionsOpen)
  const setNetworkSuggestionsOpen = useBlockStore((s) => s.setNetworkSuggestionsOpen)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Generic Blocks</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Reusable programming blocks not tied to a specific channel
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNetworkSuggestionsOpen(!networkSuggestionsOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
                networkSuggestionsOpen
                  ? 'bg-indigo-900/30 border-indigo-700/50 text-indigo-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Network Suggestions
            </button>
            <button
              onClick={() => openModal('blockForm', { editingBlock: null })}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors"
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
              New Block
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <Spinner />
              Loading blocks…
            </div>
          )}

          {isError && (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm">Failed to load generic blocks</p>
            </div>
          )}

          {!isLoading && !isError && blocks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-slate-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm mb-2">No generic blocks yet</p>
              <p className="text-xs text-slate-500 mb-6">
                Create reusable programming blocks that can be applied to any channel
              </p>
              <button
                onClick={() => openModal('blockForm', { editingBlock: null })}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create First Block
              </button>
            </div>
          )}

          {!isLoading && blocks.length > 0 && (
            <div className="space-y-2">
              {blocks.map((block) => (
                <BlockCard key={block.id} block={block} />
              ))}
            </div>
          )}
        </div>

        {/* Network Suggestions Panel */}
        {networkSuggestionsOpen && (
          <div className="w-80 shrink-0 border-l border-slate-800 overflow-y-auto p-4">
            <NetworkSuggestionsPanel channelNumber={0} />
          </div>
        )}
      </div>
    </div>
  )
}
