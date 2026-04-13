// Vibe and Style template options for the channel form.
// Sourced from channels.py CHANNELS list + curated additions.

export const VIBE_TEMPLATES: string[] = [
  // Extracted from channels.py
  '90s/00s cartoon energy',
  'Action-adventure toons',
  'Adrenaline / Franchise',
  'All-ages cartoon fun',
  'Anime / Japanese animation',
  'Bright / Parent-safe',
  'Cozy / Emotional',
  'Cozy crime procedurals',
  'Crowd-pleasers',
  'Cultural / Regional',
  'Elevated cable drama',
  'Everyday cable comfort',
  'Flagship / Big Tent',
  'Investigation / Obsession',
  'Light / Rewatchable',
  'Mature / Bold',
  'Modern / Trending / Competitive',
  'Nick animation deep cuts',
  'Personal / Curated',
  'Prestige / Event TV',
  'Pure movies',
  'Retro Hanna-Barbera classics',
  'Slime-era kids channel',
  'Stylized storytelling',
  'Suspense / Edge',
  'Tension / Dark energy',
  'Timeless / Library prestige',
  'Tween nostalgia / wholesome',
  'WB cartoon legacy / DCAU',
  'Youth culture / Music',
  // Curated additions
  'Binge-worthy prestige',
  'Family movie night',
  'Saturday morning cartoons',
  'Late-night talk and stand-up',
  'Workout / High-energy',
  'Holiday / Seasonal',
  'Documentary deep dives',
  'Educational and gentle',
]

export interface StyleTemplate {
  label: string // short label for the chip button
  text: string // text inserted into the Style textarea
}

export const STYLE_TEMPLATES: StyleTemplate[] = [
  // Extracted from channels.py (most reusable)
  {
    label: 'Hand-picked flagship',
    text: 'Curated best-of — hand-picked, every slot intentional',
  },
  {
    label: 'Always-on comfort',
    text: "The 'always on' channel — comfortable, familiar, zero commitment",
  },
  {
    label: 'AMC/FX prestige-adjacent',
    text: 'AMC/FX energy — prestige-adjacent but accessible.',
  },
  {
    label: 'HBO event TV',
    text: 'HBO flagship energy. Everything should feel like an event. Only the best.',
  },
  {
    label: 'Big and loud franchise',
    text: 'Big, loud, fun. Franchise-driven. The popcorn channel.',
  },
  {
    label: 'Procedural binge',
    text: "Bingeable cases and cops. Obsessive, detail-driven 'one more episode' energy.",
  },
  {
    label: 'Easy laughs all day',
    text: 'Easy laughs all day. Classic mornings, movies afternoon, stand-up headliner at prime.',
  },
  {
    label: 'Movies all day',
    text: 'The all-day movie channel. Wide variety, well-slotted by time of day.',
  },
  {
    label: 'Late-night freedom',
    text: 'Late-night freedom. The channel where anything goes. Peak hours 10PM-4AM.',
  },
  {
    label: 'Saturday morning toons',
    text: 'Pure Saturday morning energy. Toons all morning, kid-friendly all day.',
  },
  {
    label: 'Heritage cinema',
    text: 'Heritage cinema. Pre-2000 only. Black & white welcome. Prestige and history.',
  },
  {
    label: 'CN golden era',
    text: "CN golden era — Dexter's Lab through Adventure Time.",
  },
  {
    label: 'Catch-all cartoons',
    text: 'Catch-all cartoon channel. Lighter and broader than Animated. Pure toon energy.',
  },
  {
    label: 'Premium tension',
    text: 'Premium tension. Smarter, slower-burn than the action channel. Films that reward attention.',
  },
  {
    label: 'Comfort blockbusters',
    text: 'Movies everyone has seen and wants to see again. Pure comfort blockbusters.',
  },
  {
    label: 'Shonen by day, mature by night',
    text: 'Shonen energy during the day, deeper mature titles after 10PM. Anime-only channel.',
  },
  {
    label: 'Personal & curated',
    text: 'Your channel, your rules. No formula. Pure taste. Update frequently.',
  },
  {
    label: 'Reality competition',
    text: 'Reality TV powerhouse. Dating, cooking, design, drama-filled competition.',
  },
  {
    label: 'Doc deep dive',
    text: 'Documentary and reality. Science, nature, adventure, deep-dive series.',
  },
  {
    label: 'Educational gentle',
    text: 'Bright, gentle, educational. Preschool-safe and parent-trusted.',
  },
]
