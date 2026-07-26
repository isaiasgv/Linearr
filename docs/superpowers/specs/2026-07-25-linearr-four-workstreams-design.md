# Linearr — Four Workstreams Design

**Created:** 2026-07-25
**Last-Updated:** 2026-07-25
**Status:** Draft

Covers four independent capabilities, sequenced by dependency:

1. **Tunarr foundation + watermark** — study Tunarr's real API, harden channel CRUD, full watermark editing
2. **Channel reorder + renumber** — drag to reorder, gap-preserving renumber, synced to Tunarr
3. **Collections** — assign pre-existing collections by reference, per-channel smart collections, Tunarr purge
4. **Cable Plex add content** — multi-select add from the Cable Plex view, expanded as default

Each workstream ships on its own branch, PR'd into `dev`, in the order above.

---

## Workstream 3 — Collections

*(Approved 2026-07-25. Listed here out of build order; it is section 3 of 4.)*

### Problem

Three collection concepts exist today and are easy to confuse:

- `generate_collections` (`main.py:1924`) creates/manages Linearr's **own** `{Channel} Movies` / `{Channel} TV`
  collections from a channel's assignments. Ownership is by **name** — it never reads a stored rating key,
  so a user's own collection can never be pruned (`main.py:1896-1921`).
- `channel_collections` stores the rating key of that owned collection per `(channel_number, plex_type)`.
- `POST /api/channel-collections/{n}` (`main.py:1776`) — despite the name, **copies** an existing
  collection's items into assignments. Its docstring is explicit: *"SOURCE action only… does NOT mark the
  picked collection as the channel's managed target."*

There is no way to point a channel at a pre-existing collection and **reuse it by reference**.

### Decisions

| Question | Decision |
|---|---|
| What does "assign" do? | **Reference only** — record the link, never modify the collection's contents |
| Slot model | **One active source per type** — assigning replaces the slot |
| Tunarr | Assigned collections **are** manually pushable to Tunarr |
| New smart collection | **Create then auto-assign** in one action |
| Purge | **Single delete + global purge-all** |
| UI location | **Per-channel** (no separate global collections view) |

### Data model

