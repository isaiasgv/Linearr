/**
 * Smart collections + filler lists — the Tunarr-side content objects.
 *
 * Extracted verbatim from `TunarrView`, which had grown to 1,276 lines with six
 * unrelated sections stacked in one scroll. Behaviour is unchanged.
 */
import Swal from 'sweetalert2'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Spinner,
  confirmDialog,
} from '@/shared/components/ui'
import {
  useTunarrSmartCollections,
  useUpdateSmartCollection,
  useDeleteSmartCollection,
  usePurgeTunarrSmartCollections,
  useTunarrFillerLists,
  useCreateFillerList,
  useDeleteFillerList,
} from '@/features/tunarr/hooks'
import { useId, useState } from 'react'
import type { SmartCollection } from '@/shared/types'

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

export function CollectionsPanel() {
  const { data: smartCollections = [], isLoading: loadingCollections } = useTunarrSmartCollections()
  const purgeSmartCollections = usePurgeTunarrSmartCollections()
  const { data: fillerLists = [] } = useTunarrFillerLists()
  const createFillerList = useCreateFillerList()
  const deleteFillerList = useDeleteFillerList()

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
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
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
        <p className="-mt-1 mb-3 text-xs text-slate-500">
          Purging removes <span className="text-slate-400">every</span> smart collection in Tunarr,
          not only the ones Linearr synced. Plex collections are never touched.
        </p>

        {loadingCollections ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
            <Spinner size="sm" />
            Loading…
          </div>
        ) : smartCollections.length === 0 ? (
          <EmptyState
            className="rounded-xl border border-slate-700 bg-slate-900"
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

      <section>
        <div className="mb-3 flex items-center justify-between">
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
            className="rounded-xl border border-slate-700 bg-slate-900"
            title="No filler lists"
            description="Create one to add bumpers and interstitials."
          />
        ) : (
          <div className="space-y-2">
            {fillerLists.map((fl) => (
              <div
                key={fl.id}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-4 py-3"
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
                    className="h-4 w-4"
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
  )
}
