"""Channel reorder / renumber.

`channels.number` is the PRIMARY KEY and six tables reference it *by value with
no foreign keys*, so a reorder is a multi-row primary-key mutation. This file is
split in two halves matching the two build steps:

  Part 1 — `TIER_RANGES` + `_compute_reorder`: pure math, no DB, no HTTP.
  Part 2 — `POST /api/channels/reorder`: the transactional two-phase renumber,
           the shared `_CHANNEL_REF_TABLES` cascade, and Tunarr propagation.
"""
import itertools
import json
import sqlite3

import httpx
import pytest

import main


# ── Fixtures / helpers for the pure-logic half ────────────────────────────────

def _ch(number: int, tier: str, name: str | None = None) -> dict:
    return {"number": number, "tier": tier, "name": name or f"CH{number}"}


# A deliberately gappy, multi-tier lineup.
LINEUP = [
    _ch(100, "Galaxy Main"),
    _ch(105, "Galaxy Main"),
    _ch(112, "Galaxy Main"),
    _ch(120, "Classics"),
    _ch(121, "Classics"),
    _ch(140, "Galaxy Premium"),
    _ch(155, "Galaxy Premium"),
]


def _apply(lineup: list[dict], mapping: dict[int, tuple[int, str]]) -> list[dict]:
    """Project a mapping onto a lineup and return the resulting lineup, sorted
    by the new number."""
    out = []
    for c in lineup:
        new_number, new_tier = mapping.get(c["number"], (c["number"], c["tier"]))
        out.append({**c, "number": new_number, "tier": new_tier})
    return sorted(out, key=lambda c: c["number"])


def _assert_collision_free(lineup: list[dict], mapping: dict[int, tuple[int, str]]) -> list[dict]:
    """The invariant that matters most: the mapping can never produce a
    duplicate primary key. Returns the resulting lineup."""
    new_numbers = [v[0] for v in mapping.values()]
    assert len(set(new_numbers)) == len(new_numbers), f"two channels share a new number: {mapping}"

    unmoved = {c["number"] for c in lineup} - set(mapping)
    clash = set(new_numbers) & unmoved
    assert not clash, f"new number(s) {clash} collide with an unmoved channel: {mapping}"

    result = _apply(lineup, mapping)
    numbers = [c["number"] for c in result]
    assert len(set(numbers)) == len(numbers), f"resulting lineup has duplicates: {numbers}"
    return result


def _names(lineup: list[dict]) -> list[str]:
    return [c["name"] for c in lineup]


# ══════════════════════════════════════════════════════════════════════════════
# Part 1 — TIER_RANGES + _compute_reorder (pure logic)
# ══════════════════════════════════════════════════════════════════════════════

def test_tier_ranges_mirror_the_frontend_preset():
    # Must match frontend/src/features/channels/presets/numbering.ts exactly.
    assert main.TIER_RANGES == {
        "Galaxy Main": (100, 119),
        "Classics": (120, 139),
        "Galaxy Premium": (140, 159),
    }


def test_compute_reorder_is_pure_no_db(monkeypatch):
    """No I/O: blow up if anything reaches for the database."""
    def _boom(*a, **kw):
        raise AssertionError("_compute_reorder must not touch the database")

    monkeypatch.setattr(main, "get_db", _boom)
    mapping = main._compute_reorder(LINEUP, 100, 3, None)
    assert mapping  # it really did compute something


def test_compute_reorder_does_not_mutate_input():
    before = [dict(c) for c in LINEUP]
    main._compute_reorder(LINEUP, 155, 0, "Galaxy Main")
    assert LINEUP == before


def test_noop_move_returns_empty_mapping():
    # 112 already sits at index 2.
    assert main._compute_reorder(LINEUP, 112, 2, None) == {}


def test_noop_move_with_explicit_same_tier_returns_empty_mapping():
    assert main._compute_reorder(LINEUP, 112, 2, "Galaxy Main") == {}


def test_unknown_moved_number_raises():
    with pytest.raises(ValueError):
        main._compute_reorder(LINEUP, 999, 0, None)


def test_move_down_rotates_numbers_and_preserves_gaps():
    # Move 100 (index 0) down to index 2.
    mapping = main._compute_reorder(LINEUP, 100, 2, None)
    result = _assert_collision_free(LINEUP, mapping)

    # The window's number sequence is untouched — only who holds each number.
    assert mapping == {
        105: (100, "Galaxy Main"),
        112: (105, "Galaxy Main"),
        100: (112, "Galaxy Main"),
    }
    assert _names(result) == ["CH105", "CH112", "CH100", "CH120", "CH121", "CH140", "CH155"]
    # Gaps preserved: the multiset of numbers in the lineup is unchanged.
    assert [c["number"] for c in result] == [100, 105, 112, 120, 121, 140, 155]


def test_move_up_rotates_numbers_and_preserves_gaps():
    # Move 112 (index 2) up to index 0.
    mapping = main._compute_reorder(LINEUP, 112, 0, None)
    result = _assert_collision_free(LINEUP, mapping)
    assert mapping == {
        112: (100, "Galaxy Main"),
        100: (105, "Galaxy Main"),
        105: (112, "Galaxy Main"),
    }
    assert _names(result) == ["CH112", "CH100", "CH105", "CH120", "CH121", "CH140", "CH155"]


