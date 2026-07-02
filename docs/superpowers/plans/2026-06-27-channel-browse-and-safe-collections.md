# Denser Browse View + Safe Channel Collections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the channel Browse view denser (three switchable layouts), let users add a whole existing collection (preview-then-add), and make collection generation incapable of damaging the user's own Plex collections.

**Architecture:** Frontend-only changes for density + collection-as-source (reuse existing hooks). Backend rewrite of `generate_collections` so Linearr only ever manages its own `{Channel} Movies` / `{Channel} TV` collections, with an `additive-only-on-first-touch` guarantee and a `managed` flag column. Pure helpers carry the safety logic and are unit-tested; one integration test (respx-mocked Plex) proves no deletes hit a user collection.

**Tech Stack:** Python 3.12 / FastAPI / SQLite (`main.py`); React 18 + Vite + TS, Zustand, TanStack Query, Tailwind v3 (`frontend/`); pytest + respx (backend tests).

## Global Constraints

- Backend tests: pytest + FastAPI `TestClient`; mock Plex HTTP with `respx` (no live Plex). DB is the env-configurable `DB_PATH` (tests use a temp file via `tests/conftest.py`).
- DB migrations: `ALTER TABLE ... ADD COLUMN` wrapped in `try/except sqlite3.OperationalError` — never recreate tables.
- Plex thumbnails are proxied via `/api/plex/thumb?path=` (never `?url=`).
- Owned collection names are exactly `f"{channel_name} Movies"` and `f"{channel_name} TV"` — this exact string is the ownership signal; do not change the format.
- Frontend path alias `@/` → `frontend/src/`. Keep Tailwind v3 utility classes (no v4 tokens).
- Conventional commits; commit after each task. End commit messages with the project trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `PlexItem` shape (from `@/shared/types`): `{ rating_key, title, type: 'movie'|'show', thumb, year }`.
  `Assignment` bulk item shape: `{ plex_rating_key, plex_title, plex_type, plex_thumb, plex_year }`.

---

## File Structure

**Backend (`main.py`)**
- New pure helpers near the other collection code: `_owned_collection_name`, `_collection_delta`, `_is_owned_title`.
- `channel_collections` migration: add `managed INTEGER NOT NULL DEFAULT 0`.
- `generate_collections` (rewrite of the resolve/prune block, ~lines 1850–1951).
- `link_channel_collection` (neutered: assign-only, no `channel_collections` write).

**Backend tests**
- `tests/test_collections_safety.py` — pure-helper unit tests + respx integration tests.
- `requirements-dev.txt` — add `respx`.

**Frontend**
- `frontend/src/shared/store/ui.store.ts` — persist `browseViewMode` (`wall|grid|list`) + `browsePosterSize` (`small|medium|large`).
- `frontend/src/features/plex/components/PosterGrid.tsx` — add `wall` mode; widen `PosterViewMode`.
- `frontend/src/features/plex/components/PlexBrowser.tsx` — slim single-row toolbar, filters popover, 3-way view selector, Library|Collection source, "Add all N" via bulk assign.
- `frontend/src/features/content/components/ContentTab.tsx` — "Link" → "Add from collection" entry that switches Browse source.
- `frontend/src/features/collections/hooks.ts` + `api.ts` — `useGenerateCollections` toast copy unchanged; `useLinkCollection` semantics documented as assign-only.

---

## Task 1: Backend — `managed` column + pure safety helpers

**Files:**
- Modify: `c:\idgvgit\Linearr\main.py` (migrations block ~line 157; add helpers above `generate_collections` ~line 1799)
- Test: `c:\idgvgit\Linearr\tests\test_collections_safety.py` (create)

**Interfaces:**
- Produces:
  - `_owned_collection_name(channel_name: str, plex_type: str) -> str` — returns `f"{channel_name} Movies"` for `"movie"`, `f"{channel_name} TV"` for `"show"`; raises `ValueError` for other types.
  - `_is_owned_title(title: str, channel_name: str) -> bool` — `True` iff `title` equals either owned name for that channel.
  - `_collection_delta(desired: set[str], current: set[str], already_managed: bool) -> tuple[set[str], set[str]]` — returns `(to_add, to_remove)`; `to_remove` is always empty when `already_managed` is `False` (additive-only first touch).
  - DB: `channel_collections.managed INTEGER NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write the failing test**

Create `c:\idgvgit\Linearr\tests\test_collections_safety.py`:

```python
"""Safety logic for channel collection generation."""
import main


def test_owned_collection_name():
    assert main._owned_collection_name("Galaxy ONE", "movie") == "Galaxy ONE Movies"
    assert main._owned_collection_name("Galaxy ONE", "show") == "Galaxy ONE TV"


def test_owned_collection_name_rejects_unknown_type():
    import pytest
    with pytest.raises(ValueError):
        main._owned_collection_name("Galaxy ONE", "artist")


def test_is_owned_title():
    assert main._is_owned_title("Galaxy ONE Movies", "Galaxy ONE") is True
    assert main._is_owned_title("Galaxy ONE TV", "Galaxy ONE") is True
    assert main._is_owned_title("Movies", "Galaxy ONE") is False
    assert main._is_owned_title("Galaxy ONE Sci-Fi", "Galaxy ONE") is False


def test_collection_delta_additive_only_first_touch():
    desired = {"1", "2", "3"}
    current = {"3", "99"}  # 99 is a pre-existing item we must NOT remove on first touch
    to_add, to_remove = main._collection_delta(desired, current, already_managed=False)
    assert to_add == {"1", "2"}
    assert to_remove == set()  # additive-only — never delete on first touch


