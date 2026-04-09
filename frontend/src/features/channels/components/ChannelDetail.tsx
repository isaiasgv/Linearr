import { useUIStore, type ActiveChannelTab } from '@/shared/store/ui.store'
import { useDeleteChannel } from '@/features/channels/hooks'
import { useChannelAssignments } from '@/features/assignments/hooks'
import { useTunarrLinks } from '@/features/tunarr/hooks'
import { TierBadge, tierColor } from '@/shared/components/ui/TierBadge'
import { ContentTab } from '@/features/content/components/ContentTab'
import { BlocksTab } from '@/features/blocks/components/BlocksTab'
import { TunarrTab } from '@/features/tunarr/components/TunarrTab'
import type { Channel } from '@/shared/types'

const TABS: { label: string; value: ActiveChannelTab }[] = [
  { label: 'Content', value: 'content' },
  { label: 'Blocks', value: 'blocks' },
  { label: 'Tunarr', value: 'tunarr' },
]

function tierNumberBg(tier: Channel['tier']): string {
  switch (tier) {
    case 'Galaxy Main':
      return 'bg-blue-700 text-blue-100'
    case 'Classics':
      return 'bg-purple-700 text-purple-100'
    case 'Galaxy Premium':
      return 'bg-amber-700 text-amber-100'
  }
}

export function ChannelDetail() {
  const { selectedChannel, activeChannelTab, setActiveChannelTab, openModal, selectChannel } =
    useUIStore()
  const deleteChannel = useDeleteChannel()
  const { data: assignments = [] } = useChannelAssignments(selectedChannel?.number ?? 0)
  const { data: tunarrLinks = [] } = useTunarrLinks()

  if (!selectedChannel) return null

  const ch = selectedChannel
  const tunarrLink = tunarrLinks.find((l) => l.channel_number === ch.number)

  function handleDelete() {
    if (!confirm(`Delete channel ${ch.number} – ${ch.name}? This cannot be undone.`)) return
    deleteChannel.mutate(ch.number, {
      onSuccess: () => selectChannel(null),
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`flex-shrink-0 w-10 h-10 rounded-xl text-sm font-bold flex items-center justify-center ${tierNumberBg(ch.tier)}`}
            >
              {ch.number}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-slate-100 truncate">{ch.name}</h2>
                <TierBadge tier={ch.tier} />
                {tunarrLink && (
                  <span className="text-xs px-2 py-0.5 rounded border bg-emerald-900/40 text-emerald-300 border-emerald-700">
                    Tunarr #{tunarrLink.tunarr_number ?? '?'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                <span
                  className={`text-xs font-medium border rounded px-1.5 py-0.5 mr-2 ${tierColor(ch.tier)}`}
                >
                  {assignments.length} assigned
                </span>
                {ch.vibe && <span className="italic">{ch.vibe}</span>}
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 flex items-center gap-2">
            {ch.icon && (
              <img
                src={ch.icon}
                alt=""
                className="w-8 h-8 rounded-lg object-cover border border-slate-700"
              />
            )}
            <button
              onClick={() => openModal('iconEditor')}
              className="px-3 py-1.5 text-xs bg-purple-900/40 hover:bg-purple-900/60 border border-purple-800 text-purple-300 rounded-lg transition-colors"
            >
              {ch.icon ? 'Edit Icon' : 'Add Icon'}
            </button>
            <button
              onClick={() => openModal('channelForm', { editingChannel: ch })}
              className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteChannel.isPending}
              className="px-3 py-1.5 text-xs bg-red-900/40 hover:bg-red-900/70 border border-red-800 hover:border-red-700 text-red-400 hover:text-red-300 rounded-lg transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex gap-1 mt-4">
          {TABS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setActiveChannelTab(value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeChannelTab === value
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeChannelTab === 'content' && <ContentTab channelNumber={ch.number} />}
        {activeChannelTab === 'blocks' && <BlocksTab channelNumber={ch.number} />}
        {activeChannelTab === 'tunarr' && <TunarrTab channelNumber={ch.number} />}
      </div>
    </div>
  )
}