def test_same_tier_move_changes_only_channels_in_the_window():
    # Move 105 (index 1) to index 3 — 100, 140 and 155 must be untouched.
    mapping = main._compute_reorder(LINEUP, 105, 3, None)
    _assert_collision_free(LINEUP, mapping)
    assert set(mapping) == {105, 112, 120}
    assert 100 not in mapping and 140 not in mapping and 155 not in mapping


def test_move_to_end_and_to_front():
    end = main._compute_reorder(LINEUP, 100, len(LINEUP) - 1, None)
    result = _assert_collision_free(LINEUP, end)
    assert _names(result)[-1] == "CH100"

    front = main._compute_reorder(LINEUP, 155, 0, None)
    result = _assert_collision_free(LINEUP, front)
    assert _names(result)[0] == "CH155"


def test_target_index_is_clamped():
    assert main._compute_reorder(LINEUP, 100, -50, None) == {}          # already first
    huge = main._compute_reorder(LINEUP, 100, 9999, None)
    assert _names(_assert_collision_free(LINEUP, huge))[-1] == "CH100"


# ── Cross-tier ────────────────────────────────────────────────────────────────

def test_cross_tier_move_reassigns_tier_and_number_inside_range():
    # Drag 105 (Galaxy Main) down into the Classics block, after 120.
    mapping = main._compute_reorder(LINEUP, 105, 3, "Classics")
    result = _assert_collision_free(LINEUP, mapping)

    new_number, new_tier = mapping[105]
    assert new_tier == "Classics"
    low, high = main.TIER_RANGES["Classics"]
    assert low <= new_number <= high
    moved = next(c for c in result if c["name"] == "CH105")
    assert moved["tier"] == "Classics"


def test_cross_tier_move_into_empty_tier_takes_the_range_floor():
    lineup = [_ch(100, "Galaxy Main"), _ch(101, "Galaxy Main"), _ch(102, "Galaxy Main")]
    mapping = main._compute_reorder(lineup, 101, 2, "Galaxy Premium")
    _assert_collision_free(lineup, mapping)
    assert mapping == {101: (140, "Galaxy Premium")}


def test_cross_tier_move_bumps_the_contiguous_run_when_the_slot_is_taken():
    lineup = [
        _ch(100, "Galaxy Main"),
        _ch(120, "Classics"),
        _ch(121, "Classics"),
        _ch(122, "Classics"),
        _ch(130, "Classics"),
    ]
    # Land 100 at index 1, i.e. right after 120 -> wants 121, which is taken.
    mapping = main._compute_reorder(lineup, 100, 1, "Classics")
    result = _assert_collision_free(lineup, mapping)
    assert mapping[100] == (121, "Classics")
    # 121 and 122 bump by one; 130 has enough headroom and stays put.
    assert mapping[121] == (122, "Classics")
    assert mapping[122] == (123, "Classics")
    assert 130 not in mapping
    assert _names(result) == ["CH120", "CH100", "CH121", "CH122", "CH130"]


def test_cross_tier_move_into_a_full_range_extends_past_it():
    low, high = main.TIER_RANGES["Galaxy Premium"]
    lineup = [_ch(120, "Classics")] + [_ch(n, "Galaxy Premium") for n in range(low, high + 1)]
    mapping = main._compute_reorder(lineup, 120, len(lineup) - 1, "Galaxy Premium")
    result = _assert_collision_free(lineup, mapping)
    new_number, new_tier = mapping[120]
    assert new_tier == "Galaxy Premium"
    assert new_number > high        # extended past the range rather than raising
    assert _names(result)[-1] == "CH120"


def test_cross_tier_move_into_a_full_range_midway_shifts_without_duplicates():
    low, high = main.TIER_RANGES["Galaxy Premium"]
    lineup = [_ch(120, "Classics")] + [_ch(n, "Galaxy Premium") for n in range(low, high + 1)]
    mapping = main._compute_reorder(lineup, 120, 5, "Galaxy Premium")
    result = _assert_collision_free(lineup, mapping)
    assert mapping[120][1] == "Galaxy Premium"
    assert max(c["number"] for c in result) == high + 1


def test_unknown_target_tier_does_not_raise():
    mapping = main._compute_reorder(LINEUP, 100, 4, "Totally Made Up Tier")
    _assert_collision_free(LINEUP, mapping)
    assert mapping[100][1] == "Totally Made Up Tier"


def test_channels_in_unknown_tiers_are_handled():
    lineup = [_ch(1, "Weird"), _ch(2, "Weird"), _ch(300, "Also Weird")]
    mapping = main._compute_reorder(lineup, 300, 0, None)
    _assert_collision_free(lineup, mapping)
    assert _names(_apply(lineup, mapping))[0] == "CH300"


def test_tier_only_change_is_reported_even_without_a_number_change():
    mapping = main._compute_reorder(LINEUP, 112, 2, "Totally Made Up Tier")
    assert mapping == {112: (112, "Totally Made Up Tier")}


# ── Exhaustive invariant sweep ────────────────────────────────────────────────

SWEEP_TIERS = [None, "Galaxy Main", "Classics", "Galaxy Premium", "Unlisted Tier"]


