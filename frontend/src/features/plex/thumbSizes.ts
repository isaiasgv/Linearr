/**
 * The canonical thumbnail request sizes.
 *
 * `/api/plex/thumb` caches on `(path, w, h)`, and so do the two layers in front
 * of it (the service worker's `linearr-thumbs` cache and the browser cache). A
 * bespoke size per rendered dimension therefore FORKS the cache: each variant is
 * its own key everywhere, so a size control re-downloads the whole visible grid
 * on every toggle, nothing is shared between views, and a large library spread
 * across several variants overflows the backend's 1500-entry LRU.
 *
 * So there are deliberately only TWO sizes, and every `PlexThumb` call site uses
 * one of them. Pick the nearest — over-fetching slightly is free next to a cache
 * miss, since these are 10-30 KB transcodes. Adding a third needs a very good
 * reason. See the performance invariants in CLAUDE.md.
 */

export interface ThumbSize {
  readonly w: number
  readonly h: number
}

/**
 * Poster grids and detail art — the `PlexThumb` default, and the backend's own
 * default. Every full-size poster surface in the app requests this, so a poster
 * fetched in any one view is already warm for all the others.
 */
export const THUMB_POSTER: ThumbSize = { w: 240, h: 360 }

/**
 * Dense rows, strips and collages — anything rendering at roughly 60 CSS px wide
 * or less, where 240x360 is wasted bytes.
 */
export const THUMB_DENSE: ThumbSize = { w: 120, h: 180 }