def test_collection_delta_full_reconcile_when_managed():
    desired = {"1", "2", "3"}
    current = {"3", "99"}
    to_add, to_remove = main._collection_delta(desired, current, already_managed=True)
    assert to_add == {"1", "2"}
    assert to_remove == {"99"}


def test_managed_column_exists():
    with main.get_db() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(channel_collections)")}
    assert "managed" in cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_collections_safety.py -v`
Expected: FAIL — `AttributeError: module 'main' has no attribute '_owned_collection_name'` (and the migration test fails: no `managed` column).

- [ ] **Step 3: Add the migration**

In `c:\idgvgit\Linearr\main.py`, inside the migrations block (after the `block_slots`/`tunarr` ALTERs near line 162), add:

```python
        try:
            conn.execute("ALTER TABLE channel_collections ADD COLUMN managed INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
```

- [ ] **Step 4: Add the pure helpers**

In `c:\idgvgit\Linearr\main.py`, immediately above `@app.post("/api/collections/generate/{channel_number}")` (~line 1799), add:

```python
# ── Channel collection ownership helpers ──────────────────────────────────────
# Linearr only ever manages its OWN per-channel collections, named exactly like
# "{Channel} Movies" / "{Channel} TV". These names are the ownership signal: the
# generator never reads a stored rating key (which could point at a user's own
# collection) and never deletes from anything whose title isn't one of these.

_COLLECTION_SUFFIX = {"movie": "Movies", "show": "TV"}

def _owned_collection_name(channel_name: str, plex_type: str) -> str:
    suffix = _COLLECTION_SUFFIX.get(plex_type)
    if suffix is None:
        raise ValueError(f"Unsupported plex_type for collection: {plex_type}")
    return f"{channel_name} {suffix}"

def _is_owned_title(title: str, channel_name: str) -> bool:
    return title in (
        _owned_collection_name(channel_name, "movie"),
        _owned_collection_name(channel_name, "show"),
    )

def _collection_delta(desired: set[str], current: set[str], already_managed: bool) -> tuple[set[str], set[str]]:
    """Return (to_add, to_remove). On first touch (not yet managed) removals are
    suppressed — Linearr will only ADD, never strip items it didn't put there."""
    to_add = desired - current
    to_remove = (current - desired) if already_managed else set()
    return to_add, to_remove
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_collections_safety.py -v`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_collections_safety.py
git commit -m "feat(collections): add managed flag + ownership/delta safety helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — rewrite `generate_collections` to the safe engine

**Files:**
- Modify: `c:\idgvgit\Linearr\main.py` — the per-type resolve/prune block inside `generate_collections` (~lines 1850–1951)
- Test: `c:\idgvgit\Linearr\tests\test_collections_safety.py` (add integration tests)
- Modify: `c:\idgvgit\Linearr\requirements-dev.txt` (add `respx`)

**Interfaces:**
- Consumes: `_owned_collection_name`, `_collection_delta`, `_is_owned_title` (Task 1); `managed` column (Task 1).
- Produces: `POST /api/collections/generate/{channel_number}` that (a) resolves the target only by owned name, (b) never reads a stored `collection_rating_key` as the target, (c) is additive-only the first time it touches a collection, (d) aborts (HTTP 500) without deleting if a resolved collection's title isn't owned, (e) writes `channel_collections` rows with `managed=1`.

- [ ] **Step 1: Add respx to dev deps**

Edit `c:\idgvgit\Linearr\requirements-dev.txt`:

```
-r requirements.txt
pytest>=8.0
respx>=0.21
```

Install: `python -m pip install -r requirements-dev.txt`

- [ ] **Step 2: Write the failing integration tests**

Append to `c:\idgvgit\Linearr\tests\test_collections_safety.py`:

```python
import httpx
import respx

PLEX = "http://plex:32400"


def _seed_channel_and_assignments(channel_number=900, name="TestChan"):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (?, ?)", (channel_number, name))
        conn.execute("DELETE FROM assignments WHERE channel_number=?", (channel_number,))
        for rk in ("1", "2", "3"):
            conn.execute(
                "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year) "
                "VALUES (?,?,?,?,?,?)",
                (channel_number, rk, f"Movie {rk}", "movie", None, 2020),
            )
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")


def _base_plex_routes(router, *, section_collections, children):
    """Wire the read endpoints generate_collections calls. `children` is the list of
    ratingKeys currently in the resolved collection."""
    router.get(f"{PLEX}/identity").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"machineIdentifier": "m1"}}))
    router.get(f"{PLEX}/library/sections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Directory": [
            {"type": "movie", "key": "1"}, {"type": "show", "key": "2"}]}}))
    router.get(f"{PLEX}/library/sections/1/collections").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": section_collections}}))
    router.get(url__regex=rf"{PLEX}/library/collections/\d+/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {
            "Metadata": [{"ratingKey": k} for k in children]}}))