@pytest.mark.parametrize(
    "moved,index,tier",
    [
        (c["number"], i, t)
        for c, i, t in itertools.product(LINEUP, range(len(LINEUP)), SWEEP_TIERS)
    ],
)
def test_sweep_every_move_is_collision_free(moved, index, tier):
    mapping = main._compute_reorder(LINEUP, moved, index, tier)
    result = _assert_collision_free(LINEUP, mapping)

    # Every channel survives exactly once.
    assert sorted(_names(result)) == sorted(_names(LINEUP))

    if tier is not None:
        moved_row = next(c for c in result if c["name"] == f"CH{moved}")
        assert moved_row["tier"] == tier

    # Nothing but the moved channel may change tier.
    for old in LINEUP:
        if old["number"] == moved:
            continue
        new_number, new_tier = mapping.get(old["number"], (old["number"], old["tier"]))
        assert new_tier == old["tier"]


@pytest.mark.parametrize("tier", ["Galaxy Main", "Classics", "Galaxy Premium"])
@pytest.mark.parametrize("index", range(len(LINEUP)))
def test_sweep_cross_tier_lands_inside_the_destination_range(tier, index):
    low, high = main.TIER_RANGES[tier]
    for c in LINEUP:
        if c["tier"] == tier:
            continue  # same-tier moves are positional, not range-driven
        mapping = main._compute_reorder(LINEUP, c["number"], index, tier)
        _assert_collision_free(LINEUP, mapping)
        new_number, new_tier = mapping[c["number"]]
        assert new_tier == tier
        assert low <= new_number <= high, (
            f"moving CH{c['number']} to index {index} of {tier} gave {new_number}"
        )


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
# Part 2 â€” POST /api/channels/reorder (transactional two-phase renumber)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

# Channel numbers live in the 7xxx range so nothing here collides with the other
# test files sharing the session-scoped SQLite file.

def _clear_channel(number: int) -> None:
    with main.get_db() as conn:
        conn.execute("DELETE FROM channels WHERE number=?", (number,))
        for table in ("assignments", "blocks", "channel_collections",
                      "tunarr_channel_links", "tunarr_collection_links", "ai_logs"):
            conn.execute(f"DELETE FROM {table} WHERE channel_number=?", (number,))


def _seed_full_channel(number: int, tier: str = "Galaxy Main") -> None:
    """Seed a channel plus one identifiable row in every referencing table.

    Each row carries the ORIGINAL number in a marker column, so after a
    renumber we can prove the row followed rather than merely that a row of the
    right shape exists.
    """
    _clear_channel(number)
    with main.get_db() as conn:
        conn.execute(
            "INSERT INTO channels (number, name, tier) VALUES (?,?,?)",
            (number, f"CH{number}", tier),
        )
        conn.execute(
            "INSERT INTO assignments (channel_number, plex_rating_key, plex_title, plex_type)"
            " VALUES (?,?,?,?)",
            (number, f"rk-{number}", f"Item {number}", "movie"),
        )
        conn.execute("INSERT INTO blocks (name, channel_number) VALUES (?,?)",
                     (f"block-{number}", number))
        conn.execute(
            "INSERT INTO channel_collections (channel_number, plex_type,"
            " collection_rating_key, collection_title) VALUES (?,?,?,?)",
            (number, "movie", f"coll-{number}", f"Coll {number}"),
        )
        conn.execute("INSERT INTO tunarr_channel_links VALUES (?,?,?,?)",
                     (number, f"tid-{number}", f"CH{number}", number))
        conn.execute("INSERT INTO tunarr_collection_links VALUES (?,?,?,?)",
                     (number, "movie", f"tcoll-{number}", f"TColl {number}"))
        conn.execute("INSERT INTO ai_logs (channel_number, model) VALUES (?,?)",
                     (number, f"model-{number}"))


_MARKER_COLUMNS = {
    "assignments": "plex_rating_key",
    "blocks": "name",
    "channel_collections": "collection_rating_key",
    "tunarr_channel_links": "tunarr_id",
    "tunarr_collection_links": "tunarr_collection_id",
    "ai_logs": "model",
}


def _markers_at(number: int) -> dict[str, list[str]]:
    """Marker values currently filed under `channel_number = number`, per table."""
    with main.get_db() as conn:
        return {
            table: sorted(
                r[0] for r in conn.execute(
                    f"SELECT {col} FROM {table} WHERE channel_number=?", (number,)
                )
            )
            for table, col in _MARKER_COLUMNS.items()
        }


def _expected_markers(original: int) -> dict[str, list[str]]:
    return {
        "assignments": [f"rk-{original}"],
        "blocks": [f"block-{original}"],
        "channel_collections": [f"coll-{original}"],
        "tunarr_channel_links": [f"tid-{original}"],
        "tunarr_collection_links": [f"tcoll-{original}"],
        "ai_logs": [f"model-{original}"],
    }


def _lineup(auth_client) -> list[dict]:
    r = auth_client.get("/api/channels")
    assert r.status_code == 200, r.text
    return r.json()


def _index_of(auth_client, number: int) -> int:
    """Index of a channel in the live lineup. Computed rather than hard-coded
    because the session DB carries channels seeded by other test files."""
    return next(i for i, c in enumerate(_lineup(auth_client)) if c["number"] == number)


def _numbers(auth_client) -> list[int]:
    return [c["number"] for c in _lineup(auth_client)]


@pytest.fixture()
def no_tunarr(monkeypatch):
    """An unconfigured Tunarr â€” the reorder must skip propagation entirely
    instead of reporting a failure per changed channel."""
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "")


# â”€â”€ Shared cascade constant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_channel_ref_tables_lists_all_six_including_ai_logs():
    assert set(main._CHANNEL_REF_TABLES) == {
        "assignments",
        "blocks",
        "channel_collections",
        "tunarr_channel_links",
        "tunarr_collection_links",
        "ai_logs",
    }
    assert len(main._CHANNEL_REF_TABLES) == 6


