import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/shared/components/ui'
import { PlexBrowser } from '@/features/plex/components/PlexBrowser'
import { useBulkAssign } from '@/features/assignments/hooks'
import { toBulkAssignItem } from '@/features/assignments/utils'
import type { PlexItem } from '@/shared/types'

interface AddContentPanelProps {
  /** Channel the "Add N items" action targets. */
  channelNumber: number
  /** Rendered at the left of the sticky footer (e.g. a target-channel picker). */
  footerLead?: ReactNode
  /** Extra hint shown when nothing is selected yet. */
  hint?: string
  className?: string
}

/**
 * Browse Plex, multi-select, add the whole selection to one channel in a
 * single bulk call. Shared by the add-content modal and the Cable Plex tray,
 * so selection + add exist in exactly one place.
 *
 * Selection is owned here and handed to PosterGrid (through PlexBrowser) via
 * its optional `selectedKeys` / `onToggleSelect` props — the same primitive
 * that makes the posters drag sources.
 */
export function AddContentPanel({
  channelNumber,
  footerLead,
  hint = 'Click posters to select them, then add them all at once.',
  className = '',
}: AddContentPanelProps) {
  // Keyed by rating_key so a selection survives changing search/library —
  // the item objects have to be kept, not just the keys, because the browsed
  // list they came from may no longer contain them at add time.
  const [selected, setSelected] = useState<Map<string, PlexItem>>(() => new Map())
  const bulkAssign = useBulkAssign()

  const selectedKeys = useMemo(() => new Set(selected.keys()), [selected])

  const handleToggle = useCallback((item: PlexItem) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.rating_key)) next.delete(item.rating_key)
      else next.set(item.rating_key, item)
      return next
    })
  }, [])

  const count = selected.size

  function handleAdd() {
    if (count === 0) return
    bulkAssign.mutate(
      {
        channelNumber,
        items: Array.from(selected.values()).map(toBulkAssignItem),
      },
      // useBulkAssign already invalidates ['assignments'] and toasts the
      // added/skipped counts — clearing the selection is all that's left.
      { onSuccess: () => setSelected(new Map()) },
    )
  }

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PlexBrowser
          channelNumber={channelNumber}
          selectedKeys={selectedKeys}
          onToggleSelect={handleToggle}
        />
      </div>

      {/* Sticky footer — selection count + one bulk add */}
      <div className="shrink-0 border-t border-slate-700 bg-slate-900/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        {footerLead}
        <p className="text-xs text-slate-400 flex-1 min-w-32">
          {count === 0 ? (
            hint
          ) : (
            <>
              <span className="text-slate-100 font-semibold">{count}</span>
              {` item${count === 1 ? '' : 's'} selected`}
            </>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelected(new Map())}
          disabled={count === 0}
        >
          Clear
        </Button>
        <Button size="sm" onClick={handleAdd} disabled={count === 0} loading={bulkAssign.isPending}>
          {count === 0 ? 'Add items' : `Add ${count} item${count === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}
