import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useLogout } from '@/features/auth/hooks'
import { usePlexServerInfo, usePlexSessions } from '@/features/plex/hooks'
import { useTunarrVersionCheck } from '@/features/tunarr/hooks'
import { useSettings } from '@/features/settings/hooks'
import { Logo } from '@/shared/components/ui/Logo'
import { StatusDot } from '@/shared/components/ui'

function StatusBadge({
  label,
  icon,
  connected,
  detail,
}: {
  label: string
  icon: string
  connected: boolean | null
  detail?: string
}) {
  return (
    <div
      className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-3 py-1 text-sm"
      title={detail || label}
    >
      {icon && <img src={icon} alt="" className="w-4 h-4 rounded-sm" />}
      <StatusDot
        state={connected === null ? 'unknown' : connected ? 'ok' : 'error'}
        pulse={false}
      />
      <span className="hidden lg:inline text-slate-300">{label}</span>
    </div>
  )
}

export function TopBar() {
  const setActiveView = useUIStore((s) => s.setActiveView)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)
  const { data: channels = [] } = useChannels()
  const { data: assignments = {} } = useAssignments()
  const logout = useLogout()

  // Connection status
  const { data: plexInfo, isError: plexError } = usePlexServerInfo()
  const { data: plexSessions = [] } = usePlexSessions()
  const { data: tunarrCheck } = useTunarrVersionCheck()
  const { data: settings } = useSettings()

  const plexConnected = plexInfo ? true : plexError ? false : null
  const tunarrConnected = tunarrCheck?.version ? true : tunarrCheck ? false : null
  const aiConfigured = Boolean(settings?.openai_api_key_set || settings?.openai_api_key)

  const totalAssigned = Object.values(assignments).reduce((n, arr) => n + arr.length, 0)

  // Settings dropdown
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [])

  return (
    <header className="flex items-center justify-between px-3 md:px-6 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggleSidebar}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        {/* Collapse rail toggle — desktop only */}
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden md:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            {sidebarCollapsed ? <path d="M13 9l3 3-3 3" /> : <path d="M16 9l-3 3 3 3" />}
          </svg>
        </button>

        <button
          onClick={() => {
            useUIStore.getState().selectChannel(null)
            useUIStore.getState().setActiveView('channel')
          }}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <Logo size={28} />
          <div className="flex items-baseline gap-1.5">
            <span className="text-base md:text-lg font-semibold tracking-wide">Linearr</span>
            <span className="text-xs text-slate-500">v{__APP_VERSION__}</span>
          </div>
        </button>

        {/* Stats — hidden on small screens */}
        <span className="hidden sm:inline text-xs text-slate-500 ml-1">
          {channels.length} ch · {totalAssigned} assigned
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Connection badges */}
        <div className="hidden sm:flex items-center gap-1">
          <StatusBadge
            label="Plex"
            icon="/plex.svg"
            connected={plexConnected}
            detail={
              plexInfo
                ? `${plexInfo.server_name}${plexSessions.length > 0 ? ` — ${plexSessions.length} playing` : ''}`
                : 'Not connected'
            }
          />
          <StatusBadge
            label="Tunarr"
            icon="/tunarr.svg"
            connected={tunarrConnected}
            detail={tunarrCheck?.version ? `v${tunarrCheck.version}` : 'Not connected'}
          />
          <StatusBadge
            label="AI"
            icon=""
            connected={aiConfigured ? true : null}
            detail={aiConfigured ? `${settings?.openai_model || 'Configured'}` : 'Not configured'}
          />
        </div>

        {/* Settings dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Settings menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <svg
              className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => {
                  setActiveView('settings')
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <svg
                  className="w-3.5 h-3.5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Settings
              </button>
              <div className="border-t border-slate-700 my-1" />
              <button
                onClick={() => {
                  logout.mutate()
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-slate-700 flex items-center gap-2"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
