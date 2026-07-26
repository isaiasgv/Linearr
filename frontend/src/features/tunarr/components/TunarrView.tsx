import { useState, useId, lazy, Suspense } from 'react'
import Swal from 'sweetalert2'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ModalWrapper,
  Select,
  Spinner,
  confirmDialog,
} from '@/shared/components/ui'

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
  usePurgeTunarrSmartCollections,
  useImportPreview,
  useImportChannels,
  useExportChannels,
  useRefreshXmltv,
  useTunarrSessions,
  useKillTunarrSessions,
  useTunarrFillerLists,
  useCreateFillerList,
  useDeleteFillerList,
} from '@/features/tunarr/hooks'
import { useChannels } from '@/features/channels/hooks'
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
  const fieldId = useId()
  const ids = {
    name: `${fieldId}-name`,
    filter: `${fieldId}-filter`,
    keywords: `${fieldId}-keywords`,
  }

  const handleSave = () => {
    updateSmartCollection.mutate(
      { uuid: collection.uuid, body: { name, filterString, keywords } },
      { onSuccess: () => setEditing(false) },
    )
  }

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: `Delete "${collection.name}"?`,
      text: 'This smart collection will be removed from Tunarr.',
      danger: true,
    })
    if (ok) deleteSmartCollection.mutate(collection.uuid)
  }

  if (editing) {
    return (
      <div className="bg-slate-800 border border-indigo-700/50 rounded-xl p-4 space-y-3">
        <div>
          <label htmlFor={ids.name} className="block text-xs text-slate-400 mb-1">
            Name
          </label>
          <Input id={ids.name} type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.filter} className="block text-xs text-slate-400 mb-1">
            Filter String
          </label>
          <Input
            id={ids.filter}
            type="text"
            value={filterString}
            onChange={(e) => setFilterString(e.target.value)}
            className="font-mono"
          />
        </div>
        <div>
          <label htmlFor={ids.keywords} className="block text-xs text-slate-400 mb-1">
            Keywords
          </label>
          <Input
            id={ids.keywords}
            type="text"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="comma-separated keywords"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setName(collection.name)
              setFilterString(collection.filterString)
              setKeywords(collection.keywords)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={updateSmartCollection.isPending}>
            Save
          </Button>
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
          <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="dangerSoft"
            size="xs"
            onClick={handleDelete}
            loading={deleteSmartCollection.isPending}
          >
            Delete
          </Button>
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
            className="w-8 h-8 rounded-sm object-cover shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-sm bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-mono text-slate-400">{channel.number}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-100 truncate">{channel.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-slate-500">CH {channel.number}</p>
            {linkedGalaxyName && (
              <span className="text-xs bg-emerald-900/40 border border-emerald-700/50 text-emerald-400 rounded-sm px-1.5 py-0.5">
                → {linkedGalaxyName}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowSchedule((v) => !v)}
          className={`text-xs px-2 py-1 rounded-sm border transition-colors ${showSchedule ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
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
            <p className="text-xs text-slate-500">No schedule data</p>
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

// ── TunarrView ────────────────────────────────────────────────────────────────

export function TunarrView() {
  const [showGuide, setShowGuide] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  // Import modal: tunarr_id → chosen action (defaults derived from the preview match)
  const [importSelections, setImportSelections] = useState<
    Record<string, 'link' | 'create' | 'skip'>
  >({})
  // Export modal: channel number → checked (unlinked channels default to checked)
  const [exportSelections, setExportSelections] = useState<Record<number, boolean>>({})
  const { data: tunarrChannels = [], isLoading: loadingChannels } = useTunarrChannels()
  const { data: links = [] } = useTunarrLinks()
  const { data: smartCollections = [], isLoading: loadingCollections } = useTunarrSmartCollections()
  const purgeSmartCollections = usePurgeTunarrSmartCollections()
  const { data: settings } = useSettings()
  const { refreshGuide, scanLibraries } = useTunarrTasks()
  const testTunarr = useTestTunarr()
  const { data: versionCheck } = useTunarrVersionCheck()
  const { data: cablePlexChannels = [] } = useChannels()
  const importPreview = useImportPreview()
  const importChannels = useImportChannels()
  const exportChannels = useExportChannels()
  const refreshXmltv = useRefreshXmltv()
  const { data: tunarrSessions } = useTunarrSessions()
  const killSessions = useKillTunarrSessions()
  const { data: fillerLists = [] } = useTunarrFillerLists()
  const createFillerList = useCreateFillerList()
  const deleteFillerList = useDeleteFillerList()

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

  // Import modal derived state (selection defaults come from the preview match)
  const importableChannels = (importPreview.data?.channels ?? []).filter(
    (ch) => ch.match !== 'already_linked',
  )
  const importActions = importableChannels.map((ch) => ({
    tunarr_id: ch.tunarr_id,
    action: importSelections[ch.tunarr_id] ?? (ch.match ? ('link' as const) : ('create' as const)),
    cable_plex_number: ch.cable_plex_channel?.number,
  }))
  const importSelectedCount = importActions.filter((a) => a.action !== 'skip').length

  // Export modal derived state (unlinked channels are checked by default)
  const exportableNumbers = cablePlexChannels
    .filter(
      (ch) =>
        !links.some((l) => l.channel_number === ch.number) && (exportSelections[ch.number] ?? true),
    )
    .map((ch) => ch.number)

  const handleCreateFillerList = async () => {
    const { value: name } = await Swal.fire<string>({
      title: 'New Filler List',
      input: 'text',
      inputPlaceholder: 'Filler list name',
      showCancelButton: true,
      confirmButtonText: 'Create',
      cancelButtonText: 'Cancel',
      background: '#1e293b',
      color: '#e2e8f0',
      confirmButtonColor: '#4f46e5',
      inputValidator: (value) => (value && value.trim() ? null : 'Please enter a name'),
    })
    if (name?.trim()) createFillerList.mutate({ name: name.trim() })
  }

  const handleDeleteFillerList = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete "${name}"?`,
      text: 'This filler list will be removed from Tunarr.',
      danger: true,
    })
    if (ok) deleteFillerList.mutate(id)
  }

  /**
   * Purge is global: it deletes EVERY smart collection in Tunarr, not just the
   * ones Linearr created. A generic yes/no is not enough — require the word
   * DELETE to be typed, and name the blast radius explicitly.
   */
  const handlePurgeSmartCollections = async () => {
    const count = smartCollections.length
    const { isConfirmed } = await Swal.fire({
      title: 'Delete ALL Tunarr smart collections?',
      html:
        `<p style="margin-bottom:.75rem">This deletes <strong>every one of the ${count} smart collection${count !== 1 ? 's' : ''}</strong> in Tunarr — ` +
        `including any you created by hand in Tunarr itself, not just the ones Linearr synced.</p>` +
        `<p style="margin-bottom:.75rem">Every Tunarr collection link in Linearr is cleared too. ` +
        `Channels whose schedules reference these collections will lose that content until you re-sync.</p>` +
        `<p>Your Plex collections are <strong>not</strong> affected. This cannot be undone.</p>`,
      icon: 'warning',
      input: 'text',
      inputPlaceholder: 'Type DELETE to confirm',
      inputAttributes: { autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off' },
      showCancelButton: true,
      confirmButtonText: 'Delete them all',
      cancelButtonText: 'Cancel',
      background: '#1e293b',
      color: '#e2e8f0',
      confirmButtonColor: '#dc2626',
      inputValidator: (value) =>
        value.trim().toUpperCase() === 'DELETE' ? null : 'Type DELETE to confirm',
    })
    if (isConfirmed) purgeSmartCollections.mutate()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <img src="/tunarr.svg" alt="Tunarr" className="w-5 h-5 rounded-xs" />
              Tunarr Integration
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {settings?.tunarr_url && (
                <span className="text-xs text-slate-500">{settings.tunarr_url}</span>
              )}
              {versionCheck?.version && (
                <span className="text-xs px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400 border border-slate-700">
                  v{versionCheck.version}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setShowGuide(true)}>
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
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => testTunarr.mutate(settings?.tunarr_url ?? '')}
              disabled={!settings?.tunarr_url}
              loading={testTunarr.isPending}
            >
              Test Connection
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setImportSelections({})
                importPreview.mutate(undefined)
                setShowImportModal(true)
              }}
              disabled={!settings?.tunarr_url}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Import
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setExportSelections({})
                setShowExportModal(true)
              }}
              disabled={!settings?.tunarr_url}
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              Export
            </Button>
          </div>
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => scanLibraries.mutate()}
                loading={scanLibraries.isPending}
              >
                {!scanLibraries.isPending && (
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
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => refreshGuide.mutate()}
                loading={refreshGuide.isPending}
              >
                {!refreshGuide.isPending && (
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
              </Button>
            </div>
          </div>

          {loadingChannels ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Spinner size="sm" />
              Loading channels…
            </div>
          ) : tunarrChannels.length === 0 ? (
            <EmptyState
              className="bg-slate-900 border border-slate-700 rounded-xl"
              title="No Tunarr channels found"
              description="Check your Tunarr connection in Settings"
            />
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
            <Button
              variant="dangerSoft"
              size="sm"
              onClick={() => void handlePurgeSmartCollections()}
              loading={purgeSmartCollections.isPending}
              disabled={smartCollections.length === 0 || purgeSmartCollections.isPending}
              title="Deletes every smart collection in Tunarr — including ones you made yourself"
            >
              Purge all Tunarr collections
            </Button>
          </div>
          <p className="text-xs text-slate-500 -mt-1 mb-3">
            Purging removes <span className="text-slate-400">every</span> smart collection in
            Tunarr, not only the ones Linearr synced. Plex collections are never touched.
          </p>

          {loadingCollections ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Spinner size="sm" />
              Loading…
            </div>
          ) : smartCollections.length === 0 ? (
            <EmptyState
              className="bg-slate-900 border border-slate-700 rounded-xl"
              title="No smart collections configured"
            />
          ) : (
            <div className="space-y-2">
              {smartCollections.map((sc) => (
                <SmartCollectionRow key={sc.uuid} collection={sc} />
              ))}
            </div>
          )}
        </section>

        {/* XMLTV / M3U */}
        <section>
          <h2 className="text-sm font-semibold text-slate-100 mb-3">XMLTV / M3U</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="/api/tunarr/xmltv"
              download="xmltv.xml"
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download XMLTV
            </a>
            <a
              href="/api/tunarr/m3u"
              download="channels.m3u"
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download M3U
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refreshXmltv.mutate()}
              loading={refreshXmltv.isPending}
            >
              Refresh Guide
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Use these URLs in Plex or Jellyfin as a DVR tuner source.
          </p>
        </section>

        {/* Active Sessions */}
        {tunarrSessions && Object.keys(tunarrSessions).length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-100 mb-3">Active Sessions</h2>
            <div className="space-y-2">
              {Object.entries(tunarrSessions).map(([channelId, sessions]) => (
                <div
                  key={channelId}
                  className="flex items-center justify-between px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
                >
                  <div>
                    <p className="text-sm text-slate-200">Channel {channelId}</p>
                    <p className="text-xs text-slate-500">
                      {Array.isArray(sessions) ? sessions.length : 1} active stream
                      {Array.isArray(sessions) && sessions.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <Button
                    variant="dangerSoft"
                    size="xs"
                    onClick={() => killSessions.mutate(channelId)}
                    disabled={killSessions.isPending}
                  >
                    Kill
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Filler Lists */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-100">
              Filler Lists
              {fillerLists.length > 0 && (
                <span className="ml-2 text-xs text-slate-500">({fillerLists.length})</span>
              )}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateFillerList}
              loading={createFillerList.isPending}
            >
              + New Filler List
            </Button>
          </div>
          {fillerLists.length === 0 ? (
            <EmptyState
              className="bg-slate-900 border border-slate-700 rounded-xl"
              title="No filler lists"
              description="Create one to add bumpers and interstitials."
            />
          ) : (
            <div className="space-y-2">
              {fillerLists.map((fl) => (
                <div
                  key={fl.id}
                  className="flex items-center justify-between px-4 py-3 bg-slate-900 border border-slate-700 rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-200">{fl.name}</p>
                    {fl.count != null && (
                      <p className="text-xs text-slate-500">
                        {fl.count} item{fl.count !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <IconButton
                    label={`Delete filler list "${fl.name}"`}
                    variant="danger"
                    onClick={() => handleDeleteFillerList(fl.id, fl.name)}
                    disabled={deleteFillerList.isPending}
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Import Modal */}
      <ModalWrapper
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        maxWidth="max-w-lg"
        titleId="tunarr-import-title"
      >
        <div className="flex flex-col max-h-[80vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
            <h2 id="tunarr-import-title" className="text-lg font-bold text-slate-100">
              Import Channels from Tunarr
            </h2>
            <IconButton label="Close" onClick={() => setShowImportModal(false)}>
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {importPreview.isPending ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : importPreview.data?.channels.length === 0 ? (
              <EmptyState title="No Tunarr channels found" />
            ) : (
              <div className="space-y-2">
                {(importPreview.data?.channels ?? []).map((ch) => (
                  <div
                    key={ch.tunarr_id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">
                        CH {ch.tunarr_number} — {ch.tunarr_name}
                      </p>
                      {ch.match === 'already_linked' && (
                        <p className="text-xs text-emerald-400">Already linked</p>
                      )}
                      {ch.match === 'number' && ch.cable_plex_channel && (
                        <p className="text-xs text-blue-400">
                          Matches Cable Plex CH {ch.cable_plex_channel.number} by number
                        </p>
                      )}
                      {ch.match === 'name' && ch.cable_plex_channel && (
                        <p className="text-xs text-blue-400">
                          Matches &quot;{ch.cable_plex_channel.name}&quot; by name
                        </p>
                      )}
                      {ch.match === null && (
                        <p className="text-xs text-amber-400">No match — will create new channel</p>
                      )}
                    </div>
                    {ch.match === 'already_linked' ? (
                      <span className="text-xs text-slate-500 shrink-0">Linked</span>
                    ) : (
                      <div className="w-40 shrink-0">
                        <Select
                          aria-label={`Import action for ${ch.tunarr_name}`}
                          value={importSelections[ch.tunarr_id] ?? (ch.match ? 'link' : 'create')}
                          onChange={(e) =>
                            setImportSelections((prev) => ({
                              ...prev,
                              [ch.tunarr_id]: e.target.value as 'link' | 'create' | 'skip',
                            }))
                          }
                        >
                          {ch.cable_plex_channel && (
                            <option value="link">Link to CH {ch.cable_plex_channel.number}</option>
                          )}
                          <option value="create">Create new</option>
                          <option value="skip">Skip</option>
                        </Select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-700 shrink-0">
            <span className="text-xs text-slate-500 mr-auto" aria-live="polite">
              {importSelectedCount} channel{importSelectedCount !== 1 ? 's' : ''} selected
            </span>
            <Button variant="ghost" onClick={() => setShowImportModal(false)}>
              Cancel
            </Button>
            <Button
              loading={importChannels.isPending}
              disabled={importSelectedCount === 0}
              onClick={() =>
                importChannels.mutate(importActions, {
                  onSuccess: () => setShowImportModal(false),
                })
              }
            >
              {importChannels.isPending ? 'Importing…' : 'Import Selected'}
            </Button>
          </div>
        </div>
      </ModalWrapper>

      {/* Export Modal */}
      <ModalWrapper
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        maxWidth="max-w-lg"
        titleId="tunarr-export-title"
      >
        <div className="flex flex-col max-h-[80vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
            <h2 id="tunarr-export-title" className="text-lg font-bold text-slate-100">
              Export Channels to Tunarr
            </h2>
            <IconButton label="Close" onClick={() => setShowExportModal(false)}>
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {cablePlexChannels.length === 0 ? (
              <EmptyState title="No Cable Plex channels" />
            ) : (
              <div className="space-y-2">
                {cablePlexChannels.map((ch) => {
                  const isLinked = links.some((l) => l.channel_number === ch.number)
                  return (
                    <label
                      key={ch.number}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${isLinked ? 'bg-slate-900/50 border-slate-700/50' : 'bg-slate-900 border-slate-700'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isLinked ? false : (exportSelections[ch.number] ?? true)}
                        disabled={isLinked}
                        onChange={(e) =>
                          setExportSelections((prev) => ({
                            ...prev,
                            [ch.number]: e.target.checked,
                          }))
                        }
                        className="rounded-sm border-slate-600 bg-slate-700 text-indigo-500 focus:ring-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium ${isLinked ? 'text-slate-500' : 'text-slate-200'}`}
                        >
                          CH {ch.number} — {ch.name}
                        </p>
                        {isLinked && (
                          <p className="text-xs text-emerald-500">Already linked to Tunarr</p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-700 shrink-0">
            <span className="text-xs text-slate-500 mr-auto" aria-live="polite">
              {exportableNumbers.length} channel{exportableNumbers.length !== 1 ? 's' : ''} selected
            </span>
            <Button variant="ghost" onClick={() => setShowExportModal(false)}>
              Cancel
            </Button>
            <Button
              loading={exportChannels.isPending}
              disabled={exportableNumbers.length === 0}
              onClick={() =>
                exportChannels.mutate(
                  { channelNumbers: exportableNumbers },
                  { onSuccess: () => setShowExportModal(false) },
                )
              }
            >
              {exportChannels.isPending ? 'Exporting…' : 'Export Selected'}
            </Button>
          </div>
        </div>
      </ModalWrapper>
    </div>
  )
}
