/**
 * Channel-creation helpers: the 24/7 builder and the AI channel advisor.
 *
 * Both propose channels and create them on confirmation, so they belong
 * together and apart from the read-mostly Tunarr panels. Extracted verbatim
 * from `TunarrView`; behaviour is unchanged.
 */
import { useState } from 'react'
import { Button, EmptyState, Spinner } from '@/shared/components/ui'
import { useCreateChannel } from '@/features/channels/hooks'
import { use247Suggestions, useAiSuggestChannels } from '@/features/ai/hooks'
import type { Suggestion247, AiChannelSuggestion, AiPackageSuggestion } from '@/shared/types'

function ChannelBuilder247() {
  const suggest247 = use247Suggestions()
  const createChannel = useCreateChannel()
  const [created, setCreated] = useState<Set<number>>(new Set())

  const suggestions: Suggestion247[] = suggest247.data ?? []

  function handleCreate(s: Suggestion247) {
    createChannel.mutate(
      {
        number: s.suggested_number,
        name: s.channel_name,
        tier: 'Galaxy Main',
        vibe: s.type === 'shows' ? `24/7 ${s.title}` : `${s.title} Marathon`,
        mode: '24/7',
        style: s.description,
        color: 'blue',
      },
      { onSuccess: () => setCreated((prev) => new Set([...prev, s.suggested_number])) },
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">24/7 Channel Builder</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Channels based on your Plex library content
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => suggest247.mutate()}
          loading={suggest247.isPending}
        >
          {!suggest247.isPending && (
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          )}
          Scan Plex Library
        </Button>
      </div>

      {suggest247.isPending && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Spinner />
          Scanning Plex library…
        </div>
      )}

      {!suggest247.isPending && suggestions.length === 0 && !suggest247.data && (
        <EmptyState
          className="bg-slate-900 border border-slate-700 rounded-xl"
          title="No suggestions yet"
          description='Click "Scan Plex Library" to find 24/7 channel candidates'
        />
      )}

      {!suggest247.isPending && suggestions.length === 0 && suggest247.data && (
        <EmptyState
          className="bg-slate-900 border border-slate-700 rounded-xl"
          title="No new 24/7 channel candidates found"
          description="All eligible content already has channels"
        />
      )}

      {suggestions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestions.map((s) => {
            const done = created.has(s.suggested_number)
            return (
              <div
                key={s.rating_key}
                className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden"
              >
                <div className="flex gap-3 p-3">
                  {s.thumb ? (
                    <img
                      src={`/api/plex/thumb?path=${encodeURIComponent(s.thumb)}`}
                      alt={s.title}
                      className="w-12 h-16 object-cover rounded-sm shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="w-12 h-16 bg-slate-800 rounded-sm shrink-0 flex items-center justify-center">
                      <span className="text-xs text-slate-600">?</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">
                      {s.channel_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-sm ${s.type === 'shows' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'}`}
                      >
                        {s.type === 'shows' ? 'TV' : 'Movies'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {s.type === 'shows'
                          ? `${s.episodes} ep · ${s.hours}h`
                          : `${s.episodes} films · ${s.hours}h`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.description}</p>
                  </div>
                </div>
                <div className="px-3 pb-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">CH {s.suggested_number}</span>
                  <button
                    onClick={() => handleCreate(s)}
                    disabled={createChannel.isPending || done}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                      done
                        ? 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-400'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {createChannel.isPending && !done ? <Spinner size="sm" /> : null}
                    {done ? '✓ Created' : 'Create Channel'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AiChannelSuggestions() {
  const aiSuggest = useAiSuggestChannels()
  const createChannel = useCreateChannel()
  const [created, setCreated] = useState<Set<number>>(new Set())

  const channels: AiChannelSuggestion[] = aiSuggest.data?.suggestions?.channels ?? []
  const packages: AiPackageSuggestion[] = aiSuggest.data?.suggestions?.packages ?? []

  function handleCreate(s: AiChannelSuggestion) {
    createChannel.mutate(
      {
        number: s.number,
        name: s.name,
        tier: s.tier as never,
        vibe: s.vibe,
        mode: 'Shuffle',
        style: s.description,
        color: 'blue',
      },
      { onSuccess: () => setCreated((prev) => new Set([...prev, s.number])) },
    )
  }

  const tierColor = (tier: string) => {
    if (tier.includes('Premium')) return 'bg-amber-900/50 text-amber-300 border-amber-700/50'
    if (tier.includes('Classic')) return 'bg-purple-900/50 text-purple-300 border-purple-700/50'
    return 'bg-blue-900/50 text-blue-300 border-blue-700/50'
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">AI Channel Suggestions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            AI-powered lineup recommendations based on your library
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => aiSuggest.mutate()}
          loading={aiSuggest.isPending}
        >
          {!aiSuggest.isPending && (
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
            </svg>
          )}
          Generate Suggestions
        </Button>
      </div>

      {aiSuggest.isPending && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Spinner />
          AI is analyzing your library…
        </div>
      )}

      {!aiSuggest.isPending && !aiSuggest.data && (
        <EmptyState
          className="bg-slate-900 border border-slate-700 rounded-xl"
          title="No AI suggestions yet"
          description='Click "Generate Suggestions" to get AI channel recommendations. Requires an AI API key in Settings.'
        />
      )}

      {channels.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {channels.map((s) => {
              const done = created.has(s.number)
              return (
                <div
                  key={s.number}
                  className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-sm border ${tierColor(s.tier)}`}
                        >
                          CH {s.number}
                        </span>
                        <span className="text-xs text-slate-500">{s.tier}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-100">{s.name}</p>
                      {s.vibe && <p className="text-xs text-slate-400 italic mt-0.5">{s.vibe}</p>}
                      {s.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.description}</p>
                      )}
                    </div>
                  </div>
                  {s.suggested_content && s.suggested_content.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {s.suggested_content.slice(0, 4).map((c) => (
                        <span
                          key={c}
                          className="text-xs bg-slate-800 text-slate-400 rounded-sm px-1.5 py-0.5"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => handleCreate(s)}
                    disabled={createChannel.isPending || done}
                    className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-60 ${
                      done
                        ? 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-400'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {createChannel.isPending && !done ? <Spinner size="sm" /> : null}
                    {done ? '✓ Created' : 'Create Channel'}
                  </button>
                </div>
              )
            })}
          </div>

          {packages.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Suggested Packages
              </h3>
              {packages.map((pkg, i) => (
                <div key={i} className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-100">{pkg.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{pkg.description}</p>
                      {pkg.highlights && (
                        <p className="text-xs text-slate-500 mt-1 italic">{pkg.highlights}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {pkg.channel_numbers.map((n) => (
                        <span
                          key={n}
                          className="text-xs bg-slate-800 border border-slate-700 text-slate-400 rounded-sm px-1.5 py-0.5"
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function BuildPanel() {
  return (
    <div className="space-y-8">
      <ChannelBuilder247 />
      <AiChannelSuggestions />
    </div>
  )
}
