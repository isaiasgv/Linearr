# Playback failures — what belongs to Linearr

**Date:** 2026-08-08
**Status:** For review. Nothing implemented from this document yet.
**Input:** A Tunarr-side investigation (Program Playback Troubleshooter + ffmpeg logs)
identifying four independent faults behind failing channels.

---

## 1. Triage: whose bug is each one?

The report is sound and its isolation tests are good — particularly proving the
Harry Potter failure was the watermark and not 4K by running a 1080p episode on
131 (failed) and the same episode on 116 (succeeded). The conclusions below take
its findings as given except where noted.

The important question for us is narrower: **which of these can Linearr cause,
prevent, or detect?** Four faults split three ways.

| # | Fault | Root cause lives in | Linearr's role |
|---|---|---|---|
| 1 | CH131 watermark enabled with empty URL → ffmpeg exit 254 | **Linearr** — it writes the watermark to Tunarr | **Already fixed in code. Not deployed.** |
| 2 | HDR tonemap: software chain too slow / OpenCL absent | Tunarr container + transcode config | Detect and warn only |
| 3 | 2,304 programs `missing` — stale Plex rating keys | **Plex drift, but Linearr holds the same stale keys** | **Detect + repair. This is the real work.** |
| 4 | Filler list "Ads - Orlando" — 5 missing files, 18 channels | Tunarr filler list + missing files | Detect and surface |

### Fault 1 is already fixed — and that is the single highest-value action here

This is the bug from the earlier session. The report independently reproduces the
exact mechanism we diagnosed: an enabled watermark with no image URL makes Tunarr
emit a dangling `-i` and ffmpeg dies at exit 254 before decoding a frame.

The fix is committed on `dev` and `release/0.0.1` but **has never been pushed or
deployed**, which is why 131 is still dead. Once deployed it works in three
layers:

- `_watermark_to_tunarr` refuses to emit `enabled: true` without an image, so
  131 self-heals into "plays, no overlay" on its next sync;
- `POST /api/channels/watermark-repair` resolves the channel icon into a real
  image URL and restores the watermark properly;
- `GET /api/channels/watermark-audit` finds every channel in that state.

The report says 131 is "the only one relying on the fallback". Our audit will
confirm or contradict that in one call — and it also catches the *second*
watermark bug found since, where every channel's image uploaded under one shared
filename (`linearr-watermark.png`) and overwrote each other.

> **Recommendation: deploy before building anything in this document.** It costs
> a push and restores a dead channel. Everything below is worth doing, and none
> of it is as cheap.

### Fault 3 is the one that genuinely needs new Linearr work

The report frames the 2,304 missing programs as Tunarr database drift, fixed by
"a Plex library rescan in Tunarr followed by rebuilding the affected channel
lineups". That is correct but **incomplete, and the omission matters**:

**Linearr stores the same stale rating keys.** `assignments.plex_rating_key` and
`block_slots.plex_rating_key` are Plex rating keys captured at assign time. When
Plex re-issues a key (the file was renamed or re-encoded — exactly the duplicate
pair the report found, `"2 Chainz Tiny Desk (Home) Concert"` vs
`"2 Chainz - Tiny Desk (Home) Concert"`), Linearr's copy goes stale too, silently.

Nothing in Linearr validates a stored rating key. I checked: there is no
staleness detection anywhere in `main.py`.

The consequence is that **rescanning Tunarr is not durable**. Linearr rebuilds
Plex collections from `assignments` by rating key (`generate_collections`) and
maps rating keys to Tunarr shows when pushing schedules
(`tunarr_push_schedule`). A stale key silently contributes nothing to the
collection — no error, the item is just absent. So:

1. Rescan Tunarr → missing programs cleared.
2. Next time Linearr builds collections or pushes a schedule → **it re-pushes the
   stale keys and the drift comes back.**

Linearr is the system of record for what belongs on a channel, so Linearr is
where the drift has to be repaired. That is the core of this plan.

### Faults 2 and 4 are Tunarr's, and should stay Tunarr's

