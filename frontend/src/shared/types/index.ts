// ── Channels ─────────────────────────────────────────────────────────────────

export interface Channel {
  /**
   * Stable server-assigned identity (uuid4). Additive only — no route takes it
   * and it never replaces `number` as the primary key. Use it as the React key:
   * `number` is mutated by a reorder and `name` is not unique.
   * Optional so a response from an older backend still type-checks.
   */
  uid?: string
  number: number
  name: string
  tier: 'Galaxy Main' | 'Classics' | 'Galaxy Premium'
  vibe: string
  mode: string
  style: string
  color: string
  icon: string | null
}

// ── Assignments ───────────────────────────────────────────────────────────────

export interface Assignment {
  id: number
  channel_number: number
  plex_rating_key: string
  plex_title: string
  plex_type: 'show' | 'movie'
  plex_thumb: string | null
  plex_year: number | null
  assigned_at?: string
}

export type AssignmentsMap = Record<number, Assignment[]>

// ── Plex ──────────────────────────────────────────────────────────────────────

export interface PlexLibrary {
  id: string
  title: string
  type: 'movie' | 'show'
}

export interface PlexItem {
  rating_key: string
  title: string
  type: 'show' | 'movie'
  year: number | null
  thumb: string | null
  summary: string
  duration_ms?: number
  duration_minutes?: number
  child_count?: number
  leaf_count?: number
  studio?: string
  content_rating?: string
  genres?: string[]
  user_rating?: number
  audience_rating?: number
  rating?: number
  originally_available_at?: string
  media_info?: {
    resolution?: string
    video_codec?: string
    audio_codec?: string
    audio_channels?: number
    bitrate?: number
    container?: string
  }
  subtitles?: string[]
  plex_web_url?: string
}

export interface PlexSeason {
  rating_key: string
  title: string
  index: number
  leaf_count: number
  thumb: string | null
}

export interface PlexEpisode {
  rating_key: string
  title: string
  index: number
  season_number: number
  thumb: string | null
  duration_minutes: number | null
  summary: string
}

export interface PlexCollection {
  rating_key: string
  title: string
  child_count: number
  thumb: string | null
  type: 'movie' | 'show'
  /** Rule-based (self-updating) Plex collection */
  smart?: boolean
  /** Library section the collection lives in — needed to rebuild its filter URI */
  section_id?: string
}

// ── Blocks ────────────────────────────────────────────────────────────────────

export interface Block {
  id: number
  name: string
  channel_number: number | null
  days: string[]
  start_time: string
  end_time: string
  content_type: 'shows' | 'movies' | 'both'
  notes: string
  order_index: number
}

export interface BlockSlot {
  id: number
  block_id: number
  slot_time: string
  plex_rating_key: string
  plex_title: string
  plex_type: 'show' | 'movie'
  plex_thumb: string | null
  plex_year: number | null
  duration_minutes: number
}

// ── Collections ───────────────────────────────────────────────────────────────

/**
 * Which kind of collection currently holds a channel's (movie|show) slot.
 *
 * - `owned`    — the `{Channel} Movies` / `{Channel} TV` collection Linearr
 *                generates and maintains from the channel's assignments.
 * - `assigned` — a pre-existing Plex collection the user pointed the channel
 *                at. Referenced only: Linearr never edits its contents.
 */
export type CollectionSource = 'owned' | 'assigned'

export interface ChannelCollection {
  channel_number: number
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
  /** Backend normalizes legacy rows to 'owned', so this is always present. */
  source: CollectionSource
  /** 0/1 — whether an assigned collection is a Plex smart collection. */
  is_smart: number
  /**
   * 0/1 — whether LINEARR created this Plex collection (only the
   * create-and-assign smart-collection path sets it).
   *
   * Gates the two destructive smart-collection actions. Plex exposes no way to
   * read a smart collection's rules back, so "Edit filters…" always opens a
   * BLANK builder — replacing from it wipes whatever rules the collection had.
   * That is only acceptable for rules Linearr itself wrote. Plex's own `smart`
   * flag cannot tell the two apart, which is why this exists.
   */
  linearr_created: number
  assigned?: { added: number; skipped: number }
}

// Plex smart-collection rules — mirrors `SmartCollectionFilters` in main.py.
export interface SmartCollectionFilters {
  /** Genre names (resolved to Plex tag IDs server-side) */
  genres: string[]
  /** Inclusive */
  year_min: number | null
  /** Inclusive */
  year_max: number | null
  /** e.g. 1980 */
  decade: number | null
  unwatched: boolean
  /** e.g. "PG", "TV-14" */
  content_rating: string | null
  title_contains: string | null
}