# â”€â”€ Why the write has to be two-phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_single_phase_sequential_update_collides(client):
    """The hazard the two-phase write exists to avoid: the moment two channels
    transiently share a number, the PRIMARY KEY rejects the write."""
    _seed_full_channel(7601)
    _seed_full_channel(7602)
    with pytest.raises(sqlite3.IntegrityError):
        with main.get_db() as conn:
            conn.execute("UPDATE channels SET number=7602 WHERE number=7601")
    # ...and the failed transaction left both rows alone.
    with main.get_db() as conn:
        got = [r[0] for r in conn.execute(
            "SELECT number FROM channels WHERE number IN (7601, 7602) ORDER BY number")]
    assert got == [7601, 7602]


def test_two_phase_renumber_survives_a_full_reversal(client):
    """Worst case: every channel takes another channel's number, in a permutation
    with no safe starting point. Only a park-then-write pass survives."""
    originals = [7501, 7502, 7503, 7504]
    for n in originals:
        _seed_full_channel(n)
    before = {n: _expected_markers(n) for n in originals}

    # Full reversal: 7501<->7504, 7502<->7503.
    mapping = {
        7501: (7504, "Galaxy Main"),
        7502: (7503, "Galaxy Main"),
        7503: (7502, "Galaxy Main"),
        7504: (7501, "Galaxy Main"),
    }
    with main.get_db() as conn:
        main._renumber_channels(conn, mapping)

    with main.get_db() as conn:
        names = {r["number"]: r["name"] for r in conn.execute(
            "SELECT number, name FROM channels WHERE number IN (7501,7502,7503,7504)")}
    assert names == {7504: "CH7501", 7503: "CH7502", 7502: "CH7503", 7501: "CH7504"}

    # Every referencing row followed its channel across the reversal.
    for old, (new, _tier) in mapping.items():
        assert _markers_at(new) == before[old], f"refs for {old} did not follow to {new}"

    # No temporary parking number survived the commit.
    with main.get_db() as conn:
        leftovers = conn.execute("SELECT COUNT(*) FROM channels WHERE number < 0").fetchone()[0]
    assert leftovers == 0


def test_renumber_leaves_no_parked_rows_in_referencing_tables(client):
    _seed_full_channel(7511)
    _seed_full_channel(7512)
    with main.get_db() as conn:
        main._renumber_channels(conn, {7511: (7512, "Galaxy Main"), 7512: (7511, "Galaxy Main")})
    with main.get_db() as conn:
        for table in main._CHANNEL_REF_TABLES:
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE channel_number < 0").fetchone()[0]
            assert n == 0, f"{table} still holds parked rows"


def test_renumber_writes_the_new_tier(client):
    _seed_full_channel(7521, tier="Galaxy Main")
    with main.get_db() as conn:
        main._renumber_channels(conn, {7521: (7522, "Classics")})
    with main.get_db() as conn:
        row = conn.execute("SELECT * FROM channels WHERE number=7522").fetchone()
    assert row["name"] == "CH7521"
    assert row["tier"] == "Classics"
    _clear_channel(7522)


# â”€â”€ The endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_reorder_requires_auth(client):
    r = client.post("/api/channels/reorder", json={"moved_number": 100, "target_index": 0})
    assert r.status_code == 401


def test_reorder_unknown_channel_is_404(auth_client, no_tunarr):
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 999999, "target_index": 0})
    assert r.status_code == 404


def test_reorder_noop_returns_empty_changed_and_skips_tunarr(auth_client, no_tunarr):
    _seed_full_channel(7701)
    idx = _index_of(auth_client, 7701)
    before = _numbers(auth_client)

    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7701, "target_index": idx})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changed"] == []
    assert body["tunarr"] == {"synced": 0, "failed": []}
    assert [c["number"] for c in body["channels"]] == before
    assert _numbers(auth_client) == before


def test_reorder_cascades_every_referencing_table_including_ai_logs(auth_client, no_tunarr):
    for n in (7201, 7202, 7203):
        _seed_full_channel(n)
    before = {n: _expected_markers(n) for n in (7201, 7202, 7203)}
    untouched = _numbers(auth_client)

    # Drag 7201 down to where 7203 sits -> a 3-cycle rotation of their numbers.
    target = _index_of(auth_client, 7203)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7201, "target_index": target})
    assert r.status_code == 200, r.text
    body = r.json()

    changed = {c["old_number"]: c["new_number"] for c in body["changed"]}
    assert changed == {7201: 7203, 7202: 7201, 7203: 7202}

    # Names prove which channel now holds which number.
    with main.get_db() as conn:
        names = {r["number"]: r["name"] for r in conn.execute(
            "SELECT number, name FROM channels WHERE number IN (7201,7202,7203)")}
    assert names == {7203: "CH7201", 7201: "CH7202", 7202: "CH7203"}

    for old, new in changed.items():
        assert _markers_at(new) == before[old], f"refs for {old} did not follow to {new}"

    # The response carries the full new lineup, and nothing else was renumbered.
    assert [c["number"] for c in body["channels"]] == untouched
    assert _numbers(auth_client) == untouched