@respx.mock
def test_first_touch_is_additive_only_on_adopted_collection(auth_client):
    """Adopting a pre-existing collection named '{Channel} Movies' must ADD the
    channel's items but NEVER delete the items already in it."""
    _seed_channel_and_assignments()
    router = respx.mock
    # A collection already exists with the owned name and contains a foreign item "99".
    _base_plex_routes(router,
        section_collections=[{"title": "TestChan Movies", "ratingKey": "500"}],
        children=["3", "99"])
    add = router.put(url__regex=rf"{PLEX}/library/collections/500/items").mock(
        return_value=httpx.Response(200, json={}))
    delete = router.delete(url__regex=rf"{PLEX}/library/collections/500/items").mock(
        return_value=httpx.Response(200, json={}))

    r = auth_client.post("/api/collections/generate/900")
    assert r.status_code == 200, r.text
    assert add.called           # items 1 and 2 added
    assert not delete.called     # item 99 NOT removed on first touch
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT collection_rating_key, collection_title, managed FROM channel_collections "
            "WHERE channel_number=900 AND plex_type='movie'").fetchone()
    assert row["collection_title"] == "TestChan Movies"
    assert row["managed"] == 1


@respx.mock
def test_legacy_link_to_user_collection_is_ignored(auth_client):
    """A pre-existing channel_collections row pointing at the user's own 'Movies'
    collection (rk 777) must be ignored: no DELETE may target rk 777, and a fresh
    owned collection is created instead."""
    _seed_channel_and_assignments(channel_number=901, name="Legacy")
    with main.get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO channel_collections "
            "(channel_number, plex_type, collection_rating_key, collection_title, managed) "
            "VALUES (901, 'movie', '777', 'Movies', 0)")
    router = respx.mock
    # No owned-named collection exists yet -> generator must CREATE one (rk 888).
    _base_plex_routes(router, section_collections=[], children=[])
    create = router.post(f"{PLEX}/library/collections").mock(
        return_value=httpx.Response(201, json={"MediaContainer": {"Metadata": [{"ratingKey": "888"}]}}))
    router.put(url__regex=rf"{PLEX}/library/collections/888/items").mock(
        return_value=httpx.Response(200, json={}))
    user_delete = router.delete(url__regex=rf"{PLEX}/library/collections/777/items").mock(
        return_value=httpx.Response(200, json={}))

    r = auth_client.post("/api/collections/generate/901")
    assert r.status_code == 200, r.text
    assert create.called
    assert not user_delete.called  # the user's collection 777 is never touched
    with main.get_db() as conn:
        row = conn.execute(
            "SELECT collection_rating_key FROM channel_collections "
            "WHERE channel_number=901 AND plex_type='movie'").fetchone()
    assert row["collection_rating_key"] == "888"  # overwritten with the owned collection
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_collections_safety.py -k "first_touch or legacy_link" -v`
Expected: FAIL — current code reads the linked rating key (test 2 would DELETE from 777) and reconciles with removals (test 1 would DELETE 99).

- [ ] **Step 4: Rewrite the per-type block in `generate_collections`**

In `c:\idgvgit\Linearr\main.py`, replace the block from the `for plex_type, keys, section, suffix, type_int in [...]` loop header through the end of that loop body (currently ~lines 1852–1951, i.e. from `for plex_type, keys, section, suffix, type_int in [` up to and including the `result[plex_type] = { ... "total": len(desired_keys), }` dict) with:

```python
        for plex_type, keys, section, type_int in [
            ("movie", movie_keys, movie_section, 1),
            ("show",  show_keys,  show_section,  2),
        ]:
            if not keys or not section:
                continue

            section_id = section["key"]
            coll_name = _owned_collection_name(ch_name, plex_type)

            # 4a. Resolve target ONLY by owned name. Never trust a stored rating key
            # (it may point at one of the user's own collections).
            coll_resp = await client.get(
                f"{url}/library/sections/{section_id}/collections", headers=hdrs,
            )
            collections = []
            if coll_resp.status_code == 200:
                collections = coll_resp.json().get("MediaContainer", {}).get("Metadata", []) or []
            existing = next((c for c in collections if c.get("title") == coll_name), None)

            created = False
            if existing:
                coll_id = str(existing["ratingKey"])
                # Defensive abort: if we somehow resolved a non-owned collection, do not touch it.
                if not _is_owned_title(existing.get("title", ""), ch_name):
                    raise HTTPException(500, f"Refusing to manage non-owned collection: {existing.get('title')}")
            else:
                create_resp = await client.post(
                    f"{url}/library/collections",
                    params={"type": type_int, "title": coll_name, "smart": 0, "sectionId": section_id},
                    headers=hdrs,
                )
                if create_resp.status_code not in (200, 201):
                    raise HTTPException(502, f"Failed to create collection: {coll_name}")
                coll_id = str(create_resp.json()["MediaContainer"]["Metadata"][0]["ratingKey"])
                created = True

            # 4b. Is this collection already managed by Linearr? (fresh-created => owned)
            with get_db() as conn:
                prior = conn.execute(
                    "SELECT collection_rating_key, managed FROM channel_collections "
                    "WHERE channel_number=? AND plex_type=?",
                    (channel_number, plex_type),
                ).fetchone()
            already_managed = bool(
                created
                or (prior and prior["managed"] == 1 and str(prior["collection_rating_key"]) == coll_id)
            )

            # 4c. Current items
            items_resp = await client.get(
                f"{url}/library/collections/{coll_id}/children", headers=hdrs,
            )
            current_keys: set[str] = set()
            if items_resp.status_code == 200:
                for item in items_resp.json().get("MediaContainer", {}).get("Metadata", []) or []:
                    current_keys.add(str(item["ratingKey"]))

            desired_keys = set(keys)
            to_add, to_remove = _collection_delta(desired_keys, current_keys, already_managed)

            # 4d. Apply add
            added = 0
            for rk in to_add:
                uri = f"server://{machine_id}/com.plexapp.plugins.library/library/metadata/{rk}"
                add_resp = await client.put(
                    f"{url}/library/collections/{coll_id}/items", params={"uri": uri}, headers=hdrs,
                )
                if add_resp.status_code in (200, 201):
                    added += 1

            # 4e. Apply remove (always empty on first touch — see _collection_delta)
            removed = 0
            for rk in to_remove:
                del_resp = await client.delete(
                    f"{url}/library/collections/{coll_id}/items", params={"items": rk}, headers=hdrs,
                )
                if del_resp.status_code in (200, 204):
                    removed += 1

            # 4f. Persist as managed (owned collection only)
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO channel_collections
                       (channel_number, plex_type, collection_rating_key, collection_title, managed)
                       VALUES (?, ?, ?, ?, 1)
                       ON CONFLICT(channel_number, plex_type) DO UPDATE SET
                           collection_rating_key=excluded.collection_rating_key,
                           collection_title=excluded.collection_title,
                           managed=1""",
                    (channel_number, plex_type, coll_id, coll_name),
                )

            result[plex_type] = {
                "name": coll_name,
                "created": created,
                "added": added,
                "removed": removed,
                "total": len(desired_keys),
                "additive_only": not already_managed,
            }
```

Also DELETE the now-unused `linked = {...}` load above the loop (the `with get_db() as conn:` block at ~lines 1828–1831 that selects `channel_collections` into `linked`) — the engine no longer reads prior links as targets. Leave the `ch_name`, `movie_keys`, `show_keys`, machine-id and sections fetches intact.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_collections_safety.py -v`
Expected: PASS (all unit + both integration tests).

- [ ] **Step 6: Full backend suite (no regressions)**

Run: `python -m pytest -q`
Expected: PASS (previous 19 + new tests).

- [ ] **Step 7: Commit**

```bash
git add main.py tests/test_collections_safety.py requirements-dev.txt
git commit -m "fix(collections): manage only Linearr-owned collections; additive-only first touch

Resolve the channel's collection only by the owned '{Channel} Movies/TV'
name, never by a stored rating key, so the generator can no longer prune a
user's own collection. First touch of any collection only adds; full
reconcile happens only on collections Linearr already manages. Aborts
without deleting if a resolved collection isn't owned.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend — neuter the conflated link endpoint (assign-only)

**Files:**
- Modify: `c:\idgvgit\Linearr\main.py` — `link_channel_collection` (~lines 1671–1719)
- Test: `c:\idgvgit\Linearr\tests\test_collections_safety.py` (add)

**Interfaces:**
- Consumes: existing `/api/assignments/bulk` semantics (dedupe on conflict).
- Produces: `POST /api/channel-collections/{n}` now ONLY bulk-assigns the picked collection's items to the channel; it does **not** write a `channel_collections` target row. Response: `{"added": int, "skipped": int}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_collections_safety.py`:

```python
@respx.mock
def test_add_from_collection_does_not_set_managed_target(auth_client):
    with main.get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO channels (number, name) VALUES (902, 'AddFrom')")
        conn.execute("DELETE FROM channel_collections WHERE channel_number=902")
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_url', ?)", (PLEX,))
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('plex_token', 'tok')")
    respx.mock.get(f"{PLEX}/library/collections/555/children").mock(
        return_value=httpx.Response(200, json={"MediaContainer": {"Metadata": [
            {"ratingKey": "10", "title": "A", "type": "movie", "year": 2020},
            {"ratingKey": "11", "title": "B", "type": "movie", "year": 2021},
        ]}}))
    r = auth_client.post("/api/channel-collections/902",
                         json={"plex_type": "movie", "collection_rating_key": "555",
                               "collection_title": "User Sci-Fi"})
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body["added"] == 2
    with main.get_db() as conn:
        rows = conn.execute("SELECT * FROM channel_collections WHERE channel_number=902").fetchall()
        assigned = conn.execute("SELECT COUNT(*) c FROM assignments WHERE channel_number=902").fetchone()
    assert len(rows) == 0           # never set a managed target
    assert assigned["c"] == 2        # items were assigned
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_collections_safety.py -k add_from_collection -v`
Expected: FAIL — current endpoint writes a `channel_collections` row (rows != 0).

- [ ] **Step 3: Rewrite `link_channel_collection`**

Replace the body of `link_channel_collection` (`main.py` ~1671–1719) with:

```python
@app.post("/api/channel-collections/{channel_number}", status_code=200)
async def link_channel_collection(channel_number: int, body: ChannelCollectionIn):
    """Add all items from an existing Plex collection to a channel's assignments.

    This is a SOURCE action only: it copies items in. It deliberately does NOT
    mark the picked collection as the channel's managed target — Linearr manages
    its own '{Channel} Movies/TV' collections (see generate_collections), so a
    user's own collection can never be pruned.
    """
    added = 0
    skipped = 0
    url, token = get_plex_config()
    if not token:
        raise HTTPException(400, "Plex token not configured")
    hdrs = plex_headers(token)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{url}/library/collections/{body.collection_rating_key}/children", headers=hdrs,
        )
    if resp.status_code == 200:
        items = resp.json().get("MediaContainer", {}).get("Metadata", []) or []
        with get_db() as conn:
            for m in items:
                t = m.get("type", "")
                if t not in ("movie", "show"):
                    continue
                try:
                    conn.execute(
                        """INSERT INTO assignments
                           (channel_number, plex_rating_key, plex_title, plex_type, plex_thumb, plex_year)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (channel_number, m.get("ratingKey"), m.get("title"), t, m.get("thumb"), m.get("year")),
                    )
                    added += 1
                except sqlite3.IntegrityError:
                    skipped += 1
    _log_app("assignment", f"Added {added} items from collection to ch {channel_number}")
    return {"added": added, "skipped": skipped}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_collections_safety.py -k add_from_collection -v`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_collections_safety.py
git commit -m "fix(collections): make add-from-collection assign-only (no managed target)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — persist Browse view mode + size in the UI store

**Files:**
- Modify: `c:\idgvgit\Linearr\frontend\src\shared\store\ui.store.ts`

**Interfaces:**
- Produces (on `useUIStore`): `browseViewMode: 'wall'|'grid'|'list'`, `setBrowseViewMode(m)`, `browsePosterSize: 'small'|'medium'|'large'`, `setBrowsePosterSize(s)` — both persisted to localStorage like `sidebarCollapsed`.

- [ ] **Step 1: Add persisted keys + helpers**

In `ui.store.ts`, after the `SIDEBAR_COLLAPSED_KEY` block (line ~62–78), add:

```typescript
const BROWSE_VIEW_KEY = 'linearr:browseViewMode'
const BROWSE_SIZE_KEY = 'linearr:browsePosterSize'

