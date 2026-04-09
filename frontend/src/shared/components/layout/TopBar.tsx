import { useUIStore } from '@/shared/store/ui.store'
import { useChannels } from '@/features/channels/hooks'
import { useAssignments } from '@/features/assignments/hooks'
import { useLogout } from '@/features/auth/hooks'
import { Logo } from '@/shared/components/ui/Logo'

export function TopBar() {
  const setActiveView = useUIStore((s) => s.setActiveView)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const { data: channels = [] } = useChannels()
  const { data: assignments = {} } = useAssignments()
  const logout = useLogout()

  const totalAssigned = Object.values(assignments).reduce((n, arr) => n + arr.length, 0)

  return (
    <header className="flex items-center justify-between px-3 md:px-6 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
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
            <span className="text-xs text-slate-600">v{__APP_VERSION__}</span>
          </div>
        </button>

        {/* Stats — hidden on small screens */}
        <span className="hidden sm:inline text-xs text-slate-500 ml-1">
          {channels.length} channels · {totalAssigned} assignments
        </span>
      </div>

      <div className="flex items-center gap-1">
        {/* Settings */}
        <button
          onClick={() => setActiveView('settings')}
          title="Settings"
          className="flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition text-sm"
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
          <span className="hidden md:inline">Settings</span>
        </button>

        {/* Logout */}
        <button
          onClick={() => logout.mutate()}
          title="Logout"
          className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span className="hidden md:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
