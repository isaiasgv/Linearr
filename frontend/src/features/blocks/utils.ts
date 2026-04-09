import type { Block, BlockSlot } from '@/shared/types'

/** Convert "HH:MM" to 12-hour "H:MM AM/PM" */
export function to12h(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${period}`
}

/** Return array of "HH:00" strings for every hour in block, handles midnight spans */
export function hoursInBlock(block: Block): string[] {
  const [startH] = block.start_time.split(':').map(Number)
  const [endH] = block.end_time.split(':').map(Number)

  const hours: string[] = []
  let h = startH

  // Handle same start/end as full 24h
  if (startH === endH) {
    for (let i = 0; i < 24; i++) {
      hours.push(`${String((startH + i) % 24).padStart(2, '0')}:00`)
    }
    return hours
  }

  while (true) {
    hours.push(`${String(h).padStart(2, '0')}:00`)
    h = (h + 1) % 24
    if (h === endH) break
  }
  return hours
}

type HourState =
  | { type: 'empty' }
  | { type: 'start'; slot: BlockSlot }
  | { type: 'continuation'; slot: BlockSlot }

/** Determine how a given hour is filled by slots */
export function getHourState(slots: BlockSlot[], hour: string): HourState {
  for (const slot of slots) {
    if (slot.slot_time === hour) {
      return { type: 'start', slot }
    }
    // Check if this slot's duration covers this hour
    const [slotH] = slot.slot_time.split(':').map(Number)
    const [hourH] = hour.split(':').map(Number)
    const slotsHours = Math.ceil(slot.duration_minutes / 60)
    for (let i = 1; i < slotsHours; i++) {
      if ((slotH + i) % 24 === hourH) {
        return { type: 'continuation', slot }
      }
    }
  }
  return { type: 'empty' }
}

/** Returns {covered, total} hour counts, or null if slots not loaded */
export function blockFillHours(block: Block, slots: BlockSlot[] | undefined) {
  if (!slots) return null
  const hours = hoursInBlock(block)
  let covered = 0
  for (const h of hours) {
    const state = getHourState(slots, h)
    if (state.type !== 'empty') covered++
  }
  return { covered, total: hours.length }
}

/** Tailwind border-l color class based on start hour */
export function blockTimeColor(startTime: string): string {
  const h = parseInt(startTime.split(':')[0], 10)
  if (h >= 5 && h < 12) return 'border-l-yellow-500'
  if (h >= 12 && h < 17) return 'border-l-blue-500'
  if (h >= 17 && h < 21) return 'border-l-orange-500'
  return 'border-l-purple-500'
}

/** Convert duration minutes to "Xh Ym" */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
