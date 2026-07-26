# Channel Reorder + Renumber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Drag to reorder channels, with gap-preserving renumbering that cascades across the database and propagates to Tunarr.

**Architecture:** `channels.number` is the PRIMARY KEY and six tables reference it *by value with no foreign keys*, so a reorder is a multi-row primary-key mutation. It runs as one transactional endpoint using a two-phase write (park affected rows at negative numbers, then write finals) because a naive sequential update collides the moment two channels transiently share a number. Tunarr propagation happens after the local commit and never rolls it back — the local lineup is the source of truth.

**Tech Stack:** Python 3.12 / FastAPI / SQLite; React 18 + TypeScript, Zustand (drag state), TanStack React Query. Native HTML5 drag-and-drop — no new dependency.

## Global Constraints

- `channels.number` is the PRIMARY KEY (`main.py`, `init_db`). There is no `order_index` column and none is being added — reorder means renumber.
- Six tables carry a `channel_number` value reference with **no FK constraints**: `assignments`, `blocks`, `channel_collections`, `tunarr_channel_links`, `tunarr_collection_links`, `ai_logs`. `block_slots` follows `blocks` via `block_id`.
- **`ai_logs` is currently omitted from both the renumber cascade and the delete cleanup — that is a bug this workstream fixes.**
- Renumber rule: **shift numbers preserving relative gaps**; new numbers may be computed.
- Cross-tier drag **moves the channel's `tier`** and gives it a number inside the destination tier's range.
- Tier ranges already exist in `frontend/src/features/channels/presets/numbering.ts` (`Galaxy Main [100,119]`, `Classics [120,139]`, `Galaxy Premium [140,159]`, plus `nextAvailableNumber`). Reuse this model; do not invent a second scheme.
- Tunarr has **no bulk/reorder endpoint** and **no 409**: a duplicate channel number returns **HTTP 500** (create has a descriptive message that may be stripped; update returns an empty body). Pre-flight collisions client-side.
- Tunarr channel writes go through `_tunarr_save_channel` (read-modify-write) — never a partial PUT.
- Every successful Tunarr channel write triggers M3U regeneration and conditionally a full XMLTV/lineup rebuild, so batching many channel writes is expensive; expect latency to scale with the number of channels changed.
- Schema migrations use `ALTER TABLE … ADD COLUMN` in `try/except sqlite3.OperationalError`; never recreate tables.
- Tests: pytest + `httpx.MockTransport`; run with `.venv-test/Scripts/python.exe -m pytest`. The full suite takes ~3 minutes — run targeted files during development.
- Known pre-existing failure, not to be fixed here: `tests/test_collections_safety.py::test_managed_column_exists` fails in isolation (calls `main.get_db()` without the `client` fixture so `init_db` never runs); passes in a full run.

---

## Task 1: Tier range model + renumber computation (pure logic)

The renumber math is the risky part, so it is built and tested as a pure function with no I/O before anything touches the database.

**Files:**
- Modify: `main.py` (new helpers near the channel routes)
- Test: `tests/test_channel_reorder.py` (create)

**Interfaces produced:**
- `TIER_RANGES: dict[str, tuple[int, int]]` — canonical tier -> `(low, high)`, mirroring `numbering.ts`.
- `def _compute_reorder(channels: list[dict], moved_number: int, target_index: int, target_tier: str | None) -> dict[int, tuple[int, str]]` — returns `{old_number: (new_number, new_tier)}` containing **only** channels whose number or tier actually changes. Pure; no DB, no HTTP.

Requirements the tests must pin:
- Reordering within a tier preserves relative gaps where possible and changes only the channels between the source and destination positions.
- A no-op move returns an empty dict.
- Moving to a different tier reassigns `tier` and produces a number inside that tier's range.
- If the destination tier's range is full, the function extends past the range rather than raising, and never produces a duplicate number.
- The returned mapping is always collision-free: no two channels map to the same new number, and no new number collides with an unmoved channel.
- Channels in tiers absent from `TIER_RANGES` are handled without raising.

## Task 2: Transactional reorder endpoint

**Files:**
- Modify: `main.py` — new route; extend the renumber cascade
- Test: `tests/test_channel_reorder.py` (append)

**Interfaces produced:**
- `POST /api/channels/reorder`, body `{"moved_number": int, "target_index": int, "target_tier": str | null}`.
- Returns `{"changed": [{"old_number", "new_number", "tier"}], "channels": [...full new lineup...], "tunarr": {"synced": int, "failed": [{"number", "message"}]}}`.
- `_CHANNEL_REF_TABLES: tuple[str, ...]` — the six referencing tables, replacing the two ad-hoc inline lists in `update_channel` and `delete_channel`.

Behavior:
1. Load the lineup, call `_compute_reorder`, return early with an empty `changed` list if nothing moves.
2. Apply the whole renumber in ONE transaction:
   - **Phase 1** — move every affected channel to a temporary negative number (`number = -number`), cascading to all six tables.
   - **Phase 2** — write the final numbers and tiers, cascading again.
   A single-phase sequential update is wrong: it collides the instant two channels transiently share a number.
3. On any exception, roll back so no half-renumbered lineup can persist.
4. After the commit, sync each changed channel to Tunarr via `_sync_channel_to_tunarr`. Failures are collected and reported per channel; they do **not** roll back the local reorder.

Also fix here: add `ai_logs` to the cascade in `update_channel` and to the cleanup in `delete_channel`, using the shared `_CHANNEL_REF_TABLES` so the three code paths cannot drift again.

Tests must pin: a full reversal of the lineup (worst-case collisions) succeeds; all six tables including `ai_logs` follow the renumber; a mid-flight failure leaves the lineup untouched; a Tunarr failure still returns the committed local result with the failure reported.

## Task 3: Frontend — drag to reorder

**Files:**
- Modify: `frontend/src/features/channels/api.ts`, `hooks.ts`
- Modify: `frontend/src/features/channels/components/ChannelSidebar.tsx`
- Modify: `frontend/src/features/channels/components/ChannelFormModal.tsx`
- Modify: `frontend/src/shared/store/ui.store.ts` (drag state)

Requirements:
- Use the **native HTML5 drag idiom already in the codebase** (`frontend/src/features/blocks/components/HourGrid.tsx`): `dataTransfer`, `preventDefault` on dragover, a drop-target highlight, a grip handle, drag state in Zustand, mutation on drop. `package.json` has no drag library and must not gain one.
- **Change the sidebar list key off `ch.number`** — the number is the value being mutated, so keying on it corrupts reconciliation mid-reorder.
- On drop, call the reorder mutation and replace the `['channels']` cache with the returned lineup, then invalidate every key a renumber invalidates: `['assignments']`, `['blocks']`, `['channel-collections']`, `['collection-status']`, `['tunarr','links']`, `['tunarr','collection-links']`, `['watermark']`.
- A **cross-tier** drop shows a confirm listing the exact number changes before committing.
- Report partial Tunarr sync failures to the user without implying the local reorder failed.
- Fix `useUpdateChannel`, which matches on `c.number === updated.number` and so drops the row whenever the number changes; it also never re-sorts. Both are existing bugs.
- Enable the channel-number field when editing (`ChannelFormModal` currently sets `disabled={isEditing}`), so a direct renumber is possible without dragging.

Gates: `cd frontend && npx tsc --noEmit && npm run build` must pass clean.

## Task 4: Docs

Update `CLAUDE.md`: the new reorder route, the `ai_logs` cascade fix, and a note that `channels.number` is a primary key referenced by value across six tables so any renumber must go through the transactional endpoint.
