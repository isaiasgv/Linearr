import type { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { OribionFooter } from './OribionFooter'

import { useUIStore } from '@/shared/store/ui.store'

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout({ sidebar, children }: AppLayoutProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        Skip to content
      </a>
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
            // shared — full width as a mobile drawer
            'flex flex-col w-72 shrink-0 bg-slate-900 border-r border-slate-800',
            // mobile: absolute overlay, animated
            'absolute inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            // desktop: back to static flow; width collapses to an icon rail
            'md:static md:translate-x-0 md:z-auto md:transition-[width] md:duration-200',
            sidebarCollapsed ? 'md:w-14' : 'md:w-72',
          ].join(' ')}
        >
          {sidebar}
        </aside>

        <main id="main" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>

      {/* oribion-branding:footer */}
      <OribionFooter />
      {/* /oribion-branding:footer */}
    </div>
  )
}
