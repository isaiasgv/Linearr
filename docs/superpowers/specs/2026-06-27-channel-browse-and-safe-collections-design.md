# Design: Denser Browse view + safe channel collections

Date: 2026-06-27
Status: Approved (pending written-spec review)

## Goal

Make picking content for a channel faster and safer:

1. **See more at a glance** — redesign the Browse view for density, with three
   switchable layouts.
2. **Add content at any granularity** — individual movies, individual shows, or a
   whole existing Plex collection (with a preview before adding).
3. **Never damage the user's own collections** — Linearr manages its *own*
   per-channel collections and syncs those to Plex + Tunarr; it never adds to or
   removes from a collection the user made by hand.

This last point is the headline. A previous version stripped the user's real
"Movies" collection down to a handful of items because the same physical Plex
collection was used both as a *source* (browse from) and as the *managed target*
(overwrite on generate). This design splits those two roles permanently.

## Background (current behavior)

- Browse UI: `ContentTab` → `PlexBrowser` → `PosterGrid`.
  - `PlexBrowser` (`frontend/src/features/plex/components/PlexBrowser.tsx`) renders
    several stacked control rows: library select + Browse button, search, type
    tabs, grid/list toggle, S/M/L size, and a row of genre/year/rating dropdowns.
  - `PosterGrid` (`.../PosterGrid.tsx`) renders grid (poster + title + year + type)
    or list, with column counts driven by `posterSize`.
  - Assignment is one item at a time via `useAssign`/`useUnassign` →
    `POST/DELETE /api/assignments`.
- Collections:
  - `CollectionPickerModal` → `useLinkCollection` → `POST /api/channel-collections/{n}`.
    This **both** writes a `channel_collections` row (the managed target) **and**
    bulk-inserts all the collection's items into `assignments`. This conflation is
    the root cause of the purge.
  - `POST /api/collections/generate/{n}` (`main.py` ~1800–2021) resolves a target
    collection (a user-linked one if present, else find/create `{Channel} {Movies|TV}`),
    then computes `to_add = desired − current` and `to_remove = current − desired`
    and **DELETEs `to_remove` from the Plex collection** (main.py ~1933–1943).
    When the target was the user's real collection, `to_remove` was huge.
  - Tunarr sync mirrors `channel_collections` rows into Tunarr smart collections.

## Decisions (from brainstorming)

- Browse density: ship **all three** view modes as switchable: **Poster wall**
  (covers only), **Dense list** (thin rows), **Slim grid + labels**.
- Collection-as-source: **preview** — load the collection's items into the grid,
  then "Add all" or cherry-pick. Source collection is read-only.
- Safety model: **Linearr-owned dedicated collection per channel + type.** Linearr
  only ever mutates its own `{Channel} Movies` / `{Channel} TV` collections.

## Design

### Component 1 — Browse view density (frontend only)

**`PlexBrowser.tsx`**
- Collapse all controls into a single **sticky toolbar row**: source selector,
  search, type filter, view-mode selector, size. Move genre/year/content-rating
  into a **"Filters" popover/dropdown** (badge shows active filter count) so they
  no longer consume a permanent row.
- Add a **source selector**: `Library ▾` | `Collection ▾`. Choosing a Library
  behaves as today; choosing a Collection switches the grid to that collection's
  items (see Component 2).
- Replace the grid/list boolean with a **three-way view-mode selector**:
  `wall | list | grid`. Keep S/M/L size (affects column count for wall/grid and
  thumbnail size for list).

**`PosterGrid.tsx`**
- Support three modes:
  - `wall` — poster only, no caption row, denser column counts than today; title
    available via `title`/tooltip and the detail modal; assigned state = green dot;
    assign via hover overlay.
  - `list` — existing dense rows (thumb + title + year + type + assign).
  - `grid` — existing poster + one-line caption, but trimmed spacing.
- Column-count maps per (mode, size). No virtualization in this iteration (current
  behavior loads a page of items; keep that), but `wall` density must stay smooth —
  if a library page is very large, rely on existing pagination/limits.

**UI state (`shared/store/ui.store.ts`)**
- Persist `browseViewMode` (`wall|list|grid`) and `browsePosterSize` (`s|m|l`) so the
  choice sticks across sessions. (Persist via the store's existing mechanism;
  default `wall`, `m`.)

### Component 2 — Add from collection (preview + add)

- **Source = Collection** in the toolbar lists Plex collections (reuse
  `usePlexCollections`, filtered by current type filter). Selecting one fetches its
  items via the existing `GET /api/plex/collections/{rating_key}/items` and renders
  them in the grid using the active view mode.
- A prominent **"Add all N to channel"** button appears in the toolbar while a
  collection source is active; individual items can still be added one-by-one.
- "Add all" calls the existing **`POST /api/assignments/bulk`** with the collection's
  items (duplicates are skipped server-side). It does **not** write
  `channel_collections` and does **not** mark the source collection as managed.
- `ContentTab`'s current "Link" buttons next to Movies/Shows become **"Add from
  collection"** entry points that set the Browse source to a chosen collection
  (opening the picker, then previewing). The old "link as target" semantics are
  removed from the UI.

### Component 3 — Safe collection engine (backend)

**Ownership model.** `channel_collections` now stores **only Linearr-owned
collections**, written exclusively by the Build step. The user can never designate
one of their own collections as the managed target.