export type SmartCollectionSort =
  | 'title_asc'
  | 'title_desc'
  | 'year_asc'
  | 'year_desc'
  | 'added_desc'
  | 'random'

/** Body of POST /api/channels/{n}/smart-collection and POST /api/plex/smart-collections. */
export interface SmartCollectionInput {
  section_id: string
  type: 'movie' | 'show'
  title: string
  filters: SmartCollectionFilters
  sort: SmartCollectionSort | null
  limit: number | null
}

/** Body of PUT /api/plex/smart-collections/{rating_key} — title and/or filters. */
export interface SmartCollectionUpdateInput {
  section_id: string
  type: 'movie' | 'show'
  title?: string | null
  filters?: SmartCollectionFilters | null
  sort?: SmartCollectionSort | null
  limit?: number | null
}

export interface CollectionStatusEntry {
  name: string
  exists: boolean
  plex_count: number
  assigned_count: number
  linked: boolean
}

export interface CollectionStatus {
  movie: CollectionStatusEntry
  show: CollectionStatusEntry
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface Settings {
  plex_url: string
  plex_token: string
  openai_api_key: string
  openai_base_url: string
  openai_model: string
  tunarr_url: string
  // Secret presence flags: GET /api/settings returns secrets as empty strings
  // when set, plus these booleans so the UI can show a "configured" placeholder
  // without ever exposing the value. POST preserves the secret if sent empty.
  plex_token_set?: boolean
  openai_api_key_set?: boolean
}

// ── Tunarr ────────────────────────────────────────────────────────────────────

export interface TunarrChannel {
  id: string
  name: string
  number: number
  icon?: { path?: string }
}

export interface TunarrChannelLink {
  channel_number: number
  tunarr_id: string
  tunarr_name: string | null
  tunarr_number: number | null
}

export interface TunarrCollectionLink {
  channel_number: number
  plex_type: 'movie' | 'show'
  tunarr_collection_id: string
  tunarr_collection_name: string | null
}

export interface SmartCollection {
  uuid: string
  name: string
  filterString: string
  keywords: string
}

export interface TunarrScheduleItem {
  startTime: string
  duration: number
  type: string
  title?: string
  episode?: { title?: string; season?: number; episode?: number }
}

// ── AI ────────────────────────────────────────────────────────────────────────

export interface AiLog {
  id: number
  created_at: string
  block_id: number | null
  block_name: string | null
  channel_number: number | null
  model: string | null
  base_url: string | null
  prompt: string | null
  response_raw: string | null
  slots_json: string | null
  error: string | null
  duration_ms: number | null
}

export interface AppLog {
  id: number
  created_at: string
  level: 'info' | 'warn' | 'error'
  category: string
  message: string
  detail: string | null
  duration_ms: number | null
  request_path: string | null
  metadata: string | null
}

export interface AiSuggestion {
  channel_number: number
  channel_name: string
  reason: string
  shows?: PlexItem[]
  movies?: PlexItem[]
}

export interface NetworkSuggestion {
  channel_number: number
  channel_name: string
  items: Assignment[]
  reason?: string
}

// ── Channel Builder / Suggestions ─────────────────────────────────────────────

export interface Suggestion247 {
  title: string
  channel_name: string
  type: 'shows' | 'movies'
  episodes: number
  seasons: number
  hours: number
  description: string
  thumb: string | null
  rating_key: string
  year: number | null
  rating: number | null
  sort_score: number
  suggested_number: number
}

export interface AiChannelSuggestion {
  number: number
  name: string
  tier: string
  vibe: string
  description: string
  suggested_content?: string[]
}

export interface AiPackageSuggestion {
  name: string
  description: string
  channel_numbers: number[]
  highlights: string
}

export interface AiChannelSuggestResult {
  suggestions: {
    channels: AiChannelSuggestion[]
    packages: AiPackageSuggestion[]
  }
  duration_ms: number
}

// ── Toast ─────────────────────────────────────────────────────────────────────

export interface Toast {
  id: string
  message: string
  isError: boolean
}

// ── Modal names ───────────────────────────────────────────────────────────────

export type ModalName =
  | 'channelForm'
  | 'blockForm'
  | 'itemDetail'
  | 'aiContentAdvisor'
  | 'networkAdvisor'
  | 'tunarrPreview'
  | 'templatesLibrary'
  | 'tunarrCollectionPicker'
  | 'assignCollection'
  | 'smartCollectionBuilder'
  | 'iconEditor'
  | 'iconPicker'
  | 'watermarkEditor'
  | 'addContent'
