import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Field,
  IconButton,
  Input,
  ModalWrapper,
  Select,
  Spinner,
} from '@/shared/components/ui'
import { useUIStore } from '@/shared/store/ui.store'
import { usePlexCollections, usePlexLibraries, usePlexLibraryFilters } from '@/features/plex/hooks'
import {
  useCreateSmartCollectionForChannel,
  useUpdatePlexSmartCollection,
} from '@/features/collections/hooks'
import type { SmartCollectionFilters, SmartCollectionSort } from '@/shared/types'

const TYPE_LABEL: Record<'movie' | 'show', string> = { movie: 'Movies', show: 'Shows' }

const SORT_OPTIONS: Array<{ value: SmartCollectionSort; label: string }> = [
  { value: 'title_asc', label: 'Title (A–Z)' },
  { value: 'title_desc', label: 'Title (Z–A)' },
  { value: 'year_asc', label: 'Year (oldest first)' },
  { value: 'year_desc', label: 'Year (newest first)' },
  { value: 'added_desc', label: 'Recently added' },
  { value: 'random', label: 'Random' },
]

const DECADES = [1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

interface FormState {
  sectionId: string
  title: string
  genres: string[]
  yearMin: string
  yearMax: string
  decade: string
  unwatched: boolean
  contentRating: string
  titleContains: string
  sort: string
  limit: string
}

const EMPTY_FORM: FormState = {
  sectionId: '',
  title: '',
  genres: [],
  yearMin: '',
  yearMax: '',
  decade: '',
  unwatched: false,
  contentRating: '',
  titleContains: '',
  sort: '',
  limit: '',
}

/**
 * Build a Plex smart collection for a channel — or replace an already-assigned
 * smart collection's rules.
 *
 * Create mode creates the collection in Plex and assigns it to the channel in
 * one atomic backend call. Edit mode REPLACES the collection's rules: Plex
 * stores a smart collection as an opaque filter URI, so there is nothing to
 * pre-fill and the form starts blank by design.
 */
export function SmartCollectionBuilderModal() {
  const modals = useUIStore((s) => s.modals)
  const closeModal = useUIStore((s) => s.closeModal)
  const channelNumber = useUIStore((s) => s.collectionSlotChannel)
  const plexType = useUIStore((s) => s.collectionSlotType)
  const editTarget = useUIStore((s) => s.smartBuilderEdit)
  const open = modals.smartCollectionBuilder
  const isEdit = Boolean(editTarget)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: libraries = [], isLoading: loadingLibraries } = usePlexLibraries()
  const { data: allCollections = [] } = usePlexCollections()
  const createSmart = useCreateSmartCollectionForChannel()
  const updateSmart = useUpdatePlexSmartCollection()
  const pending = createSmart.isPending || updateSmart.isPending

  const sections = useMemo(
    () => libraries.filter((l) => l.type === plexType),
    [libraries, plexType],
  )

  // In edit mode the section is fixed by the collection itself — look it up
  // rather than letting the user move a collection between libraries.
  const editSectionId = useMemo(() => {
    if (!editTarget) return undefined
    return allCollections.find((c) => c.rating_key === editTarget.ratingKey)?.section_id
  }, [allCollections, editTarget])

  // Reset each time the modal opens, and seed sensible defaults.
  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm({
      ...EMPTY_FORM,
      title: editTarget?.title ?? '',
      sectionId: editSectionId ?? sections[0]?.id ?? '',
    })
    // Re-seeding on every `sections`/`editSectionId` change would stomp typing,
    // so this deliberately keys off `open` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Libraries/collections may arrive after the modal opens — fill the section
  // in once, without clobbering an explicit choice.
  useEffect(() => {
    if (!open || form.sectionId) return
    const next = editSectionId ?? sections[0]?.id
    if (next) setForm((f) => (f.sectionId ? f : { ...f, sectionId: next }))
  }, [open, form.sectionId, editSectionId, sections])

  const { data: libraryFilters, isLoading: loadingFilters } = usePlexLibraryFilters(form.sectionId)
  const genreOptions = libraryFilters?.genres ?? []
  const ratingOptions = libraryFilters?.content_ratings ?? []

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleGenre(genre: string) {
    setForm((f) => ({
      ...f,
      genres: f.genres.includes(genre) ? f.genres.filter((g) => g !== genre) : [...f.genres, genre],
    }))
  }

  function close() {
    closeModal('smartCollectionBuilder')
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    if (!form.sectionId) next.sectionId = 'Pick a Plex library'
    if (!isEdit && !form.title.trim()) next.title = 'Give the collection a name'

    const yearMin = form.yearMin ? Number(form.yearMin) : null
    const yearMax = form.yearMax ? Number(form.yearMax) : null
    if (form.yearMin && (!Number.isInteger(yearMin) || yearMin! < 1870 || yearMin! > 2200))
      next.yearMin = 'Enter a 4-digit year'
    if (form.yearMax && (!Number.isInteger(yearMax) || yearMax! < 1870 || yearMax! > 2200))
      next.yearMax = 'Enter a 4-digit year'
    if (!next.yearMin && !next.yearMax && yearMin !== null && yearMax !== null && yearMin > yearMax)
      next.yearMax = 'Must be on or after the earliest year'

    if (form.limit) {
      const limit = Number(form.limit)
      if (!Number.isInteger(limit) || limit < 1) next.limit = 'Enter a whole number of 1 or more'
    }
    return next
  }

  function buildFilters(): SmartCollectionFilters {
    return {
      genres: form.genres,
      year_min: form.yearMin ? Number(form.yearMin) : null,
      year_max: form.yearMax ? Number(form.yearMax) : null,
      decade: form.decade ? Number(form.decade) : null,
      unwatched: form.unwatched,
      content_rating: form.contentRating || null,
      title_contains: form.titleContains.trim() || null,
    }
  }

  const filters = buildFilters()
  const hasAnyFilter =
    filters.genres.length > 0 ||
    filters.year_min !== null ||
    filters.year_max !== null ||
    filters.decade !== null ||
    filters.unwatched ||
    filters.content_rating !== null ||
    filters.title_contains !== null

  function handleSubmit() {
    if (!plexType || !channelNumber) return
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const sort = (form.sort || null) as SmartCollectionSort | null
    const limit = form.limit ? Number(form.limit) : null

    if (isEdit && editTarget) {
      updateSmart.mutate(
        {
          ratingKey: editTarget.ratingKey,
          channelNumber,
          body: {
            section_id: form.sectionId,
            type: plexType,
            filters,
            sort,
            limit,
            title:
              form.title.trim() && form.title.trim() !== editTarget.title
                ? form.title.trim()
                : null,
          },
        },
        { onSuccess: close },
      )
      return
    }

    createSmart.mutate(
      {
        channelNumber,
        body: {
          section_id: form.sectionId,
          type: plexType,
          title: form.title.trim(),
          filters,
          sort,
          limit,
        },
      },
      { onSuccess: close },
    )
  }

  const noLibrary = !loadingLibraries && sections.length === 0

  return (
    <ModalWrapper open={open} onClose={close} maxWidth="max-w-2xl" titleId="smart-builder-title">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700">
        <div className="min-w-0">
          <h2 id="smart-builder-title" className="text-base font-semibold text-slate-100">
            {isEdit ? 'Edit smart collection filters' : 'New smart collection'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {plexType ? `${TYPE_LABEL[plexType]} slot` : 'Collection slot'}
            {channelNumber ? ` · channel ${channelNumber}` : ''} —{' '}
            {isEdit
              ? 'saving replaces this collection’s rules in Plex.'
              : 'created in Plex and assigned to this channel in one step.'}
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

      <div className="max-h-[28rem] overflow-y-auto px-5 py-4 space-y-4">
        {isEdit && (
          <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">
            Plex stores a smart collection&rsquo;s rules as an opaque filter, so the current ones
            can&rsquo;t be shown here. Whatever you set below <strong>replaces</strong> them
            entirely.
          </p>
        )}

        {noLibrary ? (
          <p className="text-sm text-slate-400">
            No {plexType ? TYPE_LABEL[plexType].toLowerCase() : ''} library found on Plex. Check
            your Plex connection in Settings.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Plex library" error={errors.sectionId}>
                <Select
                  value={form.sectionId}
                  invalid={Boolean(errors.sectionId)}
                  disabled={loadingLibraries || isEdit}
                  onChange={(e) => set('sectionId', e.target.value)}
                >
                  {loadingLibraries && <option value="">Loading…</option>}
                  {!loadingLibraries && !form.sectionId && (
                    <option value="">Select a library</option>
                  )}
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={isEdit ? 'Rename (optional)' : 'Collection name'}
                error={errors.title}
                hint={isEdit ? 'Leave unchanged to keep the current name' : undefined}
              >
                <Input
                  value={form.title}
                  invalid={Boolean(errors.title)}
                  placeholder="e.g. 80s Action Night"
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
            </div>

            {/* Genres */}
            <div>
              <p className="block text-xs font-medium text-slate-400 mb-1">
                Genres
                {form.genres.length > 0 && (
                  <span className="ml-1.5 text-slate-500">({form.genres.length} selected)</span>
                )}
              </p>
              {loadingFilters ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <Spinner size="sm" />
                  Loading genres…
                </div>
              ) : genreOptions.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  {form.sectionId
                    ? 'This library reports no genres.'
                    : 'Pick a library to list its genres.'}
                </p>
              ) : (
                <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5 bg-slate-900 border border-slate-700 rounded-lg p-2">
                  {genreOptions.map((g) => {
                    const active = form.genres.includes(g)
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleGenre(g)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          active
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {g}
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Matches any of the selected genres. Genres missing from the library are ignored.
              </p>
            </div>

            {/* Year / decade */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Year from" error={errors.yearMin} hint="Inclusive">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.yearMin}
                  invalid={Boolean(errors.yearMin)}
                  placeholder="1980"
                  onChange={(e) => set('yearMin', e.target.value)}
                />
              </Field>
              <Field label="Year to" error={errors.yearMax} hint="Inclusive">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.yearMax}
                  invalid={Boolean(errors.yearMax)}
                  placeholder="1989"
                  onChange={(e) => set('yearMax', e.target.value)}
                />
              </Field>
              <Field label="Decade">
                <Select value={form.decade} onChange={(e) => set('decade', e.target.value)}>
                  <option value="">Any</option>
                  {DECADES.map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Rating / title contains */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Content rating">
                <Select
                  value={form.contentRating}
                  onChange={(e) => set('contentRating', e.target.value)}
                >
                  <option value="">Any</option>
                  {ratingOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title contains">
                <Input
                  value={form.titleContains}
                  placeholder="e.g. Star"
                  onChange={(e) => set('titleContains', e.target.value)}
                />
              </Field>
            </div>

            {/* Sort / limit / unwatched */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Sort">
                <Select value={form.sort} onChange={(e) => set('sort', e.target.value)}>
                  <option value="">Plex default</option>
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Limit" error={errors.limit} hint="Max items — blank for no limit">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.limit}
                  invalid={Boolean(errors.limit)}
                  placeholder="e.g. 50"
                  onChange={(e) => set('limit', e.target.value)}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.unwatched}
                onChange={(e) => set('unwatched', e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
              />
              Unwatched only
            </label>

            {!hasAnyFilter && (
              <p className="text-xs text-slate-500">
                No filters set — the collection will match the entire library.
              </p>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700">
        <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          loading={pending}
          disabled={pending || noLibrary || !channelNumber || !plexType}
        >
          {isEdit ? 'Replace filters' : 'Create + assign'}
        </Button>
      </div>
    </ModalWrapper>
  )
}
