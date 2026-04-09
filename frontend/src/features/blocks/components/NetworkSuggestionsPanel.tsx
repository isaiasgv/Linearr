import { useState } from 'react'
import { useNetworkAdvisor } from '@/features/ai/hooks'
import { useBulkAssign } from '@/features/assignments/hooks'
import type { NetworkSuggestion } from '@/shared/types'
import { Spinner } from '@/shared/components/ui/Spinner'

interface NetworkSuggestionsPanelProps {
  channelNumber: number
}

type FilterTab = 'all' | 'unassigned' | 'by-channel'

export function NetworkSuggestionsPanel({ channelNumber }: NetworkSuggestionsPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null)

  const networkAdvisor = useNetworkAdvisor()
  const bulkAssign = useBulkAssign()

  const suggestions: NetworkSuggestion[] = (() => {
    const raw = networkAdvisor.data
    if (!raw) return []
    // Backend returns { recommendations: [...] } via NetworkAdvisorResult
    if (raw && 'recommendations' in raw && Array.isArray((raw as any).recommendations)) {
      return (raw as any).recommendations as NetworkSuggestion[]
    }
    // Fallback: if somehow it's already an array
    if (Array.isArray(raw)) return raw as NetworkSuggestion[]
    return []
  })()

  function handleFetchSuggestions() {
    setIsOpen(true)
    networkAdvisor.mutate({})
  }

  function handleAddAll(suggestion: NetworkSuggestion) {
    bulkAssign.mutate({
      channelNumber: suggestion.channel_number,
      items: suggestion.items.map((a) => ({
        plex_rating_key: a.plex_rating_key,
        plex_title: a.plex_title,
        plex_type: a.plex_type,
        plex_thumb: a.plex_thumb,
        plex_year: a.plex_year,
      })),
    })
  }

  const channelNumbers = [...new Set(suggestions.map((s) => s.channel_number))]

  const filteredSuggestions = (() => {
    if (activeTab === 'unassigned') {
      return suggestions.filter((s) =>
        s.items.some((item) => item.channel_number !== channelNumber),
      )
    }
    if (activeTab === 'by-channel' && selectedChannel !== null) {
      return suggestions.filter((s) => s.channel_number === selectedChannel)
    }
    return suggestions
  })()

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      {/* Toggle header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4l3 3" />
          </svg>
          <span className="text-sm font-medium text-slate-200">Network Suggestions</span>
        </div>
        <button
          onClick={handleFetchSuggestions}
          disabled={networkAdvisor.isPending}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-indigo-100 rounded transition-colors disabled:opacity-50"
        >
          {networkAdvisor.isPending ? (
            <>
              <Spinner size="sm" />
              Analyzing...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
              </svg>
              Show Network Suggestions
            </>
          )}
        </button>
      </div>

      {/* Results panel */}
      {isOpen && (
        <div className="border-t border-slate-700">
          {networkAdvisor.isPending && (
            <div className="flex items-center justify-center py-10">
              <div className="text-center space-y-3">
                <Spinner size="lg" className="mx-auto" />
                <p className="text-sm text-slate-400">AI analyzing network content...</p>
              </div>
            </div>
          )}

          {networkAdvisor.isError && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-red-400">Failed to load suggestions. Please try again.</p>
            </div>
          )}

          {networkAdvisor.isSuccess && suggestions.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No network suggestions available.</p>
            </div>
          )}

          {networkAdvisor.isSuccess && suggestions.length > 0 && (
            <>
              {/* Filter tabs */}
              <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-1">
                {([
                  { value: 'all', label: 'All' },
                  { value: 'unassigned', label: 'Unassigned' },
                  { value: 'by-channel', label: 'By Channel' },
                ] as { value: FilterTab; label: string }[]).map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      activeTab === tab.value
                        ? 'bg-slate-700 text-slate-100'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}

                {activeTab === 'by-channel' && (
                  <select
                    value={selectedChannel ?? ''}
                    onChange={(e) => setSelectedChannel(e.target.value ? Number(e.target.value) : null)}
                    className="ml-2 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">All channels</option>
                    {channelNumbers.map((n) => {
                      const s = suggestions.find((x) => x.channel_number === n)
                      return (
                        <option key={n} value={n}>
                          Ch {n}{s ? ` – ${s.channel_name}` : ''}
                        </option>
                      )
                    })}
                  </select>
                )}
              </div>

              {/* Suggestion groups */}
              <div className="divide-y divide-slate-700/50 max-h-96 overflow-y-auto">
                {filteredSuggestions.map((suggestion) => (
                  <div key={suggestion.channel_number} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-300">
                            Ch {suggestion.channel_number} – {suggestion.channel_name}
                          </span>
                          <span className="text-xs bg-slate-700 text-slate-400 rounded px-1.5 py-0.5">
                            {suggestion.items.length} item{suggestion.items.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {suggestion.reason && (
                          <p className="text-xs text-slate-500 mb-2 italic">{suggestion.reason}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {suggestion.items.slice(0, 5).map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-1 bg-slate-700/50 rounded px-1.5 py-0.5"
                            >
                              <span className="text-xs text-slate-300 truncate max-w-[120px]">
                                {item.plex_title}
                              </span>
                              {item.plex_year && (
                                <span className="text-xs text-slate-500">({item.plex_year})</span>
                              )}
                            </div>
                          ))}
                          {suggestion.items.length > 5 && (
                            <span className="text-xs text-slate-500 self-center">
                              +{suggestion.items.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddAll(suggestion)}
                        disabled={bulkAssign.isPending}
                        className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-100 rounded transition-colors disabled:opacity-50"
                      >
                        {bulkAssign.isPending ? (
                          <Spinner size="sm" />
                        ) : (
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        )}
                        Add all
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