**Schema migration** (via `ALTER TABLE ... ADD COLUMN` + `try/except
sqlite3.OperationalError`, per project convention):
- Add `channel_collections.managed INTEGER NOT NULL DEFAULT 0` — set to `1` only
  after Linearr has successfully managed (added/removed against) that collection at
  least once.

**`POST /api/collections/generate/{channel_number}` (rewrite of the resolve/prune
logic):**
1. Look up the channel name; compute the **owned names**: `f"{name} Movies"` and
   `f"{name} TV"`.
2. For each type with assignments:
   a. **Resolve target by owned name only.** Search Plex for a collection whose
      title equals the owned name. If none, create it. **Never** read the target
      from a pre-existing `channel_collections.collection_rating_key` (that may be a
      legacy link to a user collection).
   b. **Abort guard:** if the resolved collection's title does not equal the owned
      name, raise an error and make no deletions (defensive; should not happen
      given (a)).
   c. **First-touch is additive-only.** Determine whether Linearr already manages
      this collection: a `channel_collections` row for (channel, type) with
      `managed = 1` **and** `collection_rating_key` == the resolved id. If not
      managed yet (first build, or a collection that pre-existed by name), perform
      **add-only** — add `to_add`, skip all removals — then upsert the row with
      `managed = 1`. This guarantees the very first Build can never delete anything
      from any collection, even a hand-made one that happens to share the name.
   d. **Subsequent builds (already managed):** full reconcile — add `to_add`,
      remove `to_remove` — but only ever on this owned collection.
   e. Upsert `channel_collections (channel_number, plex_type,
      collection_rating_key, collection_title, managed)`.
3. Tunarr auto-sync (unchanged in spirit) operates on these owned rows.

**Legacy data.** Existing `channel_collections` rows pointing at user collections
are simply never used as a target (step 2a ignores them) and are overwritten by the
owned row on first Build (`INSERT OR REPLACE` on the `(channel_number, plex_type)`
unique key). The user's real collection is never read for removals and never
pruned.

**Remove the conflated link path.** `POST /api/channel-collections/{n}` no longer
sets a user collection as the managed target or auto-assigns. If still needed for
any internal use it is repurposed/removed; the UI no longer calls it. `DELETE
/api/channel-collections/{n}/{type}` remains for unlinking/cleanup.

### Component 4 — Tunarr sync + naming

- Tunarr smart-collection sync continues to read `channel_collections`, which now
  contains owned `{Channel} {Movies|TV}` collections, so the Tunarr smart collection
  mirrors the safe collection. The smart-collection name/tag derives from
  `collection_title` (already the owned name). No destructive change.

## Data flow (end to end)

1. User opens a channel → Browse view (dense, remembered mode).
2. Adds content: clicks posters/rows from a Library, and/or picks a Collection →
   previews its items → "Add all" → items land in `assignments` (bulk).
3. User clicks **Build collections** → Linearr finds/creates `{Channel} Movies` /
   `{Channel} TV` (owned), reconciles them to the channel's assignments
   (additive-only on first touch), and syncs them to Plex + Tunarr.
4. Channel in Tunarr uses the owned smart collection.

## Error handling & safety

- Build is **additive-only on first touch** of any collection (hard guarantee
  against first-run purge), full reconcile only on collections Linearr already
  manages.
- Build **aborts without deleting** if the resolved target name isn't the owned
  pattern.
- `to_remove` deletions only ever target an owned, previously-managed collection.
- Bulk "Add all" reuses the existing dedupe-on-conflict path; no removals.
- Existing global exception handler returns a generic 500; Build surfaces a clear
  message on Plex/Tunarr failures (best-effort Tunarr, as today).

## Testing

Backend (pytest + FastAPI TestClient, mocking Plex/Tunarr HTTP via monkeypatch on
the httpx calls or a thin seam):
- "Add from collection" (bulk assign) does **not** create/modify a
  `channel_collections` row.
- Build creates an owned `{Channel} {type}` collection and writes a `managed=1` row.
- Build with a legacy `channel_collections` row pointing at a user collection does
  **not** delete from that user collection (ignored) and creates a fresh owned one.
- First Build is additive-only (no DELETE calls); second Build reconciles (issues
  removals for items dropped from assignments).
- Build aborts (no deletes) if a resolved target's title isn't the owned pattern.
- Extract the pure pieces — owned-name computation, add/remove delta, managed/abort
  decision — into small testable helpers so the core logic is unit-tested without a
  live Plex.

Frontend:
- Typecheck/build green. Manual: view-mode switch + persistence; collection preview
  loads items; "Add all" bulk-adds; one-click add still works in all three modes.

## Out of scope (YAGNI for this iteration)

- Multi-select / shift-click bulk pick within a library (one-click-per-item stays).
- Grid virtualization for very large libraries (keep current pagination).
- Letting a user deliberately manage one of their own collections (explicitly
  rejected in favor of the owned-collection model).
- Tailwind/CDN, PWA, and other unrelated audit items.

## Files touched (anticipated)

- Frontend: `features/plex/components/PlexBrowser.tsx`, `.../PosterGrid.tsx`,
  `features/content/components/ContentTab.tsx`,
  `features/collections/components/CollectionPickerModal.tsx`,
  `shared/store/ui.store.ts`, related `features/collections` hooks/api and
  `features/plex` hooks (collection items).
- Backend: `main.py` — `generate_collections` rewrite, `channel_collections`
  migration (`managed` column), retire the conflated `POST /api/channel-collections`
  behavior, small extracted helpers; `tests/` additions.
