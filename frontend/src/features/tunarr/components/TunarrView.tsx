import { useState, lazy, Suspense } from 'react'
import { Spinner } from '@/shared/components/ui/Spinner'

const TunarrGuide = lazy(() => import('./TunarrGuide').then((m) => ({ default: m.TunarrGuide })))
import {
  useTunarrChannels,
  useTunarrLinks,
  useTunarrSmartCollections,
  useTunarrSchedule,
  useTunarrTasks,
  useTestTunarr,
  useTunarrVersionCheck,
  useUpdateSmartCollection,
  useDeleteSmartCollection,
} from '@/features/tunarr/hooks'
import { use247Suggestions, useAiSuggestChannels } from '@/features/ai/hooks'
import { useCreateChannel } from '@/features/channels/hooks'
import { useSettings } from '@/features/settings/hooks'
import type {
  SmartCollection,
  Suggestion247,
  AiChannelSuggestion,
  AiPackageSuggestion,
  TunarrScheduleItem,
} from '@/shared/types'

// ── SmartCollectionRow ────────────────────────────────────────────────────────

interface SmartCollectionRowProps {
  collection: SmartCollection
}

function SmartCollectionRow({ collection }: SmartCollectionRowProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(collection.name)
  const [filterString, setFilterString] = useState(collection.filterString)
  const [keywords, setKeywords] = useState(collection.keywords)
  const updateSmartCollection = useUpdateSmartCollection()
  const deleteSmartCollection = useDeleteSmartCollection()

  const handleSave = () => {
    updateSmartCollection.mutate(
      { uuid: collection.uuid, body: { name, filterString, keywords } },
      { onSuccess: () => setEditing(false) },
    )
  }

  if (editing) {
    return (
      <div className="bg-slate-800 border border-indigo-700/50 rounded-xl p-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Filter String</label>
          <input
            type="text"
            value={filterString}
            onChange={(e) => setFilterString(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Keywords</label>
          <input
            type="text"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="comma-separated keywords"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => {
              setName(collection.name)
              setFilterString(collection.filterString)
              setKeywords(collection.keywords)
              setEditing(false)
            }}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateSmartCollection.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
          >
            {updateSmartCollection.isPending && <Spinner size="sm" />}Save
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-100">{collection.name}</p>
          {collection.filterString && (
            <p className="text-xs font-mono text-slate-400 mt-1 truncate">
              {collection.filterString}
            </p>
          )}
          {collection.keywords && (
            <p className="text-xs text-slate-500 mt-1">Keywords: {collection.keywords}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-slate-400 hover:text-slate-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => deleteSmartCollection.mutate(collection.uuid)}
            disabled={deleteSmartCollection.isPending}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-60 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── TunarrChannelCard ─────────────────────────────────────────────────────────

function nowPlaying(schedule: TunarrScheduleItem[] | undefined): string | null {
  if (!schedule?.length) return null
  const now = Date.now()
  for (const item of schedule) {
    const start = new Date(item.startTime).getTime()
    const end = start + item.duration
    if (now >= start && now < end) {
      if (item.episode?.title) return `${item.title} — ${item.episode.title}`
      return item.title ?? null
    }
  }
  return null
}

interface TunarrChannelCardProps {
  channel: { id: string; name: string; number: number; icon?: { path?: string } }
  linkedGalaxyName?: string
}

function TunarrChannelCard({ channel, linkedGalaxyName }: TunarrChannelCardProps) {
  const [showSchedule, setShowSchedule] = useState(false)
  const { data: schedule, isLoading: scheduleLoading } = useTunarrSchedule(channel.id, showSchedule)

  const playing = showSchedule ? nowPlaying(schedule) : null

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {channel.icon?.path ? (
          <img
            src={channel.icon.path}
            alt={channel.name}
            className="w-8 h-8 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-mono text-slate-400">{channel.number}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-100 truncate">{channel.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-slate-500">CH {channel.number}</p>
            {linkedGalaxyName && (
              <span className="text-xs bg-emerald-900/40 border border-emerald-700/50 text-emerald-400 rounded px-1.5 py-0.5">
                → {linkedGalaxyName}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowSchedule((v) => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${showSchedule ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
        >
          Schedule
        </button>
      </div>

      {showSchedule && (
        <div className="border-t border-slate-800 pt-2">
          {scheduleLoading ? (
            <div className="flex items-center gap-2 text-slate-500 text-xs py-1">
              <Spinner size="sm" />
              Loading…
            </div>
          ) : playing ? (
            <p className="text-xs text-emerald-400 truncate">▶ {playing}</p>
          ) : schedule && schedule.length > 0 ? (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {schedule.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 w-14 shrink-0 tabular-nums">
                    {new Date(item.startTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-slate-300 truncate">
                    {item.episode?.title ? `${item.title} — ${item.episode.title}` : item.title}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600">No schedule data</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── 24/7 Channel Builder ──────────────────────────────────────────────────────

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
        <button
          onClick={() => suggest247.mutate()}
          disabled={suggest247.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
        >
          {suggest247.isPending ? (
            <Spinner size="sm" />
          ) : (
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
        </button>
      </div>

      {suggest247.isPending && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Spinner />
          Scanning Plex library…
        </div>
      )}

      {!suggest247.isPending && suggestions.length === 0 && !suggest247.data && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
          <p className="text-slate-500 text-sm">
            Click "Scan Plex Library" to find 24/7 channel candidates
          </p>
        </div>
      )}

      {!suggest247.isPending && suggestions.length === 0 && suggest247.data && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
          <p className="text-slate-500 text-sm">
            No new 24/7 channel candidates found — all eligible content already has channels
          </p>
        </div>
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
                      className="w-12 h-16 object-cover rounded shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="w-12 h-16 bg-slate-800 rounded shrink-0 flex items-center justify-center">
                      <span className="text-xs text-slate-600">?</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">
                      {s.channel_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${s.type === 'shows' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'}`}
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
                  <span className="text-xs text-slate-600">CH {s.suggested_number}</span>
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

// ── AI Channel Suggestions ────────────────────────────────────────────────────

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
        <button
          onClick={() => aiSuggest.mutate()}
          disabled={aiSuggest.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 hover:bg-emerald-900/50 disabled:opacity-60 border border-emerald-700/50 text-emerald-300 rounded-lg text-xs font-medium transition-colors"
        >
          {aiSuggest.isPending ? (
            <Spinner size="sm" />
          ) : (
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
        </button>
      </div>

      {aiSuggest.isPending && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Spinner />
          AI is analyzing your library…
        </div>
      )}

      {!aiSuggest.isPending && !aiSuggest.data && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
          <p className="text-slate-500 text-sm">
            Click "Generate Suggestions" to get AI channel recommendations
          </p>
          <p className="text-xs text-slate-600 mt-1">Requires AI API key in Settings</p>
        </div>
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
                          className={`text-xs px-1.5 py-0.5 rounded border ${tierColor(s.tier)}`}
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
                          className="text-xs bg-slate-800 text-slate-400 rounded px-1.5 py-0.5"
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
                          className="text-xs bg-slate-800 border border-slate-700 text-slate-400 rounded px-1.5 py-0.5"
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

// ── TunarrView ────────────────────────────────────────────────────────────────

export function TunarrView() {
  const [showGuide, setShowGuide] = useState(false)
  const { data: tunarrChannels = [], isLoading: loadingChannels } = useTunarrChannels()
  const { data: links = [] } = useTunarrLinks()
  const { data: smartCollections = [], isLoading: loadingCollections } = useTunarrSmartCollections()
  const { data: settings } = useSettings()
  const { refreshGuide, scanLibraries } = useTunarrTasks()
  const testTunarr = useTestTunarr()
  const { data: versionCheck } = useTunarrVersionCheck()

  if (showGuide) {
    return (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <TunarrGuide onClose={() => setShowGuide(false)} />
      </Suspense>
    )
  }

  // Build a map from tunarr_id → Galaxy channel name for display
  const tunarrIdToGalaxy = Object.fromEntries(
    links.map((l) => [l.tunarr_id, `CH ${l.channel_number}${l.tunarr_name ? '' : ''}`]),
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 2v4H5v2h14V6h-2V2h-2v4H9V2H7zm3 8v12h4V10h-4z" />
              </svg>
              Tunarr Integration
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {settings?.tunarr_url && (
                <span className="text-xs text-slate-500">{settings.tunarr_url}</span>
              )}
              {versionCheck?.version && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  v{versionCheck.version}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 border border-emerald-700 text-emerald-100 rounded-lg text-xs font-medium transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
            Program Guide
          </button>
          <button
            onClick={() => testTunarr.mutate(settings?.tunarr_url ?? '')}
            disabled={testTunarr.isPending || !settings?.tunarr_url}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            {testTunarr.isPending && <Spinner size="sm" />}
            Test Connection
          </button>
        </div>
      </div>

      {/* Version warning */}
      {versionCheck?.is_supported === false && (
        <div className="mx-6 mt-4 flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-950/50 border border-amber-700/50">
          <svg
            className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-200">Unsupported Tunarr Version</p>
            <p className="text-xs text-amber-300/70 mt-0.5">
              Tunarr <strong>v{versionCheck.version}</strong> is newer than the supported version{' '}
              <strong>v{versionCheck.supported_version}</strong>. Some features may not work
              correctly. Update Linearr to the latest version for full compatibility.
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Tunarr Channels */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Tunarr Channels
              {tunarrChannels.length > 0 && (
                <span className="ml-2 text-xs text-slate-500">({tunarrChannels.length})</span>
              )}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => scanLibraries.mutate()}
                disabled={scanLibraries.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                {scanLibraries.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M4 4v6h6M20 20v-6h-6" />
                    <path d="M20 10A8 8 0 0 0 6.93 6.93M4 14a8 8 0 0 0 13.07 3.07" />
                  </svg>
                )}
                Scan Libraries
              </button>
              <button
                onClick={() => refreshGuide.mutate()}
                disabled={refreshGuide.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                {refreshGuide.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M4 4v6h6M20 20v-6h-6" />
                    <path d="M20 10A8 8 0 0 0 6.93 6.93M4 14a8 8 0 0 0 13.07 3.07" />
                  </svg>
                )}
                Refresh Guide
              </button>
            </div>
          </div>

          {loadingChannels ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Spinner size="sm" />
              Loading channels…
            </div>
          ) : tunarrChannels.length === 0 ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
              <p className="text-slate-500 text-sm">No Tunarr channels found</p>
              <p className="text-xs text-slate-600 mt-1">
                Check your Tunarr connection in Settings
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tunarrChannels.map((tc) => (
                <TunarrChannelCard
                  key={tc.id}
                  channel={tc}
                  linkedGalaxyName={tunarrIdToGalaxy[tc.id]}
                />
              ))}
            </div>
          )}
        </section>

        {/* 24/7 Channel Builder */}
        <ChannelBuilder247 />

        {/* AI Channel Suggestions */}
        <AiChannelSuggestions />

        {/* Smart Collections */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Smart Collections
              {smartCollections.length > 0 && (
                <span className="ml-2 text-xs text-slate-500">({smartCollections.length})</span>
              )}
            </h2>
          </div>

          {loadingCollections ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Spinner size="sm" />
              Loading…
            </div>
          ) : smartCollections.length === 0 ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 text-center">
              <p className="text-slate-500 text-sm">No smart collections configured</p>
            </div>
          ) : (
            <div className="space-y-2">
              {smartCollections.map((sc) => (
                <SmartCollectionRow key={sc.uuid} collection={sc} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