type BrowseViewMode = 'wall' | 'grid' | 'list'
type BrowsePosterSize = 'small' | 'medium' | 'large'

function readLS<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Extend the `UIState` interface**

In the `interface UIState { ... }`, add after `setAssignedTypeFilter`:

```typescript
  browseViewMode: BrowseViewMode
  setBrowseViewMode: (mode: BrowseViewMode) => void
  browsePosterSize: BrowsePosterSize
  setBrowsePosterSize: (size: BrowsePosterSize) => void
```

- [ ] **Step 3: Add the store implementation**

In the `create<UIState>((set) => ({ ... }))` body, after `setAssignedTypeFilter: ...` (line ~144), add:

```typescript
  browseViewMode: readLS<BrowseViewMode>(BROWSE_VIEW_KEY, ['wall', 'grid', 'list'], 'wall'),
  setBrowseViewMode: (browseViewMode) => {
    writeLS(BROWSE_VIEW_KEY, browseViewMode)
    set({ browseViewMode })
  },
  browsePosterSize: readLS<BrowsePosterSize>(BROWSE_SIZE_KEY, ['small', 'medium', 'large'], 'medium'),
  setBrowsePosterSize: (browsePosterSize) => {
    writeLS(BROWSE_SIZE_KEY, browsePosterSize)
    set({ browsePosterSize })
  },
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/store/ui.store.ts
git commit -m "feat(browse): persist Browse view mode + poster size in UI store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — add `wall` mode to PosterGrid

**Files:**
- Modify: `c:\idgvgit\Linearr\frontend\src\features\plex\components\PosterGrid.tsx`

**Interfaces:**
- Consumes: `PlexItem`, `Assignment` (unchanged props).
- Produces: `export type PosterViewMode = 'wall' | 'grid' | 'list'`. `wall` renders poster-only tiles (no caption), denser columns than `grid`, with the hover assign overlay + green-dot assigned marker and `title` tooltip; clicking the poster opens detail.

- [ ] **Step 1: Widen the type and add wall column map**

Replace lines 5–13 (`export type PosterViewMode ...` through the `GRID_COLS` object) with:

```typescript
export type PosterViewMode = 'wall' | 'grid' | 'list'
export type PosterSize = 'small' | 'medium' | 'large'