def test_reorder_cross_tier_updates_tier_and_number(auth_client, no_tunarr):
    _seed_full_channel(7801, tier="Galaxy Main")
    _seed_full_channel(7802, tier="Galaxy Main")
    target = _index_of(auth_client, 7802)

    r = auth_client.post("/api/channels/reorder", json={
        "moved_number": 7801, "target_index": target, "target_tier": "Classics"})
    assert r.status_code == 200, r.text
    body = r.json()

    entry = next(c for c in body["changed"] if c["old_number"] == 7801)
    assert entry["tier"] == "Classics"
    low, high = main.TIER_RANGES["Classics"]
    assert low <= entry["new_number"] <= high

    with main.get_db() as conn:
        row = conn.execute("SELECT * FROM channels WHERE number=?", (entry["new_number"],)).fetchone()
    assert row["name"] == "CH7801"
    assert row["tier"] == "Classics"
    assert _markers_at(entry["new_number"]) == _expected_markers(7801)
    _clear_channel(entry["new_number"])


# â”€â”€ Rollback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_midflight_failure_rolls_back_the_whole_renumber(auth_client, no_tunarr, monkeypatch):
    for n in (7401, 7402, 7403):
        _seed_full_channel(n)
    before_numbers = _numbers(auth_client)
    with main.get_db() as conn:
        before_names = {r["number"]: r["name"] for r in conn.execute("SELECT number, name FROM channels")}
    before_markers = {n: _markers_at(n) for n in (7401, 7402, 7403)}

    real_move = main._move_channel_number
    calls = {"n": 0}

    def _flaky(conn, old, new):
        calls["n"] += 1
        # Phase 1 parks 3 channels; blow up on the first phase-2 write, i.e.
        # with every affected row sitting at a temporary negative number.
        if calls["n"] == 4:
            raise RuntimeError("simulated mid-flight failure")
        return real_move(conn, old, new)

    monkeypatch.setattr(main, "_move_channel_number", _flaky)

    target = _index_of(auth_client, 7403)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7401, "target_index": target})
    assert r.status_code == 500
    assert calls["n"] == 4  # it really did fail mid-flight

    # Nothing persisted â€” no half-renumbered lineup, no parked rows.
    assert _numbers(auth_client) == before_numbers
    with main.get_db() as conn:
        after_names = {r["number"]: r["name"] for r in conn.execute("SELECT number, name FROM channels")}
        parked = conn.execute("SELECT COUNT(*) FROM channels WHERE number < 0").fetchone()[0]
    assert after_names == before_names
    assert parked == 0
    for n in (7401, 7402, 7403):
        assert _markers_at(n) == before_markers[n]
    with main.get_db() as conn:
        for table in main._CHANNEL_REF_TABLES:
            neg = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE channel_number < 0").fetchone()[0]
            assert neg == 0, f"{table} kept a parked row after rollback"


# â”€â”€ Tunarr propagation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _install_mock_client(monkeypatch, handler):
    """Same idiom as tests/test_tunarr_sync.py â€” a real AsyncClient over a
    MockTransport, so `async with httpx.AsyncClient(...)` is untouched."""
    calls: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    transport = httpx.MockTransport(_handler)
    real_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        return real_async_client(transport=transport)

    monkeypatch.setattr(main.httpx, "AsyncClient", _factory)
    return calls


def _tunarr_channel_payload(tunarr_id: str, number: int) -> dict:
    return {
        "id": tunarr_id, "name": "Whatever", "number": number, "groupTitle": "G",
        "duration": 86400000, "startTime": 1700000000000, "stealth": False,
        "disableFillerOverlay": True, "guideMinimumDuration": 30000,
        "streamMode": "hls", "subtitlesEnabled": False,
        "transcodeConfigId": "11111111-2222-3333-4444-555555555555",
        "icon": {"path": "", "width": 0, "duration": 0, "position": "bottom-right"},
        "offline": {"mode": "pic"}, "onDemand": {"enabled": False},
    }


class _FakeTunarr:
    """A Tunarr stand-in that enforces the one constraint that makes reordering
    hard: **channel numbers are unique**, and a duplicate is rejected with a
    500 (Tunarr's channel API has no 409 anywhere).

    Holds `id -> channel object`, echoes the saved object back on a successful
    PUT, and records every PUT *with a snapshot of the numbers in force at that
    moment* so a test can assert the no-transient-duplicate invariant directly
    rather than inferring it from the absence of a 500.
    """

    def __init__(self, numbers: dict[str, int]):
        self.channels = {tid: _tunarr_channel_payload(tid, n) for tid, n in numbers.items()}
        self.puts: list[dict] = []
        self.reject: "callable | None" = None  # (tid, payload) -> status | None
        self.list_status = 200                 # GET /api/channels

    # -- helpers ------------------------------------------------------------
    @property
    def numbers(self) -> dict[str, int]:
        return {tid: int(c["number"]) for tid, c in self.channels.items()}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path == "/api/channels":
            if self.list_status != 200:
                return httpx.Response(self.list_status, json={})
            return httpx.Response(200, json=list(self.channels.values()))
        if request.method == "GET" and path.startswith("/api/channels/"):
            tid = path.rsplit("/", 1)[-1]
            if tid not in self.channels:
                return httpx.Response(404, json={})
            return httpx.Response(200, json=self.channels[tid])
        if request.method == "PUT" and path.startswith("/api/channels/"):
            tid = path.rsplit("/", 1)[-1]
            payload = json.loads(request.content or b"{}")
            self.puts.append({
                "id": tid,
                "number": int(payload.get("number", -1)),
                "name": payload.get("name"),
                "groupTitle": payload.get("groupTitle"),
                # Numbers held by every channel *before* this write lands.
                "before": self.numbers,
            })
            if tid not in self.channels:
                return httpx.Response(404, json={})
            forced = self.reject(tid, payload) if self.reject else None
            if forced:
                return httpx.Response(forced, json={})
            wanted = int(payload.get("number", -1))
            for other, ch in self.channels.items():
                if other != tid and int(ch["number"]) == wanted:
                    return httpx.Response(500, json={})   # duplicate -> 500
            self.channels[tid] = {**self.channels[tid], **payload, "id": tid}
            return httpx.Response(200, json=self.channels[tid])
        return httpx.Response(404, json={})


