import { useState } from 'react'
import { ModalWrapper } from '@/shared/components/ui/ModalWrapper'
import { Spinner } from '@/shared/components/ui/Spinner'
import { useUIStore } from '@/shared/store/ui.store'
import { useNetworkAdvisor } from '@/features/ai/hooks'
import { useBulkAssign } from '@/features/assignments/hooks'
import type { NetworkAdvisorResult } from '@/features/ai/types'
import type { Assignment } from '@/shared/types'

export function NetworkAdvisorModal() {
  const open = useUIStore((s) => s.modals.networkAdvisor)
  const closeModal = useUIStore((s) => s.closeModal)

  const networkAdvisor = useNetworkAdvisor()
  const bulkAssign = useBulkAssign()
  const [result, setResult] = useState<NetworkAdvisorResult | null>(null)
  const [addingChannel, setAddingChannel] = useState<number | null>(null)

  const handleAnalyze = () => {
    networkAdvisor.mutate(undefined, {
      onSuccess: (data) => setResult(data),
    })
  }

  const handleBulkAdd = (channelNumber: number, items: Assignment[]) => {
    setAddingChannel(channelNumber)
    bulkAssign.mutate(
      {
        channelNumber,
        items: items.map((item) => ({
          plex_rating_key: item.plex_rating_key,
          plex_title: item.plex_title,
          plex_type: item.plex_type,
          plex_thumb: item.plex_thumb,
          plex_year: item.plex_year,
        })),
      },
      {
        onSettled: () => setAddingChannel(null),
      },
    )
  }

  const handleClose = () => {
    closeModal('networkAdvisor')
    setResult(null)
  }

  return (
    <ModalWrapper open={open} onClose={handleClose} maxWidth="max-w-3xl">
      <div className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Network Advisor</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              AI-powered network-wide content recommendations
            </p>
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
          {!result && !networkAdvisor.isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-900/30 border border-emerald-700/50 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-emerald-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="5" cy="19" r="2" />
                  <circle cx="19" cy="19" r="2" />
                  <path d="M12 7v4M12 11l-5 6M12 11l5 6" />
                </svg>
              </div>
              <p className="text-slate-400 text-sm mb-6">
                Analyze your entire network to get cross-channel content recommendations and gap
                analysis.
              </p>
              <button
                onClick={handleAnalyze}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Analyze Network
              </button>
            </div>
          )}

          {networkAdvisor.isPending && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-slate-400">Analyzing your network…</p>
            </div>
          )}

          {result && !networkAdvisor.isPending && (
            <div className="space-y-4">
              {result.recommendations.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-6">
                  No recommendations at this time
                </p>
              ) : (
                result.recommendations.map((rec) => (
                  <div
                    key={rec.channel_number}
                    className="bg-slate-900 border border-slate-700 rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
                          CH {rec.channel_number}
                        </span>
                        <span className="font-medium text-slate-100 text-sm">
                          {rec.channel_name}
                        </span>
                      </div>
                      <button
                        onClick={() => handleBulkAdd(rec.channel_number, rec.items)}
                        disabled={addingChannel === rec.channel_number || bulkAssign.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
                      >
                        {addingChannel === rec.channel_number ? (
                          <Spinner size="sm" />
                        ) : (
                          <svg
                            className="w-3 h-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        )}
                        Bulk Add ({rec.items.length})
                      </button>
                    </div>

                    {rec.reason && (
                      <p className="text-xs text-slate-400 mb-3 bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                        {rec.reason}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {rec.items.map((item) => (
                        <div
                          key={item.plex_rating_key}
                          className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5"
                        >
                          {item.plex_thumb && (
                            <img
                              src={item.plex_thumb}
                              alt={item.plex_title}
                              className="w-6 h-6 rounded object-cover shrink-0"
                            />
                          )}
                          <div>
                            <p className="text-xs font-medium text-slate-200">{item.plex_title}</p>
                            {item.plex_year && (
                              <p className="text-xs text-slate-500">{item.plex_year}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 shrink-0 flex justify-between items-center">
          {result && (
            <button
              onClick={handleAnalyze}
              disabled={networkAdvisor.isPending}
              className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 disabled:opacity-60 transition-colors"
            >
              {networkAdvisor.isPending && <Spinner size="sm" />}
              Re-analyze
            </button>
          )}
          <div className="ml-auto">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-100 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
