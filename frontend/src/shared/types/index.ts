// ── Channels ─────────────────────────────────────────────────────────────────

export interface Channel {
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

export interface ChannelCollection {
  channel_number: number
  plex_type: 'movie' | 'show'
  collection_rating_key: string
  collection_title: string
  assigned?: { added: number; skipped: number }
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
  | 'settings'
  | 'channelForm'
  | 'blockForm'
  | 'collectionPicker'
  | 'itemDetail'
  | 'aiContentAdvisor'
  | 'networkAdvisor'
  | 'tunarrPreview'
  | 'templatesLibrary'
  | 'tunarrCollectionPicker'
  | 'iconEditor'