def _install_fake_tunarr(monkeypatch, numbers: dict[str, int]) -> _FakeTunarr:
    fake = _FakeTunarr(numbers)
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://t.test")
    _install_mock_client(monkeypatch, fake.handler)
    return fake


def _assert_no_transient_duplicates(fake: _FakeTunarr) -> None:
    """No PUT ever asked for a number another channel still held at that
    instant. This is the property the parking band buys — it is stronger than
    "nothing 500'd", because it also rules out a lucky ordering."""
    for i, put in enumerate(fake.puts):
        clash = [tid for tid, num in put["before"].items()
                 if tid != put["id"] and num == put["number"]]
        assert not clash, (
            f"PUT #{i} moved {put['id']} to number {put['number']} while "
            f"{clash} still held it (sequence: "
            f"{[(p['id'], p['number']) for p in fake.puts]})"
        )


def test_tunarr_rotation_of_three_linked_channels_fully_propagates(auth_client, monkeypatch):
    """THE defect. A same-tier drag is a rotation: 7931->7933, 7932->7931,
    7933->7932. Tunarr rejects a duplicate number with a 500 and has no bulk or
    reorder endpoint, so any sequential write collides on at least one channel.
    All three must land on their final numbers with nothing in `failed`."""
    for n in (7931, 7932, 7933):
        _seed_full_channel(n)
    fake = _install_fake_tunarr(monkeypatch, {
        "tid-7931": 7931, "tid-7932": 7932, "tid-7933": 7933,
        "tid-other": 7999,          # an unrelated Tunarr channel, must not move
    })

    target = _index_of(auth_client, 7933)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7931, "target_index": target})
    assert r.status_code == 200, r.text
    body = r.json()

    changed = {c["old_number"]: c["new_number"] for c in body["changed"]}
    assert changed == {7931: 7933, 7932: 7931, 7933: 7932}

    assert body["tunarr"]["failed"] == [], body["tunarr"]["failed"]
    assert body["tunarr"]["synced"] == 3

    # All three ended on their final numbers in Tunarr.
    assert fake.numbers == {
        "tid-7931": 7933, "tid-7932": 7931, "tid-7933": 7932, "tid-other": 7999,
    }
    # Nothing was left parked above the lineup.
    assert not [n for n in fake.numbers.values() if n > 7999]
    _assert_no_transient_duplicates(fake)


def test_tunarr_rotation_never_writes_a_transient_duplicate(auth_client, monkeypatch):
    """Record every PUT body in order and check the invariant across the whole
    sequence: at the moment of each write, no other channel holds the number
    being written. Also pins the parking band above everything in play."""
    for n in (7941, 7942, 7943, 7944):
        _seed_full_channel(n)
    fake = _install_fake_tunarr(monkeypatch, {
        "tid-7941": 7941, "tid-7942": 7942, "tid-7943": 7943, "tid-7944": 7944,
        "tid-high": 8500,           # forces the parking band above 8500
    })

    target = _index_of(auth_client, 7944)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7941, "target_index": target})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tunarr"]["failed"] == []
    assert body["tunarr"]["synced"] == 4

    _assert_no_transient_duplicates(fake)

    # Phase 1 parked above every number present AND every target number.
    parking = [p["number"] for p in fake.puts if p["number"] > 8500]
    assert len(parking) == 4, [(p["id"], p["number"]) for p in fake.puts]
    assert len(set(parking)) == 4        # parking slots are distinct
    # ...and phase 2 brought every one of them back down.
    assert fake.numbers == {
        "tid-7941": 7944, "tid-7942": 7941, "tid-7943": 7942, "tid-7944": 7943,
        "tid-high": 8500,
    }
    # Two writes per changed channel and not one more — every successful write
    # regenerates Tunarr's M3U.
    assert len(fake.puts) == 8