// Grid column counts per poster size — static strings so Tailwind keeps them.
const GRID_COLS: Record<PosterSize, string> = {
  small: 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8',
  medium: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6',
  large: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
}

// Poster-wall is denser than grid at every size (no caption row).
const WALL_COLS: Record<PosterSize, string> = {
  small: 'grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-[repeat(14,minmax(0,1fr))]',
  medium: 'grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12',
  large: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8',
}
```

- [ ] **Step 2: Add the wall renderer**

In `PosterGrid.tsx`, immediately before the final `return (` for the grid view (the `return ( <div className={`grid ${GRID_COLS[posterSize]} ...`} ...` near line 149), add a dedicated wall branch:

```typescript
  if (viewMode === 'wall') {
    return (
      <div className={`grid ${WALL_COLS[posterSize]} gap-1.5 p-3`}>
        {items.map((item) => {
          const isAssigned = assignedKeys.has(item.rating_key)
          const assignment = assignments.find((a) => a.plex_rating_key === item.rating_key)
          return (
            <div
              key={item.rating_key}
              title={`${item.title}${item.year ? ` (${item.year})` : ''}`}
              className={`group relative aspect-[2/3] rounded overflow-hidden border ${
                isAssigned ? 'border-emerald-500' : 'border-slate-700 hover:border-slate-500'
              }`}
            >
              <div
                className="absolute inset-0 bg-slate-900 cursor-pointer"
                onClick={() => onDetail?.(item.rating_key)}
              >
                {item.thumb ? (
                  <PlexThumb path={item.thumb} alt={item.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-700 text-[10px] px-1 text-center">
                    {item.title}
                  </div>
                )}
              </div>
              {isAssigned && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center shadow">
                  <svg className="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2">
                {isAssigned && assignment ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onUnassign(assignment.id) }}
                    className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] rounded font-medium"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAssign(item) }}
                    className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] rounded font-medium"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Build (Tailwind picks up new classes)**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/plex/components/PosterGrid.tsx
git commit -m "feat(browse): add dense poster-wall view mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — slim single-row toolbar + 3-way view selector + Collection source + Add all

**Files:**
- Modify: `c:\idgvgit\Linearr\frontend\src\features\plex\components\PlexBrowser.tsx`

**Interfaces:**
- Consumes: `useUIStore` browse mode/size (Task 4); `PosterViewMode` incl. `'wall'` (Task 5); `usePlexCollections`, `usePlexCollectionItems` (existing); `useBulkAssign` (existing); `PlexItem`.
- Produces: a Browse view whose controls fit one sticky row (filters in a popover), with a `Library | Collection` source toggle and, when a collection is the source, an "Add all N" button that bulk-assigns the collection's items.

- [ ] **Step 1: Replace the PlexBrowser implementation**

Replace the entire contents of `c:\idgvgit\Linearr\frontend\src\features\plex\components\PlexBrowser.tsx` with:

```tsx
import { useState, useMemo } from 'react'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useUIStore } from '@/shared/store/ui.store'
import { useAssignments, useAssign, useUnassign, useBulkAssign } from '@/features/assignments/hooks'
import {
  usePlexLibraries,
  usePlexLibraryItems,
  usePlexSearch,
  usePlexLibraryFilters,
  usePlexCollections,
  usePlexCollectionItems,
} from '@/features/plex/hooks'
import { PosterGrid } from './PosterGrid'
import type { PosterViewMode, PosterSize } from './PosterGrid'
import type { PlexItem } from '@/shared/types'

type TypeFilter = 'all' | 'show' | 'movie'
type Source = 'library' | 'collection'

interface PlexBrowserProps {
  channelNumber: number
}

export function PlexBrowser({ channelNumber }: PlexBrowserProps) {
  const openModal = useUIStore((s) => s.openModal)
  const viewMode = useUIStore((s) => s.browseViewMode)
  const setViewMode = useUIStore((s) => s.setBrowseViewMode)
  const posterSize = useUIStore((s) => s.browsePosterSize)
  const setPosterSize = useUIStore((s) => s.setBrowsePosterSize)

  const [source, setSource] = useState<Source>('library')
  const [selectedLibrary, setSelectedLibrary] = useState('')
  const [loadLibrary, setLoadLibrary] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [genreFilter, setGenreFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [ratingFilter, setRatingFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const debouncedSearch = useDebounce(searchInput, 400)
  const isSearching = debouncedSearch.trim().length > 0

  const { data: libraries = [], isLoading: librariesLoading } = usePlexLibraries()
  const { data: collections = [] } = usePlexCollections()

  const searchTypeParam = typeFilter === 'all' ? undefined : typeFilter
  const { data: searchResults = [], isFetching: searchFetching } = usePlexSearch(
    debouncedSearch,
    searchTypeParam,
    isSearching,
  )

  const { data: filterOptions } = usePlexLibraryFilters(selectedLibrary)

  const libraryFilters = useMemo(() => {
    const f: Record<string, string | number> = {}
    if (genreFilter) f.genre = genreFilter
    if (yearFilter) f.year = Number(yearFilter)
    if (ratingFilter) f.content_rating = ratingFilter
    return Object.keys(f).length > 0 ? f : undefined
  }, [genreFilter, yearFilter, ratingFilter])

  const { data: libraryItems = [], isFetching: libraryFetching } = usePlexLibraryItems(
    selectedLibrary,
    source === 'library' && loadLibrary && !isSearching,
    libraryFilters as { genre?: string; year?: number; content_rating?: string } | undefined,
  )

  const { data: collectionItems = [], isFetching: collectionFetching } = usePlexCollectionItems(
    source === 'collection' ? selectedCollection : '',
  )

  const { data: assignmentsMap = {} } = useAssignments()
  const assign = useAssign()
  const unassign = useUnassign()
  const bulkAssign = useBulkAssign()

  const channelAssignments = assignmentsMap[channelNumber] ?? []
  const assignedKeys = useMemo(
    () => new Set(channelAssignments.map((a) => a.plex_rating_key)),
    [channelAssignments],
  )

  const rawItems: PlexItem[] = isSearching
    ? searchResults
    : source === 'collection'
      ? collectionItems
      : loadLibrary
        ? libraryItems
        : []
  const filteredItems = useMemo(
    () => (typeFilter === 'all' ? rawItems : rawItems.filter((i) => i.type === typeFilter)),
    [rawItems, typeFilter],
  )

  const isLoading = isSearching
    ? searchFetching
    : source === 'collection'
      ? collectionFetching
      : libraryFetching

  const activeFilterCount = [genreFilter, yearFilter, ratingFilter].filter(Boolean).length

  function handleAssign(item: PlexItem) {
    assign.mutate({
      channel_number: channelNumber,
      plex_rating_key: item.rating_key,
      plex_title: item.title,
      plex_type: item.type,
      plex_thumb: item.thumb,
      plex_year: item.year,
    })
  }

  function handleUnassign(id: number) {
    unassign.mutate({ id, channelNumber })
  }

  function handleAddAll() {
    const items = filteredItems
      .filter((i) => !assignedKeys.has(i.rating_key))
      .map((i) => ({
        plex_rating_key: i.rating_key,
        plex_title: i.title,
        plex_type: i.type,
        plex_thumb: i.thumb,
        plex_year: i.year,
      }))
    if (items.length > 0) bulkAssign.mutate({ channelNumber, items })
  }

  function handleDetail(ratingKey: string) {
    openModal('itemDetail', { itemDetailRatingKey: ratingKey })
  }

  const unassignedCount = filteredItems.filter((i) => !assignedKeys.has(i.rating_key)).length

  return (
    <div className="flex flex-col h-full">
      {/* Slim sticky toolbar */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-3 py-2 flex items-center gap-2 flex-wrap">
        {/* Source toggle */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['library', 'collection'] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                source === s ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'library' ? 'Library' : 'Collection'}
            </button>
          ))}
        </div>

        {/* Source picker */}
        {source === 'library' ? (
          <>
            <select
              value={selectedLibrary}
              onChange={(e) => {
                setSelectedLibrary(e.target.value)
                setLoadLibrary(false)
                setGenreFilter('')
                setYearFilter('')
                setRatingFilter('')
              }}
              disabled={librariesLoading}
              aria-label="Plex library"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
            >
              <option value="">Select library…</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => setLoadLibrary(true)}
              disabled={!selectedLibrary || isSearching}
              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs rounded-lg whitespace-nowrap"
            >
              Browse
            </button>
          </>
        ) : (
          <>
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              aria-label="Plex collection"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 max-w-[14rem]"
            >
              <option value="">Select collection…</option>
              {collections.map((c) => (
                <option key={c.rating_key} value={c.rating_key}>
                  {c.title} ({c.child_count ?? 0})
                </option>
              ))}
            </select>
            <button
              onClick={handleAddAll}
              disabled={!selectedCollection || unassignedCount === 0 || bulkAssign.isPending}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs rounded-lg whitespace-nowrap"
            >
              Add all {unassignedCount > 0 ? unassignedCount : ''}
            </button>
          </>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[8rem]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            aria-label="Search Plex"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </div>

        {/* Type filter */}
        <div className="flex gap-0.5">
          {(['all', 'show', 'movie'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                typeFilter === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {t === 'all' ? 'All' : t === 'show' ? 'TV' : 'Movies'}
            </button>
          ))}
        </div>

        {/* View mode */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['wall', 'grid', 'list'] as PosterViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m}
              className={`px-2 py-1 text-xs rounded-md capitalize transition-colors ${
                viewMode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Size */}
        <div className="flex gap-0.5 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
          {(['small', 'medium', 'large'] as PosterSize[]).map((s) => (
            <button
              key={s}
              onClick={() => setPosterSize(s)}
              title={s}
              className={`px-1.5 py-1 text-xs rounded-md transition-colors ${
                posterSize === s ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {s.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>

        {/* Filters popover (library only) */}
        {source === 'library' && selectedLibrary && filterOptions && (
          <div className="relative">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className="px-2.5 py-1 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 mt-1 z-20 bg-slate-900 border border-slate-700 rounded-lg p-2 flex flex-col gap-2 shadow-xl">
                {filterOptions.genres.length > 0 && (
                  <select
                    value={genreFilter}
                    onChange={(e) => { setGenreFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Genre"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Genres</option>
                    {filterOptions.genres.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                )}
                {filterOptions.years.length > 0 && (
                  <select
                    value={yearFilter}
                    onChange={(e) => { setYearFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Year"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Years</option>
                    {filterOptions.years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                {filterOptions.content_ratings.length > 0 && (
                  <select
                    value={ratingFilter}
                    onChange={(e) => { setRatingFilter(e.target.value); setLoadLibrary(true) }}
                    aria-label="Content rating"
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">All Ratings</option>
                    {filterOptions.content_ratings.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setGenreFilter(''); setYearFilter(''); setRatingFilter(''); setLoadLibrary(true) }}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        {!isSearching && source === 'library' && !loadLibrary ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <p>Pick a library and hit Browse, search, or switch to Collection.</p>
          </div>
        ) : !isSearching && source === 'collection' && !selectedCollection ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <p>Pick a collection to preview its items, then "Add all".</p>
          </div>
        ) : (
          <PosterGrid
            items={filteredItems}
            assignedKeys={assignedKeys}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
            assignments={channelAssignments}
            onDetail={handleDetail}
            loading={isLoading}
            viewMode={viewMode}
            posterSize={posterSize}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Confirm the `PlexCollection` type fields used exist**

Run: `cd frontend && npm run typecheck`
Expected: PASS. If `child_count` or `rating_key` are not on `PlexCollection` in `@/shared/types`, open `frontend/src/shared/types/index.ts`, find the `PlexCollection` interface, and use the actual field names (e.g. `childCount`/`ratingKey`) in the `<option>` map above. Re-run typecheck until clean. (Do not invent fields — match the type.)

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/plex/components/PlexBrowser.tsx
git commit -m "feat(browse): slim toolbar, 3-way view, collection source with Add all

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — ContentTab entry points + remove stale link UI

**Files:**
- Modify: `c:\idgvgit\Linearr\frontend\src\features\content\components\ContentTab.tsx`
- Read first: `c:\idgvgit\Linearr\frontend\src\features\collections\components\CollectionPickerModal.tsx`

**Interfaces:**
- Consumes: the Collection source in `PlexBrowser` (Task 6).
- Produces: ContentTab no longer exposes a "Link collection (sets managed target)" action; instead it points users at the Collection source in Browse. Existing "Build collections" / status UI stays.

- [ ] **Step 1: Read the current ContentTab + modal**

Run (read, don't edit yet):
- `frontend/src/features/content/components/ContentTab.tsx`
- `frontend/src/features/collections/components/CollectionPickerModal.tsx`

Identify the "Link" buttons (they call `openModal('collectionPicker', ...)`) and the `useLinkCollection` usage.

- [ ] **Step 2: Repoint the "Link" buttons to the Browse Collection source**

In `ContentTab.tsx`, change each "Link" button label to **"Add from collection"** and its `onClick` to switch the active content sub-tab to "Browse Plex" (the same sub-tab that renders `PlexBrowser`). If ContentTab tracks the sub-tab via local state, set it to the browse tab; if `PlexBrowser` is always mounted in the Browse sub-tab, simply switching to that sub-tab is enough — the user then picks the collection from the new Collection source. Remove the `useLinkCollection` import/usage and the `collectionPicker` modal trigger if it is now unused.

Concretely, replace a button like:

```tsx
<button onClick={() => openModal('collectionPicker', { collectionPickerType: 'movie' })}>
  Link
</button>
```

with:

```tsx
<button
  onClick={() => setActiveSubTab('browse')}
  className="text-xs text-indigo-400 hover:text-indigo-300"
  title="Add a whole collection from the Browse tab's Collection source"
>
  Add from collection
</button>
```

(Use ContentTab's actual sub-tab setter/value — match the existing names in the file.)

- [ ] **Step 3: Delete `CollectionPickerModal` only if now unused**

Search for remaining references:

Run: `cd frontend && npx --no-install grep -r "CollectionPickerModal\|collectionPicker\|useLinkCollection" src || rg "CollectionPickerModal|collectionPicker|useLinkCollection" src`

If there are **no** remaining usages, delete `frontend/src/features/collections/components/CollectionPickerModal.tsx` and remove its render site (likely in a modals barrel / `App.tsx`) and the `collectionPicker` entry from `ui.store.ts` `defaultModals` + `ModalName`. If it is still referenced elsewhere, leave it and just stop using it from ContentTab. Do not leave dangling imports.

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: PASS, build succeeds. Fix any dangling imports the change surfaced.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "refactor(content): replace collection 'Link' with Browse Collection source

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend — clarify the "Build collections" wording

**Files:**
- Modify: `c:\idgvgit\Linearr\frontend\src\features\collections\hooks.ts` (toast copy) and the button/help text where Build is triggered (find via grep below).

**Interfaces:**
- Consumes: `useGenerateCollections` (existing). No API changes.

- [ ] **Step 1: Find the Build trigger UI**

Run: `cd frontend && rg "useGenerateCollections|Generate collections|generate" src/features`

- [ ] **Step 2: Update the button + add a one-line reassurance**

Wherever the Build/Generate button renders, set its label to **"Build collections"** and add helper text near it:

```tsx
<p className="text-xs text-slate-500 mt-1">
  Builds Linearr's own “{'{'}channel{'}'} Movies / TV” collections from the assigned items and syncs them to Plex + Tunarr. Your own collections are never modified.
</p>
```

(Use the channel name if readily available; the literal copy above is acceptable.)

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "docs(ui): clarify Build collections only manages Linearr-owned collections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Backend tests**

Run: `python -m pytest -q`
Expected: all pass (19 prior + collection-safety tests).

- [ ] **Step 2: Frontend typecheck + build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Manual smoke (document results in the PR)**

With a real Plex connected (or staging):
1. Browse view: switch wall/grid/list and S/M/L — denser layout, choice persists after reload.
2. Library source: Browse a library, add a few items (one-click) in each mode.
3. Collection source: pick a collection → items preview in the grid → "Add all N" → assignments increase; the source collection in Plex is unchanged.
4. Build collections on the channel: confirm Plex now has `"{Channel} Movies"` / `"{Channel} TV"` with exactly the assigned items; your own collections are untouched.
5. Tunarr (if linked): smart collection mirrors the owned collection.

- [ ] **Step 4: Final commit (if any verification fixups)**

```bash
git add -A
git commit -m "test: verification fixups for browse + safe collections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Three switchable density modes → Tasks 4, 5, 6 ✓
- Slim toolbar + filters tucked away → Task 6 ✓
- Add movies/shows one-click → existing, preserved in all modes (Task 5/6) ✓
- Add whole collection with preview → Task 6 (Collection source + Add all) ✓
- Source collection read-only → Task 3 (assign-only) + Task 6 (bulk assign, no target write) ✓
- Linearr-owned `{Channel} Movies/TV` only → Task 2 ✓
- Additive-only first touch + abort guard → Tasks 1, 2 ✓
- Legacy link ignored, not pruned → Task 2 (integration test) ✓
- Tunarr mirrors owned collections → unchanged behavior, owned rows feed it (Task 2 leaves the Tunarr block intact) ✓
- Tests → Tasks 1, 2, 3 ✓

**Placeholder scan:** none — every code step has concrete content; the one explicit "match the actual field name" note (Task 6 Step 2, Task 7 Step 2) is a guarded instruction, not a placeholder.

**Type consistency:** `PosterViewMode = 'wall'|'grid'|'list'` defined in Task 5 and consumed in Tasks 4/6; `browseViewMode`/`browsePosterSize` defined in Task 4 and consumed in Task 6; `_owned_collection_name`/`_collection_delta`/`_is_owned_title` defined in Task 1 and consumed in Task 2; `link_channel_collection` response `{added, skipped}` (Task 3) matches its test.
