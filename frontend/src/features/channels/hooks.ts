import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import Swal from 'sweetalert2'
import { channelsApi } from './api'
import type { Channel } from '@/shared/types'
import type { ChannelReorderChange, ChannelReorderRequest, ChannelReorderResult } from './types'
import { useToastStore } from '@/shared/store/toast.store'
import { useUIStore } from '@/shared/store/ui.store'

/**
 * Every cached key a renumber can invalidate. `channels.number` is the primary
 * key and six tables reference it *by value*, so when a channel's number
 * changes, anything keyed by channel number is stale.
 */
const RENUMBER_DEPENDENT_KEYS: readonly (readonly string[])[] = [
  ['assignments'],
  ['blocks'],
  ['channel-collections'],
  ['collection-status'],
  ['tunarr', 'links'],
  ['tunarr', 'collection-links'],
  ['watermark'],
]

function invalidateRenumberDependents(qc: QueryClient): void {
  for (const queryKey of RENUMBER_DEPENDENT_KEYS) {
    void qc.invalidateQueries({ queryKey })
  }
}

/**
 * Keep `selectedChannel` pointing at the same *channel* after a renumber, not
 * at whatever now holds its old number. Written through `setState` rather than
 * `selectChannel` so it does not also flip the active view / close the drawer.
 *
 * A channel whose number is absent from `changed` kept its number, and numbers
 * are unique post-commit, so re-looking-it-up by number is safe.
 */
