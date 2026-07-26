"""Channel reorder / renumber.

`channels.number` is the PRIMARY KEY and six tables reference it *by value with
no foreign keys*, so a reorder is a multi-row primary-key mutation. This file is
split in two halves matching the two build steps:

  Part 1 — `TIER_RANGES` + `_compute_reorder`: pure math, no DB, no HTTP.
  Part 2 — `POST /api/channels/reorder`: the transactional two-phase renumber,
           the shared `_CHANNEL_REF_TABLES` cascade, and Tunarr propagation.
"""
import itertools

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