def test_tunarr_reorder_still_pushes_name_group_and_watermark(auth_client, monkeypatch):
    """The number is not the only thing that has to land: the final write must
    still carry the metadata `_sync_channel_to_tunarr` normally pushes.

    CH7951 carries a real watermark blob, so the assertions below actually
    exercise `_watermark_for_tunarr` — with `channels.watermark` unset the key
    is omitted entirely and this test would pass even if watermark support were
    deleted outright.
    """
    for n in (7951, 7952):
        _seed_full_channel(n)
    watermark = {
        "enabled": True, "position": "top-left", "width": 15.0,
        "vertical_margin": 2.0, "horizontal_margin": 3.0, "duration": 0.0,
        "opacity": 90, "fixed_size": False, "fade": None,
    }
    wm_url = "http://tunarr:8000/images/uploads/ch7951.png"
    with main.get_db() as conn:
        conn.execute("UPDATE channels SET tier='Classics' WHERE number IN (7951, 7952)")
        conn.execute(
            "UPDATE channels SET watermark=?, watermark_image_url=? WHERE number=7951",
            (json.dumps(watermark), wm_url),
        )
    fake = _install_fake_tunarr(monkeypatch, {"tid-7951": 7951, "tid-7952": 7952})

    target = _index_of(auth_client, 7952)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7951, "target_index": target})
    assert r.status_code == 200, r.text
    assert r.json()["tunarr"]["failed"] == []

    # CH7951 now holds number 7952 — the object under that number must carry
    # its name and tier, not just the digit.
    by_number = {int(c["number"]): c for c in fake.channels.values()}
    assert by_number[7952]["name"] == "CH7951"
    assert by_number[7952]["groupTitle"] == "Classics"
    assert by_number[7951]["name"] == "CH7952"
    assert by_number[7951]["groupTitle"] == "Classics"
    # Values Linearr must never compute are echoed back untouched.
    assert by_number[7952]["guideMinimumDuration"] == 30000
    assert by_number[7952]["duration"] == 86400000

    # The watermark travelled with CH7951 to its new number, enabled, mapped to
    # Tunarr's field names and pointing at the uploaded image.
    pushed_wm = by_number[7952]["watermark"]
    assert pushed_wm["enabled"] is True
    assert pushed_wm["url"] == wm_url
    assert pushed_wm["position"] == "top-left"
    assert pushed_wm["width"] == 15.0
    assert pushed_wm["verticalMargin"] == 2.0
    assert pushed_wm["horizontalMargin"] == 3.0
    assert pushed_wm["opacity"] == 90
    assert "animated" not in pushed_wm
    # CH7952 has no watermark of its own, so no key was written for it.
    assert "watermark" not in by_number[7951]


def test_tunarr_unlinked_channel_is_skipped_and_never_written(auth_client, monkeypatch):
    """A rotation where the middle channel has no `tunarr_channel_links` row:
    it must be skipped entirely (never provisioned, never written) while the
    two linked channels still land correctly."""
    for n in (7961, 7962, 7963):
        _seed_full_channel(n)
    with main.get_db() as conn:
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number=7962")
    fake = _install_fake_tunarr(monkeypatch, {"tid-7961": 7961, "tid-7963": 7963})

    target = _index_of(auth_client, 7963)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7961, "target_index": target})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tunarr"]["failed"] == []

    # 7961 -> 7963, 7962 -> 7961, 7963 -> 7962. The link rows travel with the
    # channels, so after the move `tid-7961` is filed under 7963 and `tid-7963`
    # under 7962; 7961 (formerly CH7962) has no link and is skipped.
    assert body["tunarr"]["synced"] == 2
    written = {p["id"] for p in fake.puts}
    assert written == {"tid-7961", "tid-7963"}
    assert fake.numbers == {"tid-7961": 7963, "tid-7963": 7962}
    # No channel was created.
    assert set(fake.channels) == {"tid-7961", "tid-7963"}
    _assert_no_transient_duplicates(fake)


def test_tunarr_failure_does_not_roll_back_the_local_reorder(auth_client, monkeypatch):
    for n in (7901, 7902):
        _seed_full_channel(n)
    fake = _install_fake_tunarr(monkeypatch, {"tid-7901": 7901, "tid-7902": 7902})
    fake.reject = lambda tid, payload: 500          # every write fails

    target = _index_of(auth_client, 7902)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7901, "target_index": target})
    assert r.status_code == 200, r.text
    body = r.json()

    # Local renumber committed regardless of Tunarr.
    changed = {c["old_number"]: c["new_number"] for c in body["changed"]}
    assert changed == {7901: 7902, 7902: 7901}
    with main.get_db() as conn:
        names = {r["number"]: r["name"] for r in conn.execute(
            "SELECT number, name FROM channels WHERE number IN (7901,7902)")}
    assert names == {7902: "CH7901", 7901: "CH7902"}
    # ...and the response still carries the committed lineup.
    assert {c["number"] for c in body["channels"]} >= {7901, 7902}

    # ...and each failure is reported per channel.
    assert body["tunarr"]["synced"] == 0
    failed_numbers = sorted(f["number"] for f in body["tunarr"]["failed"])
    assert failed_numbers == [7901, 7902]
    assert all("500" in f["message"] for f in body["tunarr"]["failed"])
    # Nothing was parked, so nothing is stranded.
    assert all(f["state"] == "unchanged" for f in body["tunarr"]["failed"])
    assert fake.numbers == {"tid-7901": 7901, "tid-7902": 7902}


def test_tunarr_phase_two_failure_reports_the_stranded_parking_number(auth_client, monkeypatch):
    """The one genuinely bad state: a channel parked in phase 1 whose final
    write fails is left on a temporary number. The rest must still complete,
    and the report has to name the parking number unambiguously."""
    for n in (7971, 7972):
        _seed_full_channel(n)
    fake = _install_fake_tunarr(monkeypatch, {"tid-7971": 7971, "tid-7972": 7972})

    def reject(tid, payload):
        # Let both park, then refuse tid-7971's final write only. The parking
        # write is a bare number change (the read-modify-write echoes Tunarr's
        # own name back); only the landing write carries Linearr's metadata.
        if tid == "tid-7971" and payload.get("name") == "CH7971":
            return 500
        return None

    fake.reject = reject

    target = _index_of(auth_client, 7972)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7971, "target_index": target})
    assert r.status_code == 200, r.text
    tunarr = r.json()["tunarr"]

    # The other channel still completed — a partial failure is not abandonment.
    assert tunarr["synced"] == 1
    assert fake.numbers["tid-7972"] == 7971

    assert len(tunarr["failed"]) == 1
    fail = tunarr["failed"][0]
    assert fail["number"] == 7972          # CH7971 now lives at number 7972
    assert fail["state"] == "parked"
    parked_at = fake.numbers["tid-7971"]
    assert parked_at > 7972                # really still on a parking number
    assert fail["parked_number"] == parked_at
    assert str(parked_at) in fail["message"]
    assert "7972" in fail["message"]


