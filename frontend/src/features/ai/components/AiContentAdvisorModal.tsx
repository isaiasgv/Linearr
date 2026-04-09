import { useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useAiContentAdvisor } from '@/features/ai/hooks'
import { useAssign } from '@/features/assignments/hooks'
import type { PlexItem } from '@/shared/types'
import type { AiContentAdvisorResult } from '@/features/ai/types'

type ContentTab = 'shows' | 'movies'

function PosterCard({ item, channelNumber }: { item: PlexItem; channelNumber: number }) {
  const assign = useAssign()

  const handleAdd = () => {
    assign.mutate({
      channel_number: channelNumber,
      plex_rating_key: item.rating_key,
      plex_title: item.title,
      plex_type: item.type,
      plex_thumb: item.thumb,
      plex_year: item.year,
    })
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden group">
      <div className="aspect-[2/3] bg-slate-800 relative overflow-hidden">
        {item.thumb ? (
          <img
            src={item.thumb}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <svg
              className="w-8 h-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <path d="M17 2l-5 5-5-5" />
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={handleAdd}
            disabled={assign.isPending}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
          >
            {assign.isPending ? <Spinner size="sm" /> : '+'}
            Add
          </button>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-slate-100 truncate" title={item.title}>
          {item.title}
        </p>
        {item.year && <p className="text-xs text-slate-500">{item.year}</p>}
      </div>
    </div>
  )
}

export function AiContentAdvisorModal() {
  const open = useUIStore((s) => s.modals.aiContentAdvisor)
  const closeModal = useUIStore((s) => s.closeModal)
  const channelNumber = useUIStore((s) => s.aiContentAdvisorChannel)

  const advisor = useAiContentAdvisor()
  const [result, setResult] = useState<AiContentAdvisorResult | null>(null)
  const [activeTab, setActiveTab] = useState<ContentTab>('shows')

  const handleGetRecommendations = () => {
    if (channelNumber == null) return
    advisor.mutate(
      { channelNumber },
      {
        onSuccess: (data) => {
          setResult(data)
        },
      },
    )
  }

  const handleClose = () => {
    closeModal('aiContentAdvisor')
    setResult(null)
  }

  const items = result ? (activeTab === 'shows' ? result.shows : result.movies) : []

  return (
    <ModalWrapper open={open} onClose={handleClose} maxWidth="max-w-3xl">
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">AI Content Advisor</h2>
            {channelNumber != null && (
              <p className="text-xs text-slate-400 mt-0.5">Channel {channelNumber}</p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-100 transition-colors"
          >
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!result && !advisor.isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-900/30 border border-indigo-700/50 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-indigo-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm mb-6">
                Get AI-powered content recommendations tailored to this channel's vibe and
                programming style.
              </p>
              <button
                onClick={handleGetRecommendations}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Get Recommendations
              </button>
            </div>
          )}

          {advisor.isPending && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-slate-400">Analyzing channel content…</p>
            </div>
          )}

          {result && !advisor.isPending && (
            <div className="space-y-4">
              {/* Explanation */}
              {result.explanation && (
                <div className="bg-indigo-900/20 border border-indigo-700/50 rounded-lg px-4 py-3">
                  <p className="text-sm text-indigo-200">{result.explanation}</p>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 bg-slate-900 rounded-lg p-1">
                {(['shows', 'movies'] as ContentTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                      activeTab === t
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {t}{' '}
                    <span className="text-xs opacity-70">
                      ({t === 'shows' ? result.shows.length : result.movies.length})
                    </span>
                  </button>
                ))}
              </div>

              {/* Grid */}
              {channelNumber != null && items.length > 0 ? (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                  {items.map((item) => (
                    <PosterCard key={item.rating_key} item={item} channelNumber={channelNumber} />
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-500 text-sm py-6">
                  No {activeTab} recommended
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {result && (
          <div className="px-6 py-4 border-t border-slate-700 shrink-0 flex justify-between items-center">
            <button
              onClick={handleGetRecommendations}
              disabled={advisor.isPending}
              className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 disabled:opacity-60 transition-colors"
            >
              {advisor.isPending && <Spinner size="sm" />}
              Refresh recommendations
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </ModalWrapper>
  )
}
