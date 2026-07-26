import { useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  ModalWrapper,
  Spinner,
} from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { usePlexCollections } from '@/features/plex/hooks'
import { PlexThumb } from '@/features/plex/components/PlexThumb'
import { useAssignCollection, useChannelCollections } from '@/features/collections/hooks'

const TYPE_LABEL: Record<'movie' | 'show', string> = { movie: 'Movies', show: 'Shows' }

/**
 * Pick a pre-existing Plex collection to hold a channel's movie/show slot.
 *
 * Assigning is REFERENCE ONLY — it records that the channel uses the
 * collection. Linearr never adds to, prunes, or renames it.
 */
export function AssignCollectionModal() {
  const modals = useUIStore((s) => s.modals)
  const closeModal = useUIStore((s) => s.closeModal)
  const channelNumber = useUIStore((s) => s.collectionSlotChannel)
  const plexType = useUIStore((s) => s.collectionSlotType)
  const open = modals.assignCollection

  const [search, setSearch] = useState('')

  const { data: collections = [], isLoading, isError, error } = usePlexCollections()
  const { data: channelCollections } = useChannelCollections(channelNumber ?? 0)
  const assign = useAssignCollection()

  const current = plexType ? channelCollections?.[plexType] : undefined
  const currentKey = current?.source === 'assigned' ? current.collection_rating_key : undefined

  const ofType = useMemo(
    () => collections.filter((c) => c.type === plexType),
    [collections, plexType],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? ofType.filter((c) => c.title.toLowerCase().includes(q)) : ofType
    return [...list].sort((a, b) => a.title.localeCompare(b.title))
  }, [ofType, search])

  function close() {
    setSearch('')
    closeModal('assignCollection')
  }

  function handleAssign(collection: (typeof collections)[number]) {
    if (!channelNumber || !plexType) return
    assign.mutate(
      {
        channelNumber,
        body: {
          plex_type: plexType,
          collection_rating_key: collection.rating_key,
          collection_title: collection.title,
          is_smart: Boolean(collection.smart),
        },
      },
      { onSuccess: close },
    )
  }

  return (
    <ModalWrapper
      open={open}
      onClose={close}
      maxWidth="max-w-2xl"
      titleId="assign-collection-title"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700">
        <div className="min-w-0">
          <h2 id="assign-collection-title" className="text-base font-semibold text-slate-100">
            Assign an existing collection
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {plexType ? `${TYPE_LABEL[plexType]} slot` : 'Collection slot'}
            {channelNumber ? ` · channel ${channelNumber}` : ''} — Linearr will reference this
            collection and never change its contents.
          </p>
        </div>
        <IconButton label="Close" onClick={close}>
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

      {/* Search */}
      <div className="px-5 py-3 border-b border-slate-800">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${plexType ? TYPE_LABEL[plexType].toLowerCase() : ''} collections…`}
          aria-label="Search collections"
          autoFocus
        />
      </div>

      {/* List */}
      <div className="max-h-[26rem] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        ) : isError ? (
          <EmptyState
            title="Could not load Plex collections"
            description={error instanceof Error ? error.message : 'Check your Plex settings.'}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              search
                ? 'No collections match your search'
                : `No ${plexType ? TYPE_LABEL[plexType].toLowerCase() : ''} collections in Plex`
            }
            description={
              search
                ? 'Try a different search term.'
                : 'Create one in Plex, or use “New smart collection…” to build a rule-based collection here.'
            }
          />
        ) : (
          <ul className="divide-y divide-slate-800">
            {filtered.map((c) => {
              const isCurrent = c.rating_key === currentKey
              return (
                <li
                  key={c.rating_key}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-800/50 transition-colors"
                >
                  <div className="w-9 h-14 shrink-0 rounded overflow-hidden bg-slate-800">
                    <PlexThumb
                      path={c.thumb}
                      alt=""
                      w={72}
                      h={108}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-slate-200 truncate">{c.title}</p>
                      {c.smart && (
                        <span
                          title="Rule-based collection — Plex keeps it current automatically"
                          className="shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-cyan-900/40 border border-cyan-700/60 text-cyan-300"
                        >
                          smart
                        </span>
                      )}
                      {isCurrent && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/60 text-emerald-300">
                          current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {c.child_count} item{c.child_count !== 1 ? 's' : ''}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant={isCurrent ? 'secondary' : 'primary'}
                    className="shrink-0"
                    disabled={assign.isPending || isCurrent}
                    loading={
                      assign.isPending &&
                      assign.variables?.body.collection_rating_key === c.rating_key
                    }
                    onClick={() => handleAssign(c)}
                  >
                    {isCurrent ? 'Assigned' : 'Assign'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-700">
        <p className="text-xs text-slate-500">
          Assigning replaces whatever holds this slot. Building collections switches it back to
          Linearr&rsquo;s own collection.
        </p>
        <Button variant="secondary" size="sm" onClick={close} className="shrink-0">
          Cancel
        </Button>
      </div>
    </ModalWrapper>
  )
}