function syncSelectedChannel(changed: readonly ChannelReorderChange[], channels: Channel[]): void {
  const selected = useUIStore.getState().selectedChannel
  if (!selected) return
  const moved = changed.find((c) => c.old_number === selected.number)
  const next = channels.find((c) => c.number === (moved ? moved.new_number : selected.number))
  if (next) useUIStore.setState({ selectedChannel: next })
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/**
 * Report Tunarr propagation outcome. The local reorder already committed, so
 * nothing here may read as "the reorder failed".
 *
 * A `parked` failure means the Tunarr channel is sitting on a **temporary
 * number** — visible breakage until someone fixes it — so it gets a persistent
 * modal, not a 4-second toast. (Only one Swal instance can be on screen, so
 * when the modal fires it also carries the "reorder was saved" line instead of
 * being raced by a toast.)
 */
function reportReorderOutcome(
  result: ChannelReorderResult,
  summary: string,
  addToast: (message: string, isError?: boolean) => void,
): void {
  const parked = result.tunarr.failed.filter((f) => f.state === 'parked')
  const unchanged = result.tunarr.failed.filter((f) => f.state !== 'parked')

  if (parked.length > 0) {
    const items = parked
      .map(
        (f) =>
          `<li><b>Channel ${f.number}</b> is parked on temporary number <b>${
            f.parked_number ?? '?'
          }</b><br/><span style="font-size:0.85em;opacity:0.8">${escapeHtml(f.message)}</span></li>`,
      )
      .join('')
    void Swal.fire({
      icon: 'warning',
      title:
        parked.length === 1
          ? 'A Tunarr channel is stranded on a temporary number'
          : `${parked.length} Tunarr channels are stranded on temporary numbers`,
      html:
        `<p style="text-align:left">${escapeHtml(summary)} — the Linearr lineup is correct.</p>` +
        `<p style="text-align:left">But Tunarr did not finish renumbering, so these channels are ` +
        `currently on placeholder numbers and will show up wrong in your guide until fixed:</p>` +
        `<ul style="text-align:left">${items}</ul>` +
        `<p style="text-align:left">Re-run the reorder, or set the number directly in Tunarr.</p>`,
      background: '#1e293b',
      color: '#e2e8f0',
      confirmButtonColor: '#4f46e5',
      confirmButtonText: 'Got it',
    })
  } else {
    addToast(summary)
  }

  if (unchanged.length > 0) {
    const numbers = unchanged.map((f) => f.number).join(', ')
    addToast(
      `Reorder saved. Tunarr kept the old number for channel${
        unchanged.length === 1 ? '' : 's'
      } ${numbers}: ${unchanged[0].message}`,
      true,
    )
  }
}

export function useChannels(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['channels'],
    queryFn: channelsApi.list,
    enabled: options?.enabled !== false,
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (data: Partial<Channel>) => channelsApi.create(data),
    onSuccess: (ch) => {
      qc.setQueryData<Channel[]>(['channels'], (old = []) =>
        [...old, ch].sort((a, b) => a.number - b.number),
      )
      addToast(`Channel ${ch.number} created`)
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ number, data }: { number: number; data: Partial<Channel> }) =>
      channelsApi.update(number, data),
    onSuccess: (updated, vars) => {
      // The channel number is the primary key and CAN change here (a direct
      // renumber from the edit form), so the old row is found by the number
      // that was submitted (`vars.number`), not by the returned one — matching
      // on `updated.number` dropped the row entirely whenever it changed. Then
      // re-sort, because a renumber can move the row in the lineup.
      qc.setQueryData<Channel[]>(['channels'], (old = []) =>
        [
          ...old.filter((c) => c.number !== vars.number && c.number !== updated.number),
          updated,
        ].sort((a, b) => a.number - b.number),
      )
      if (vars.number !== updated.number) {
        const changed: ChannelReorderChange[] = [
          { old_number: vars.number, new_number: updated.number, tier: updated.tier },
        ]
        syncSelectedChannel(changed, qc.getQueryData<Channel[]>(['channels']) ?? [updated])
        invalidateRenumberDependents(qc)
        addToast(`Channel ${vars.number} renumbered to ${updated.number}`)
        return
      }
      addToast(`Channel ${updated.number} updated`)
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}

/**
 * Drag-to-reorder. The endpoint is transactional and returns the authoritative
 * new lineup, so the `['channels']` cache is replaced wholesale rather than
 * patched — the numbers of several rows change at once and there is nothing
 * stable to patch against.
 */
export function useReorderChannels() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: ChannelReorderRequest) => channelsApi.reorder(body),
    onSuccess: (result, vars) => {
      if (result.changed.length === 0) return
      qc.setQueryData<Channel[]>(['channels'], result.channels)
      syncSelectedChannel(result.changed, result.channels)
      invalidateRenumberDependents(qc)

      const moved = result.changed.find((c) => c.old_number === vars.moved_number)
      const others = result.changed.length - 1
      const summary = moved
        ? `Channel ${moved.old_number} → ${moved.new_number}${
            others > 0 ? ` (${others} other${others === 1 ? '' : 's'} renumbered)` : ''
          }`
        : `${result.changed.length} channels renumbered`
      reportReorderOutcome(result, summary, addToast)
    },
    onError: (err: Error) => addToast(err.message, true),
    onSettled: () => useUIStore.getState().clearChannelDrag(),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (number: number) => channelsApi.remove(number),
    onSuccess: (res, number) => {
      qc.setQueryData<Channel[]>(['channels'], (old = []) => old.filter((c) => c.number !== number))
      qc.removeQueries({ queryKey: ['blocks', number] })
      qc.removeQueries({ queryKey: ['channel-collections', number] })
      qc.removeQueries({ queryKey: ['collection-status', number] })
      qc.removeQueries({ queryKey: ['watermark', number] })
      void qc.invalidateQueries({ queryKey: ['assignments'] })
      // The delete cascades into Tunarr now, so both the link list and Tunarr's
      // own channel list are stale.
      void qc.invalidateQueries({ queryKey: ['tunarr', 'links'] })
      void qc.invalidateQueries({ queryKey: ['tunarr', 'channels'] })
      // Linearr's delete already committed — a Tunarr failure leaves a stranded
      // channel there, which is worth saying out loud rather than swallowing.
      if (res?.tunarr && !res.tunarr.deleted) {
        addToast(
          `Channel deleted, but the Tunarr channel could not be removed: ${res.tunarr.message ?? 'unknown error'}`,
          true,
        )
      } else {
        addToast(
          res?.tunarr?.deleted ? 'Channel deleted from Linearr and Tunarr' : 'Channel deleted',
        )
      }
    },
    onError: (err: Error) => addToast(err.message, true),
  })
}
