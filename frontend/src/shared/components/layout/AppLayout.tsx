import type { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { ToastContainer } from '@/shared/components/ui/Toast'
import { useUIStore } from '@/shared/store/ui.store'

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout({ sidebar, children }: AppLayoutProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <TopBar />

      {/* Body below topbar */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop — tapping it closes the drawer */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-20 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar:
            - Mobile: absolute drawer sliding in from left (z-30, over main content)
            - Desktop (md+): static flex column, always visible */}
        <aside
          className={[
            // shared
            'flex flex-col w-72 shrink-0 bg-slate-900 border-r border-slate-800',
            // mobile: absolute overlay, animated
            'absolute inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            // desktop: back to static flow
            'md:static md:translate-x-0 md:transition-none md:z-auto',
          ].join(' ')}
        >
          {sidebar}
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>

      <ToastContainer />
    </div>
  )
}
