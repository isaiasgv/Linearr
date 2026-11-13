/**
 * The Tunarr channel grid, plus import/export.
 *
 * Extracted verbatim from `TunarrView`. Adds a search box and a linked/unlinked
 * filter, which the flat grid needed once a lineup passed a couple of dozen
 * channels — there was no way to find one but to scroll.
 */
import { useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ModalWrapper,
  Select,
  Spinner,
} from '@/shared/components/ui'
import {
  useTunarrChannels,
  useTunarrLinks,
  useTunarrSchedule,
  useTunarrTasks,
  useImportPreview,
  useImportChannels,
  useExportChannels,
} from '@/features/tunarr/hooks'
import { useChannels } from '@/features/channels/hooks'
import { channelKey } from '@/features/channels/utils'
import { describeProgram, findNowPlaying } from '@/features/tunarr/nowPlaying'
import type { TunarrScheduleItem } from '@/shared/types'

function nowPlaying(schedule: TunarrScheduleItem[] | undefined): string | null {
  const playing = findNowPlaying(schedule, Date.now())
  return playing ? describeProgram(playing.current) : null
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

export function ChannelsPanel() {
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  // Import modal: tunarr_id → chosen action (defaults derived from the preview match)
  const [importSelections, setImportSelections] = useState<
    Record<string, 'link' | 'create' | 'skip'>
  >({})
  // Export modal: channel number → checked (unlinked channels default to checked)
  const [exportSelections, setExportSelections] = useState<Record<number, boolean>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'linked' | 'unlinked'>('all')

  const { data: tunarrChannels = [], isLoading: loadingChannels } = useTunarrChannels()
  const { data: links = [] } = useTunarrLinks()
  const { data: cablePlexChannels = [] } = useChannels()
  const { refreshGuide, scanLibraries } = useTunarrTasks()
  const importPreview = useImportPreview()
  const importChannels = useImportChannels()
  const exportChannels = useExportChannels()

  // Build a map from tunarr_id → Galaxy channel name for display
  const tunarrIdToGalaxy = Object.fromEntries(
    links.map((l) => [l.tunarr_id, `CH ${l.channel_number}${l.tunarr_name ? '' : ''}`]),
  )

  const visibleChannels = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tunarrChannels.filter((tc) => {
      if (q && !`${tc.number} ${tc.name}`.toLowerCase().includes(q)) return false
      if (filter === 'all') return true
      const linked = Boolean(tunarrIdToGalaxy[tc.id])
      return filter === 'linked' ? linked : !linked
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunarrChannels, search, filter, links])

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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-100">
          Tunarr Channels
          <span className="ml-2 text-xs text-slate-500">
            {visibleChannels.length === tunarrChannels.length
              ? `(${tunarrChannels.length})`
              : `(${visibleChannels.length} of ${tunarrChannels.length})`}
          </span>
        </h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels…"
              aria-label="Search Tunarr channels"
            />
          </div>
          <div className="flex rounded-lg bg-slate-900 p-0.5">
            {(['all', 'linked', 'unlinked'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                  filter === f ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => scanLibraries.mutate()}
            loading={scanLibraries.isPending}
          >
            Scan Libraries
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshGuide.mutate()}
            loading={refreshGuide.isPending}
          >
            Refresh Guide
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setImportSelections({})
              importPreview.mutate(undefined)
              setShowImportModal(true)
            }}
          >
            Import
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setExportSelections({})
              setShowExportModal(true)
            }}
          >
            Export
          </Button>
        </div>
      </div>

      {loadingChannels ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
          <Spinner size="sm" />
          Loading channels…
        </div>
      ) : tunarrChannels.length === 0 ? (
        <EmptyState
          className="rounded-xl border border-slate-700 bg-slate-900"
          title="No Tunarr channels found"
          description="Check your Tunarr connection in Settings"
        />
      ) : visibleChannels.length === 0 ? (
        <EmptyState
          className="rounded-xl border border-slate-700 bg-slate-900"
          title="No channels match"
          description="Try a different search or filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleChannels.map((tc) => (
            <TunarrChannelCard
              key={tc.id}
              channel={tc}
              linkedGalaxyName={tunarrIdToGalaxy[tc.id]}
            />
          ))}
        </div>
      )}
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
                      key={channelKey(ch)}
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