- **HDR tonemapping** is a transcode-config and container-runtime problem
  (`mesa-opencl-icd`/rusticl, the "Disable Hardware Filters" toggle). Linearr
  must not start writing transcode configs — that is a large, sharp surface we
  have no tests for and no reason to own. What Linearr *can* do is stop the
  failure being a mystery: it is the app where you choose what goes on a channel,
  so it can tell you a channel contains HDR content.
- **Filler lists** are Tunarr objects. Linearr already reads them
  (`list_tunarr_filler_lists`, `get_tunarr_filler_list`). Reporting that a list
  attached to 18 channels has missing programs is cheap; repairing the files is
  not ours.

### Not in scope

`/api/programs/search` returning 503 (flaky Meilisearch) and the media-source
path replacements for `/standup` and `/interviews` are Tunarr configuration.
Linearr does not manage media sources and should not begin to. Worth doing on
the Tunarr side — the path-replacement point in particular is a good one, since
direct file access sidesteps the stale-part-ID failure entirely — but it is not
a Linearr change.

---

## 2. What to build

Three deliverables, in priority order. Each is independently useful and
independently shippable.

### A. Content health — stale rating-key detection and repair (fault 3)

The substantial piece. Linearr audits its own assignments and block slots against
Plex, reports what no longer resolves, and can re-link it.

**Detection.** For every distinct `plex_rating_key` in `assignments` and
`block_slots`, ask Plex whether it still resolves. Distinct keys, not rows — the
same item on five channels is one Plex lookup. Classify each as `ok`,
`missing` (Plex 404s), or `unreachable` (Plex itself is down — never report that
as missing, or a Plex outage looks like total library loss).

**Re-linking.** For each missing key, search Plex for a replacement by title,
narrowing on year and type. The report's own evidence shows why matching must
normalise: `"2 Chainz Tiny Desk (Home) Concert"` and
`"2 Chainz - Tiny Desk (Home) Concert"` differ only by punctuation. Normalise
case, punctuation, and whitespace; require an exact normalised match plus a
matching type, and treat a year mismatch as disqualifying unless the stored year
is null. Anything else is reported as a candidate for a human to confirm — never
auto-applied. A wrong re-link silently puts the wrong programme on a channel,
which is worse than a missing one because nothing surfaces it.

**Applying.** Update `plex_rating_key` in place. Two cases need care:
- `assignments` has `UNIQUE(channel_number, plex_rating_key)`. If the replacement
  key is already assigned to that channel, the stale row is deleted rather than
  updated — otherwise the write fails.
- The same stale key can appear in both tables and on many channels. One
  re-link decision should apply everywhere that key occurs, in one transaction.

**Surfaces.** `GET /api/content/health`, `POST /api/content/relink` (dry-run by
default, mirroring `push_schedule_to_tunarr`), MCP tools `audit_content` and
`relink_content`, and a Content-tab banner when a channel has broken assignments.

### B. Channel preflight — say why a channel will fail before you push it (faults 1, 2, 4)

One read-only report per channel, answering "will this actually play?". It
composes checks we can already make plus two new ones:

- **Watermark** — enabled with no image (already have `watermark-audit`).
- **Stale content** — assignments that no longer resolve (from A).
- **HDR content** — assignments whose Plex video stream reports a PQ/HLG transfer
  (`colorTrc` of `smpte2084`/`arib-std-b67`) or BT.2020 primaries. `plex_item`'s
  `media_info` does not currently expose these; it reads `Media` but never the
  video `Stream`. Needs a small addition.
- **Tunarr transcode config** — surface the linked channel's config so an HDR
  warning can say whether hardware filters are off. *Requires confirming the
  field name on `GET /api/transcode_configs` first — I could not verify it this
  session, and I am not going to guess at a field name in a plan.*
- **Filler lists** — attached lists whose programs are missing.

Explicitly **advisory**. It changes nothing; it explains. The HDR check in
particular cannot fix anything — its whole value is turning "the channel times
out" into "these 12 titles are HDR and your transcode config cannot tonemap
them".

### C. Make the existing watermark repair reachable from the UI (fault 1)