Two additive columns on `channel_collections`, via `ALTER TABLE … ADD COLUMN` wrapped in
`try/except sqlite3.OperationalError` (the project's migration convention — never recreate tables):

- `source TEXT NOT NULL DEFAULT 'owned'` — `'owned'` (Linearr-generated) or `'assigned'` (external, reference-only)
- `is_smart INTEGER NOT NULL DEFAULT 0` — whether the assigned collection is a Plex smart collection

`UNIQUE(channel_number, plex_type)` stays → one active source per type. Existing rows default to `'owned'`,
so nothing breaks.

### Backend

Already exists (verified) — reuse, do not rebuild:

- `DELETE /api/plex/collections/{rating_key}` (`main.py:2535`)
- `PUT /api/plex/smart-collections/{rating_key}` (`main.py:2752`)
- `POST /api/plex/smart-collections` (`main.py:2721`)
- Tunarr smart collection create/update/**single** delete (`main.py:5296` / `5320` / `5353`)
- `POST /api/tunarr/channel-links/{n}/sync-collections` (`main.py:5449`) — reads `channel_collections`
  titles and builds a tag-based smart collection, so an **assigned** collection pushes with no change

New:

- `POST /api/channel-collections/{n}/assign` — body `{plex_type, collection_rating_key, collection_title, is_smart}`.
  Writes the slot with `source='assigned'`. Never reads or edits the collection's members.
- `POST /api/channels/{n}/smart-collection` — creates a Plex smart collection (reusing `_build_smart_uri`,
  `main.py:2680`) **then** assigns it atomically, so auto-assign cannot leave an orphan.
- `POST /api/tunarr/smart-collections/purge` — lists all Tunarr smart collections, deletes each, clears
  `tunarr_collection_links`; returns `{deleted, failed}`.

Changed:

- `generate_collections` — when a type's slot is `source='assigned'`, generating switches it back to
  `'owned'`. This is the documented, intentional switch; the UI states it before it happens.
- The existing copy-items route is relabeled **"Import items"** in the UI (unchanged behavior — genuinely
  a different action from assign).

### Safety invariant

Unchanged: `generate_collections` only ever edits collections literally named `{Channel} Movies` /
`{Channel} TV`. An assigned collection can never be pruned by Linearr.

### Frontend

Extend the existing collapsible Collections panel in `ContentTab.tsx`. Per type (movie/show), show the
**active source** and its controls:

- **Owned** → `{Channel} Movies (generated)` + *Build/Rebuild*
- **Assigned** → collection title + `smart` badge + `assigned` tag

Actions: **Assign existing…** (`AssignCollectionModal` — lists `/api/plex/collections`, filtered by type,
with smart badge, item count, thumb, search); **New smart collection…** (`SmartCollectionBuilderModal` —
section picker, filters for genres/year-range/decade/unwatched/content-rating/title-contains, sort, limit);
**Edit filters** / **Delete collection** (assigned smart only); **Build collections**; **Push to Tunarr**;
**Unassign** (link only — never deletes the Plex collection).

Global: a **Purge all Tunarr collections** button in the Tunarr view behind a strong confirm.

New api/hooks in `features/collections`: `assignCollection`, `createSmartCollectionForChannel`,
`updateSmartCollection`, `deletePlexCollection`.

### Tests

- assign writes `source='assigned'` and leaves `assignments` untouched
- `generate` toggles an assigned slot back to `'owned'`
- combined smart-create + assign is atomic (no orphan on assign failure)
- delete-plex-collection clears the referencing slot
- Tunarr purge (mocked HTTP)

---

## Workstream 4 — Cable Plex: add content + expanded default

### Decisions

| Question | Decision |
|---|---|
| Interaction | **Both** — picker modal (primary) **and** drag-and-drop (power user) |
| Default view | **`expanded`** |

### Current state (verified)

- `CablePlexView.tsx:307` — `useState<ViewMode>('compact')`, local state, **not** persisted.
  Contrast: the Plex browser's `browseViewMode` / `browsePosterSize` **are** persisted to localStorage
  (`ui.store.ts:173-186`, helpers `readLS`/`writeLS` at `:92-107`). That is the pattern to copy.
- Cards are whole-card `<button>`s (compact `:118`, expanded `:217-222`) → any nested action button
  requires converting the outer element to `div[role=button]` + `stopPropagation`, the pattern already
  used in `PosterGrid.tsx:166-178`.
- **No multi-select primitive exists anywhere in the app.** The only `Set<string>` is `assignedKeys`
  (derived, `PlexBrowser.tsx:111-114`). "Many at once" today = "Add all currently-filtered" or an
  AI-provided list.
- Backend + wire format already support arbitrary multi-item adds:
  `POST /api/assignments/bulk` → `BulkAssignmentIn {channel_number, items[]}` (`main.py:527-529`, route `:928`).
  Items carry **no** `channel_number`. Response is `{added, skipped, assignments}` — the TS type currently
  declares only `{added, skipped}` and discards the refreshed list (`assignments/api.ts:20`).
- `useBulkAssign` invalidates `['assignments']`; `useAssign` does not (`assignments/hooks.ts:71` vs `:45-51`).

### Design

**Default view.** Flip `CablePlexView.tsx:307` to `'expanded'` and persist the choice via the existing
`ui.store` localStorage pattern (`linearr:cablePlexViewMode`), so it survives reloads like the browse prefs do.

**Multi-select layer.** Extend `PosterGrid` with optional `selectedKeys: Set<string>` + `onToggleSelect`
props — additive, so all existing call sites are unaffected. When `onToggleSelect` is provided, each poster
renders a checkbox overlay and a selection ring. This is the missing primitive and is reused by both the
modal and the drag flow.

**Picker modal.** `AddContentModal` following the established propless, store-driven picker pattern
(`TunarrCollectionPickerModal` is the closest structural template: `ModalWrapper` + header + search +
scroll-list + action). It embeds the existing `PlexBrowser` (prop-clean, `{channelNumber}` only) with the
new multi-select layer, and a sticky footer showing "Add N items" → one `useBulkAssign` call.
Registration required in `ModalName` (`types/index.ts:292-302`), `defaultModals` (`ui.store.ts:109-120`),
and lazily mounted in `App.tsx:146-156`.

**Drag-and-drop.** Selected posters drag as a group onto a channel card; the card highlights as a drop
target and drops issue the same bulk mutation. Shares the drag layer introduced for Workstream 2 (reorder).

**Cleanups in scope** (touching this code anyway): Cable Plex bypasses `PlexThumb` with raw `<img>` tags
(`:128-136`, `:276-285`) and so passes no `w`/`h` — a stated performance invariant in CLAUDE.md. Switch to
`PlexThumb`. Hand-rolled toggles at `:362-447` become `SegmentedControl`.

### Tests

- bulk add from the modal issues one request with the correct item shape
- selection state toggles and clears correctly
- default view mode is `expanded`; persisted choice wins over the default
- e2e: no collision with `assign-movie.spec.ts` (it never visits Cable Plex)

---

## Workstream 1 — Tunarr foundation + watermark

### Decisions

| Question | Decision |
|---|---|
| Scope | **Full** per-channel editor — every Tunarr watermark field |
| Preview | **Live preview** showing placement on the frame |
| Image source | **Defaults to the channel icon**, with per-channel override |

### Tunarr API facts (read from tagged source at `v1.2.10`, `v1.3.6`, `v1.3.9`)

Authoritative sources: `types/src/schemas/channelSchema.ts`, `server/src/api/channelsApi.ts`,
`server/src/db/schema/Channel.ts`, `server/src/stream/ProgramStream.ts`, plus the ffmpeg watermark filter
builders and `server/tests/channels.test.ts` (the authoritative minimal payload).

**Channel CRUD**

- `GET /api/channels`, `GET|PUT|DELETE /api/channels/:id` (`:id` is the **uuid only** — channel *number*
  does not resolve), `POST /api/channels`. **No PATCH. No bulk/reorder/renumber endpoint anywhere.**
- **CREATE is a discriminated union in every 1.x release**:
  `{type:'new', channel:{…}}` or `{type:'copy', channelId}`. There is **no flat-object form in any
  supported version** — Linearr's flat fallback (`main.py:4305-4307`) is dead code.
- `id` is **required by the schema but ignored by the server** (it hard-codes `uuid v4()`). Send any
  string; read the real uuid from the 201 response.
- **`PUT` takes the FULL `SaveableChannel`, not a partial.** Only `onDemand` is `.partial()`. A PUT missing
  any required scalar (`duration`, `offline`, `startTime`, `stealth`, `streamMode`,
  `guideMinimumDuration`, `disableFillerOverlay`, `subtitlesEnabled`, `transcodeConfigId`) is a **400**.
- **Read-modify-write is safe and is the correct pattern**: `z.object` strips unknown keys, so
  `GET` → mutate → `PUT` the whole object works; `programCount`, `transcoding`, `sessions`, `fallback`
  are silently dropped rather than rejected.
- **Duplicate `number` → HTTP 500, not 409** (unique at both the column and a unique index). CREATE has an
  app-level pre-check whose message may be stripped; PUT has **no pre-check** and returns 500 with an
  empty body. There is **no 409 anywhere in the channel API** → Linearr must pre-flight collisions against
  `GET /api/channels` and treat any 5xx as "possible number conflict, re-read to confirm".
- Per-channel `transcoding` overrides are **not settable** (omitted from `SaveableChannel`).
  `transcodeConfigId` is **required**, and in 1.3.x must be a valid uuid **that exists**.
- Omission semantics are **not uniform**: omitting `watermark` does **not** clear it (there is no way to
  null it via the API — disable with `enabled:false`); omitting `fillerCollections` does not clear it;
  omitting `subtitlePreferences` **does** clear it.
- `guideMinimumDuration` has an **inconsistent unit inside Tunarr itself** (seconds in one place, ms in
  another) → **never compute it; echo back whatever the channel already has.** Same for `duration`
  (server-maintained; sending `0` zeroes it).
- Writes echo the full saved object, so a watermark write is verifiable from the response. Caveat:
  `fillerCollections`/`subtitlePreferences` come back `undefined` on write responses even when saved.
- `/openapi.json` is served at the **root** — the best runtime capability probe per connection.
- `/api/smart_collections` is **underscored in both 1.2.10 and 1.3.6** → Linearr's hyphen fallback is dead
  code and the CLAUDE.md note should be resolved in favor of the underscore for the whole supported range.
- Tasks are `POST /api/tasks/:id/run` — Linearr already does this correctly (`main.py:5634-5640`).

**Watermark schema — `channelSchema.ts:8-40`, byte-for-byte identical across v1.0.0 → v1.3.9.**
One payload works for the entire supported range.

| Field | Type / range | Req | Semantics (traced to the ffmpeg filter builders) |
|---|---|---|---|
| `enabled` | boolean | **yes** | master switch |
| `url` | string | no | **must be an absolute URL**; see image resolution below |
| `position` | `top-left\|top-right\|bottom-left\|bottom-right` | no (`bottom-right`) | **only these four — no center, no custom x/y** |
| `width` | number, **strictly > 0** | **yes** | **percent of the padded output frame width**; `0` is a 400 |
| `verticalMargin` / `horizontalMargin` | 0–100 | **yes** | percent of frame height/width from the corner |
| `duration` | ≥ 0 (default 0) | no | **seconds** per program segment; `0` = always on |
| `opacity` | **integer** 0–100 | no (100) | non-integer is a 400 |
| `fixedSize` | boolean | no | `true` **skips scaling entirely → `width` becomes inert** |
| `animated` | boolean | no | **persisted but never read by any pipeline builder at 1.3.6 — effectively a no-op** |
| `fadeConfig[]` | array | no | **only index `[0]` is ever applied**; `periodMins` ≥ 1 (minutes on/off), `leadingEdge` default true, `programType` **never read** |

Server-side sanitization silently drops `fadeConfig` entries with `periodMins <= 0`, and an all-dropped
array becomes absent. Fade also requires a bounded segment duration.

**Watermark image resolution order** (`ProgramStream.getWatermark()`), which matters for the
"reuse the channel icon" decision:

1. `transcodeConfig.disableChannelOverlay` → **no watermark at all**, channel setting ignored
2. lineup item is `commercial` **and** `channel.disableFillerOverlay` → none
3. `enabled !== true` → none
4. `url` non-empty **and absolutely parseable** → non-localhost URLs are downloaded and cached
5. `url` blank **or not absolute** (this includes relative paths) → **falls back to the channel icon**
   (`icon.path`), else Tunarr's own `tunarr.png`

**Critical consequence:** there is **no data-URI support** and no relative-path support — the value is
used as an ffmpeg HTTP input. Linearr stores channel icons as **base64 data URIs** in `channels.icon`
(`main.py:258`) and pushes them as `icon.path`. So "watermark inherits the channel icon" **cannot work by
leaving `url` blank** — Tunarr would fall back to a `data:` URI that ffmpeg cannot read.

The image must therefore be **hosted**. Tunarr provides a generic upload (present in both 1.2.10 and
1.3.6): `POST /api/upload/image` (multipart, first file only, must sniff as `image/*`) →
`{name, fileUrl}`. The `fileUrl` is built from the inbound `req.host`, so when Linearr talks to
`http://tunarr:8000` the returned host may be unreachable — **rewrite it onto the configured Tunarr base
URL**. Served path is `/images/uploads/…` at the root, not under `/api`.

### Bugs found (fix as part of this workstream)

1. **Channel metadata sync to Tunarr is broken for updates.** `_sync_channel_to_tunarr` PUTs only
   `{name, number, groupTitle, icon}` (`main.py:614-622`, issued at `:629`). Since `SaveableChannel` is
   **not** partial, Tunarr rejects this with **400** — every required scalar is missing. Renaming or
   renumbering a linked channel therefore fails to propagate, and the handler reports
   `"Tunarr {status}"`. *(Verified against Tunarr source; to be confirmed against the live server.)*
   **Fix:** read-modify-write — `GET /api/channels/{id}`, merge the changed keys, `PUT` the full object.
2. **Create can send an invalid payload.** `transcode_id` is read from
   `/api/ffmpeg-settings.defaultTranscodeConfigId` (`main.py:641-645`); when absent, the builder falls back
   to `obj["transcoding"] = {...}` (`main.py:4290-4291`) — but `transcoding` is **read-only/stripped** and
   `transcodeConfigId` is **required**, so the create is a 400. **Fix:** resolve a real id from
   `GET /api/transcode_configs`, and never send `transcoding`.
3. Dead code to remove: the flat-create fallback (`main.py:4305-4307`) and the smart-collections hyphen
   fallback (`main.py:5239`, `:5467`).

### Design

**A single canonical channel writer.** Introduce `_tunarr_save_channel(client, url, tunarr_id, changes)`
implementing read-modify-write, and route *all* channel writes through it (`_sync_channel_to_tunarr`
update path, `POST /api/tunarr/channels`, export). `_tunarr_channel_obj` keeps building the **create**
payload only, gains a `watermark` parameter, and drops the `transcoding` fallback. A
`_tunarr_resolve_transcode_config(client, url)` helper resolves a valid id once per operation.

**Capability probe.** `_tunarr_capabilities(url)` fetches `/openapi.json` once per connection (cached) to
record version + whether a route/field exists, replacing guess-and-fallback with a known shape. Keeps the
existing `TUNARR_MIN_VERSION` floor.

**Storage.** Two additive columns on `channels` (migration convention, `try/except sqlite3.OperationalError`):
`watermark TEXT` (JSON blob mapping 1:1 to Tunarr's object; `NULL` = none) and
`watermark_image_url TEXT` (the cached absolute URL returned by Tunarr's upload, so re-uploading is
avoided on every sync). A JSON blob is deliberate — the schema is stable across all supported Tunarr
versions, so there is nothing to normalize into columns.

**Routes.** `GET|PUT|DELETE /api/channels/{n}/watermark` (validate, persist, then sync to Tunarr) and
`POST /api/channels/{n}/watermark/image` (accepts an upload or "use the channel icon"; decodes the stored
data URI, uploads to Tunarr via `POST /api/upload/image`, rewrites the host onto the configured base URL,
caches the result in `watermark_image_url`).

**Validation mirrored client- and server-side**, matching Tunarr's real constraints so users get a clear
message instead of an opaque 400: `width > 0` strictly, `opacity` an integer 0–100, margins 0–100,
`duration >= 0`, `fadeConfig[0].periodMins >= 1`.

**Frontend — `WatermarkEditorModal`.** Fields: enabled, image (use-channel-icon toggle vs upload/override,
reusing the icon-library picker), position (4-corner picker), width, margins, opacity, duration, fixedSize,
and a **single** fade config (not a list — only index 0 is honored). `animated` is either hidden or shown
disabled with "not yet implemented by Tunarr", because shipping a control that silently does nothing is
worse than omitting it. **Live preview:** a 16:9 frame rendering the image at `width`% of frame width in
the chosen corner at the given margins and opacity — a faithful model of the ffmpeg filter chain, and the
reason `fixedSize` visibly greys out `width`.

**Surface the kill switches.** When a watermark is enabled, the editor warns if
`transcodeConfig.disableChannelOverlay` is set (watermark will never render) and explains that
`disableFillerOverlay` suppresses it during commercials — the two reasons a correct config still shows
nothing.

### Tests

- read-modify-write PUT includes every required scalar (regression for bug 1)
- create resolves a real `transcodeConfigId` and never sends `transcoding` (bug 2)
- watermark payload validation: `width=0`, non-integer opacity, `periodMins=0` all rejected with clear errors
- icon data-URI → Tunarr upload → host rewrite → cached URL
- duplicate-number pre-flight, and a 5xx is surfaced as a probable conflict
- live verification against the real Tunarr for every write path

---

## Workstream 2 — Channel reorder + renumber

### Decisions

| Question | Decision |
|---|---|
| Renumber rule | **Shift numbers, preserving relative gaps** (may compute new numbers) |
| Cross-tier drag | **Moves the channel's tier** and takes a number in the destination range |
| Tunarr sync | Numbers propagate to Tunarr; two-phase write to survive uniqueness constraints |

### Current state (verified)

- `channels.number` is the **PRIMARY KEY** (`main.py:196`) and the only ordering axis — there is no
  `order_index` column (unlike `blocks`, which has one at `main.py:137`). So "reorder" necessarily means
  **renumber**, mutating a primary key that six other tables reference **by value with no FK constraints**
  (explicitly noted at `main.py:711-712`).
- Tables referencing `channel_number`: `assignments` (`:115`), `blocks` (`:131`), `channel_collections`
  (`:154`), `tunarr_channel_links` (`:174`), `tunarr_collection_links` (`:184`), `ai_logs` (`:232`), plus
  `block_slots` indirectly via `block_id`.
- The only renumber implementation is `PUT /api/channels/{n}` (`main.py:667-695`), cascading to five
  tables at `:684`. **No bulk/atomic reorder endpoint exists** — renumbering N channels means N sequential
  PUTs, each able to 409 on a transient collision (`main.py:683`).
- **Tier numeric ranges already exist** in `frontend/src/features/channels/presets/numbering.ts:6-10`:
  `Galaxy Main [100,119]`, `Classics [120,139]`, `Galaxy Premium [140,159]`, with a `nextAvailableNumber`
  helper at `:16-27`. This is exactly the block model the gap-preserving rule needs — reuse it, and
  promote it to shared logic rather than inventing a second scheme.
- **The UI offers no way to renumber at all** — the number input is `disabled={isEditing}`
  (`ChannelFormModal.tsx:612`). The backend cascade is reachable only via MCP or a raw API call.
- **Existing DnD idiom to reuse:** native HTML5 drag-and-drop in `HourGrid.tsx:56-94` — `dataTransfer`,
  `preventDefault` on dragover, drop-target highlight (`:122-124`), grip-dots handle (`:156-165`),
  drag state in **Zustand** (`blocks/store.ts`), mutation on drop. `package.json` has **zero** drag/sort
  dependencies (`@dnd-kit`, `react-beautiful-dnd`, `sortablejs` all absent) — do not add one.

### Bugs found in the affected code (fix as part of this workstream)

1. **`ai_logs.channel_number` is not cascaded on renumber and not cleaned on delete** — it is omitted from
   both the renumber loop (`main.py:684`) and the delete cleanup (`main.py:717`). A renumbered channel
   silently orphans its AI history; a reused number inherits ghost logs.
2. **`useUpdateChannel` corrupts the cache on renumber** (`channels/hooks.ts:38-40`) — it maps in place
   matching on `c.number === updated.number`, so when the number *changes* the old entry never matches:
   the list keeps a stale row and drops the new one until a hard refetch. It also never re-sorts
   (`useCreateChannel` does, at `:21-23`) and never invalidates the keys a renumber invalidates:
   `['assignments']`, `['blocks',{channelNumber}]`, `['channel-collections',n]`, `['collection-status',n]`,
   `['tunarr','links']`, `['tunarr','collection-links']`.

### Design

**New endpoint — `POST /api/channels/reorder`.** Body: the desired ordering as
`[{number, tier}, …]` (or `{moved_number, target_index, target_tier}`; the former is more robust to
client/server drift). The handler computes the new numbering server-side using the shared tier-range
model, then applies **the entire renumber in one SQLite transaction**:

1. Compute the target assignment; no-op if unchanged.
2. **Two-phase write to dodge the PK/unique collision:** first move every affected channel to a temporary
   negative number (`number = -number`), then write the final numbers. A single-phase sequential update
   would 409 the moment two channels transiently share a number.
3. Cascade each change across **all six** referencing tables (adding `ai_logs`, per bug 1).
4. Return the full new lineup so the client can replace `['channels']` wholesale.

Because it is one transaction, a partial failure rolls back — no half-renumbered lineup.

**Tunarr propagation.** After the DB commit, sync each changed channel via the existing
`_sync_channel_to_tunarr` (`main.py:599`). Tunarr's own number-uniqueness handling is confirmed by the API
research (Workstream 1) and the same two-phase approach is applied there if Tunarr rejects transient
duplicates. Sync failures are reported per channel and **do not** roll back the local reorder — the local
lineup is the source of truth and a re-sync action is offered.

**Frontend.** Drag handles on the channel sidebar rows (`ChannelSidebar.tsx:308-401`) and Cable Plex cards,
using the `HourGrid` idiom with drag state in a Zustand slice. **Keys must change from `ch.number`**
(`:316`, `:350`) to a stable identity, since the number is the very thing being mutated. On drop, show the
computed number changes before committing when a **cross-tier** move is involved (per the confirmation the
cross-tier decision implies), then call the reorder mutation and replace the `['channels']` cache with the
returned lineup, invalidating the dependent keys listed above.

Also enable the number field when editing (`ChannelFormModal.tsx:612`) so a direct renumber is possible
without dragging.

### Tests

- reorder within a tier preserves relative gaps and changes only the intended numbers
- cross-tier drag reassigns `tier` and lands inside the destination range
- the two-phase write survives a full reversal of the lineup (worst-case collisions)
- the cascade updates all six tables, `ai_logs` included
- a failure mid-reorder rolls back completely
- **no test currently covers the renumber cascade at all** — this adds the first

---

## Verification

Live Plex and Tunarr are reachable, so every Tunarr write path is verified against the real server, not
only mocked tests. Anything that cannot be verified end-to-end is flagged explicitly rather than claimed.