def test_tunarr_phase_one_failure_leaves_that_channel_alone(auth_client, monkeypatch):
    """A failed parking write means that channel never moved. Say so — and do
    not claim the channels it blocks succeeded either."""
    for n in (7981, 7982):
        _seed_full_channel(n)
    fake = _install_fake_tunarr(monkeypatch, {"tid-7981": 7981, "tid-7982": 7982})
    fake.reject = lambda tid, payload: 500 if tid == "tid-7981" else None

    target = _index_of(auth_client, 7982)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7981, "target_index": target})
    assert r.status_code == 200, r.text
    tunarr = r.json()["tunarr"]

    # tid-7981 never left 7981, so tid-7982 cannot take that number either.
    assert fake.numbers["tid-7981"] == 7981
    assert tunarr["synced"] == 0
    states = {f["number"]: f["state"] for f in tunarr["failed"]}
    assert states == {7982: "unchanged", 7981: "parked"}
    # The blocked channel is stranded at its parking number, and says so.
    stranded = next(f for f in tunarr["failed"] if f["state"] == "parked")
    assert fake.numbers["tid-7982"] == stranded["parked_number"]


def test_tunarr_reorder_skips_channels_whose_number_is_unchanged(auth_client, monkeypatch):
    """A tier-only change still has to reach Tunarr (groupTitle), but it must
    not be parked — every write regenerates the M3U."""
    _seed_full_channel(7991, tier="Galaxy Main")
    fake = _install_fake_tunarr(monkeypatch, {"tid-7991": 7991})

    idx = _index_of(auth_client, 7991)
    r = auth_client.post("/api/channels/reorder", json={
        "moved_number": 7991, "target_index": idx, "target_tier": "Totally Made Up Tier"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changed"] == [
        {"old_number": 7991, "new_number": 7991, "tier": "Totally Made Up Tier"}]
    assert body["tunarr"] == {"synced": 1, "failed": []}

    assert len(fake.puts) == 1                       # no parking round-trip
    assert fake.puts[0]["number"] == 7991
    assert fake.channels["tid-7991"]["groupTitle"] == "Totally Made Up Tier"


def test_tunarr_unreadable_channel_list_fails_every_channel_safely(auth_client, monkeypatch):
    """The parking band is derived from Tunarr's live channel list. If that
    read fails there is no number known to be free, so nothing may be written."""
    for n in (7861, 7862):
        _seed_full_channel(n, tier="Galaxy Main")
    fake = _install_fake_tunarr(monkeypatch, {"tid-7861": 7861, "tid-7862": 7862})
    fake.list_status = 503

    target = _index_of(auth_client, 7862)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7861, "target_index": target})
    assert r.status_code == 200, r.text
    tunarr = r.json()["tunarr"]
    assert tunarr["synced"] == 0
    assert sorted(f["number"] for f in tunarr["failed"]) == [7861, 7862]
    assert all(f["state"] == "unchanged" for f in tunarr["failed"])
    assert fake.puts == []                            # nothing was written


def test_reorder_never_creates_new_tunarr_channels(auth_client, monkeypatch):
    """A drag must not provision channels in Tunarr as a side effect â€” only
    already-linked channels are pushed."""
    for n in (7921, 7922):
        _seed_full_channel(n)
    with main.get_db() as conn:  # drop the links: these channels are Linearr-only
        conn.execute("DELETE FROM tunarr_channel_links WHERE channel_number IN (7921, 7922)")
    monkeypatch.setattr(main, "get_tunarr_url", lambda: "http://t.test")

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"unexpected Tunarr call: {request.method} {request.url}")

    _install_mock_client(monkeypatch, handler)

    target = _index_of(auth_client, 7922)
    r = auth_client.post("/api/channels/reorder",
                         json={"moved_number": 7921, "target_index": target})
    assert r.status_code == 200, r.text
    assert r.json()["tunarr"] == {"synced": 0, "failed": []}


# â”€â”€ The two paths that shared the cascade list get ai_logs too â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_update_channel_renumber_cascades_ai_logs(auth_client, no_tunarr):
    _seed_full_channel(7301)
    _clear_channel(7302)

    r = auth_client.put("/api/channels/7301", json={"number": 7302, "name": "CH7301"})
    assert r.status_code == 200, r.text
    assert _markers_at(7302) == _expected_markers(7301)
    assert _markers_at(7301) == {t: [] for t in _MARKER_COLUMNS}


def test_delete_channel_cleans_up_ai_logs(auth_client, no_tunarr):
    _seed_full_channel(7311)
    assert _markers_at(7311)["ai_logs"] == ["model-7311"]

    r = auth_client.delete("/api/channels/7311")
    assert r.status_code == 200, r.text
    assert _markers_at(7311) == {t: [] for t in _MARKER_COLUMNS}