`watermark-audit` and `watermark-repair` exist as routes and MCP tools but have
no UI. Someone hitting this bug has no way to find or fix it without an MCP
client. A banner in the channel view when the audit is non-empty, with a repair
button, closes that.

---

## 3. Implementation plan

Phases are ordered so each ends somewhere shippable. Phase 0 is not code.

### Phase 0 — Deploy what is already fixed *(no code)*

1. Push `dev` and `release/0.0.1`.
2. Deploy, then `POST /api/channels/watermark-repair` (or ask Claude to run
   `repair_watermarks`).
3. Confirm 131 plays. Confirm the audit reports empty afterwards.

**Why first:** restores a dead channel, and validates the fix against the real
deployment before we build more on the same area.

### Phase 1 — Content health, read-only

- `_collect_content_keys()` — distinct rating keys across `assignments` and
  `block_slots`, with the rows referencing each.
- `_probe_plex_keys(keys)` — bounded-concurrency Plex lookups; classify
  `ok`/`missing`/`unreachable`; distinguish "Plex 404" from "Plex unreachable".
- `GET /api/content/health[?channel_number=]` — per-channel and total counts,
  plus the offending titles.
- MCP `audit_content` (read-only).
- Tests: a mocked Plex where some keys 404; assert missing detection, that a
  Plex outage reports `unreachable` and not `missing`, and that a key used on
  three channels is probed once.

Ships as: "tell me what is broken." Useful on its own, and safe.

### Phase 2 — Re-linking

- `_find_replacement(item)` — normalised title match + type + year rules above.
- `POST /api/content/relink` — `dry_run=true` by default; returns proposed
  mappings with a `confidence` of `exact` or `candidate`; only `exact` applies
  when executed. Transactional per key, handling the UNIQUE collision by deleting
  the stale row.
- MCP `relink_content` (destructive, idempotent, `dry_run` default true).
- Tests: the punctuation-differing duplicate pair re-links; a year mismatch does
  not; a UNIQUE collision deletes rather than errors; dry-run writes nothing.

Ships as: "and fix it, after showing me what it will do."

### Phase 3 — Channel preflight

- Extend `plex_item`'s `media_info` with `color_trc`, `color_primaries`,
  `video_profile`, and a derived `hdr` boolean, read from the video `Stream`.
- Confirm the transcode-config field names against a live Tunarr, then surface
  the linked channel's config.
- `GET /api/channels/{n}/preflight` composing watermark + stale content + HDR +
  filler-list checks.
- MCP `preflight_channel`.
- UI: a status strip on the channel view.

Ships as: "why this channel will fail, before you push it."

### Phase 4 — Watermark repair in the UI

- Banner + repair button driven by `watermark-audit`.
- Fold into the Phase 3 status strip if that lands first — one health surface is
  better than two.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| A wrong re-link silently swaps a programme | Only exact normalised matches auto-apply; everything else needs confirmation. Dry-run is the default. |
| Health check hammers Plex on a large library | Probe distinct keys, bounded concurrency, cache within a request. A 2,000-item lineup is ~2,000 lookups — measure before shipping, and consider a per-section bulk fetch if it is slow. |
| Plex outage misreported as mass content loss | `unreachable` is a distinct state from `missing` and never triggers a repair. Tested explicitly. |
| Preflight becomes a second source of truth about Tunarr's config | Read-only. Linearr never writes transcode configs. |
| Scope creep into Tunarr's domain | Faults 2 and 4 are detect-and-report only, stated as such above. |

---

## 5. Questions for you

1. **Deploy first?** Phase 0 needs nothing from me but a push. Want that now,
   separately from the rest?
2. **Re-link autonomy.** Default is: auto-apply exact normalised matches, ask
   about the rest. Too aggressive? The safer alternative is to propose everything
   and apply nothing without confirmation.
3. **Is preflight worth it**, given it can only advise on HDR? I think yes —
   it converts a silent timeout into a named cause — but it is the most
   speculative item here and the easiest to drop.
4. **Concerts/standups path replacements.** Worth doing on the Tunarr side, but
   confirm you want that left out of Linearr entirely.
