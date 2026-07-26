# Cable Plex: Add Content + Expanded Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add movies and shows to a channel — one or many at a time — directly from the Cable Plex view, and make the expanded layout the default.

**Architecture:** The backend already supports arbitrary multi-item adds (`POST /api/assignments/bulk`); only the UI selection layer is missing. That layer is built once as optional props on the existing `PosterGrid` and reused by both entry points: a picker modal and drag-to-assign. No backend change is required.

**Tech Stack:** React 18 + Vite + TypeScript, Zustand (UI + drag state), TanStack React Query, Tailwind CSS v4. Native HTML5 drag-and-drop — no new dependency.

## Global Constraints

- **No backend changes.** `POST /api/assignments/bulk` takes `{channel_number, items[]}` where each item is `{plex_rating_key, plex_title, plex_type, plex_thumb, plex_year}` and carries **no** `channel_number` of its own. It returns `{added, skipped, assignments}`. Duplicates are skipped by a DB uniqueness constraint on `(channel_number, plex_rating_key)`, not by client filtering.
- Field mapping from a `PlexItem` is always: `rating_key -> plex_rating_key`, `title -> plex_title`, `type -> plex_type`, `thumb -> plex_thumb`, `year -> plex_year`.
- **Performance invariants from CLAUDE.md must not regress.** Thumbnails go through `/api/plex/thumb?path=` (never `?url=`), always with `w`/`h` at roughly 2x rendered CSS size, so the backend transcodes instead of serving full-size art. Poster grids keep `content-visibility:auto` with an intrinsic-size hint.
- No new drag/sort dependency. `frontend/package.json` has none and must keep none — use the native HTML5 idiom already in `frontend/src/features/blocks/components/HourGrid.tsx`.
- Persisted UI preferences use the existing localStorage helpers in `frontend/src/shared/store/ui.store.ts` (`readLS`/`writeLS`), following how `browseViewMode` / `browsePosterSize` are done.
- Gates: `cd frontend && npx tsc --noEmit` and `npm run build` must both pass clean. There is no frontend unit-test runner.

---

## Task 1: Expanded by default, persisted

`frontend/src/features/cable-plex/components/CablePlexView.tsx` holds `useState<ViewMode>('compact')` in local state, unpersisted.

- Default to `'expanded'`.
- Persist the choice through `ui.store.ts` under a key alongside the existing browse preferences, so it survives a reload exactly as the Plex browser's preferences do. A persisted choice must win over the new default.

While in this file, fix a stated performance-invariant regression: the channel cards render posters with raw `<img src="/api/plex/thumb?path=...">` and pass no `w`/`h`, so Plex serves full-size art. Switch them to the existing `PlexThumb` component, which passes sized dimensions. Also replace the hand-rolled view/size toggles with the shared `SegmentedControl` primitive.

## Task 2: The multi-select layer

Add OPTIONAL props to `frontend/src/features/plex/components/PosterGrid.tsx`: `selectedKeys?: Set<string>` and `onToggleSelect?: (item: PlexItem) => void`.

- Additive only — every existing call site must keep working untouched, with no selection UI when the props are absent.
- When `onToggleSelect` is provided, each poster shows a checkbox affordance and a selection ring, and the whole tile toggles selection.
- Must work in all three of the component's layouts (`list`, `wall`, `grid`).
- Selection state is owned by the caller, not by `PosterGrid`.

This single primitive is what both Task 3 and Task 4 consume — do not build selection twice.

## Task 3: Add-content picker modal

A new modal that adds one or many Plex items to a specific channel.

- Follow the established **propless, store-driven** modal pattern. Register the modal name in `ModalName` (`frontend/src/shared/types/index.ts`), add it to `defaultModals` (`ui.store.ts`), carry the target channel number in the store, and lazily mount it in `App.tsx` — mirroring how the existing modals are wired.
- `frontend/src/features/plex/components/PlexBrowser.tsx` takes only `{ channelNumber }`, so it can be embedded directly. Reuse it rather than rebuilding search/filter/browse.
- A sticky footer shows the selection count and an "Add N items" action that issues ONE `useBulkAssign` call.
- Clear the selection after a successful add. `useBulkAssign` already invalidates `['assignments']` and raises its own toast, so do not double-toast.
- Structural template for header/body/footer: `frontend/src/features/tunarr/components/TunarrCollectionPickerModal.tsx`. `ModalWrapper` renders no header or footer of its own.

Entry point: an "Add content" affordance on each Cable Plex channel card. **The cards are currently a single whole-card `<button>`**, and nesting a button inside a button is invalid HTML — convert the card to the `div[role="button"]` pattern already used in `PosterGrid`, keep it keyboard-activatable, and `stopPropagation` on the inner action so it does not also navigate.

## Task 4: Drag Plex items onto channel cards

- A drag source on selected posters: dragging one poster drags the whole current selection if that poster is part of it, otherwise just that poster.
- Channel cards are drop targets with a clear highlight state.
- On drop, issue the same single `useBulkAssign` call as the modal.
- Use the native HTML5 idiom (`dataTransfer`, `preventDefault` on dragover, drag state in Zustand) — the same approach as `HourGrid` and the channel-reorder work.
- Do not let a drag interfere with the card's click-to-navigate behavior.

## Task 5: Docs

Update `CLAUDE.md` and `docs/ABOUT_LINEARR.md` where they describe the Cable Plex view's two modes and default. Note the new add-content flows.
