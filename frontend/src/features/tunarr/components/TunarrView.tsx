/**
 * Tunarr integration — a tab host.
 *
 * This file used to be 1,276 lines rendering six unrelated sections stacked in
 * one scroll (channels, a 24/7 builder, AI suggestions, smart collections,
 * XMLTV/M3U, sessions, filler lists) plus two inline modals, with the guide as
 * a full-page swap that discarded everything else on the way in. The sections
 * now live one per file under `panels/` and this is the shell: identity,
 * connection status, version banner, tabs.
 *
 * Presentation only — no hook or API behaviour changed in the split.
 */
import { Suspense, lazy } from 'react'
import { Button, Spinner } from '@/shared/components/ui'
import { useSettings } from '@/features/settings/hooks'
import { useTestTunarr, useTunarrVersionCheck } from '@/features/tunarr/hooks'
import { useUIStore, type TunarrTab } from '@/shared/store/ui.store'
import { ChannelsPanel } from './panels/ChannelsPanel'
import { CollectionsPanel } from './panels/CollectionsPanel'
import { BuildPanel } from './panels/BuildPanel'
import { SystemPanel } from './panels/SystemPanel'

// The guide is the heaviest panel and the least often opened, so it stays split.
const TunarrGuide = lazy(() => import('./TunarrGuide').then((m) => ({ default: m.TunarrGuide })))

const TABS: { id: TunarrTab; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'guide', label: 'Guide' },
  { id: 'collections', label: 'Collections' },
  { id: 'build', label: 'Build' },
  { id: 'system', label: 'System' },
]

export function TunarrView() {
  const tab = useUIStore((s) => s.tunarrTab)
  const setTab = useUIStore((s) => s.setTunarrTab)
  const { data: settings } = useSettings()
  const testTunarr = useTestTunarr()
  const { data: versionCheck } = useTunarrVersionCheck()

  const connected = testTunarr.data?.ok

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header — identity, connection, version */}
      <div className="shrink-0 border-b border-slate-800 px-6 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
              <img src="/tunarr.svg" alt="" className="h-5 w-5 rounded-xs" />
              Tunarr Integration
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {settings?.tunarr_url && (
                <span className="font-mono text-xs text-slate-500">{settings.tunarr_url}</span>
              )}
              {versionCheck?.version && (
                <span className="rounded-sm border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                  v{versionCheck.version}
                </span>
              )}
              {connected != null && (
                <span
                  className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs ${
                    connected
                      ? 'border-emerald-700 bg-emerald-900/40 text-emerald-300'
                      : 'border-red-800 bg-red-900/30 text-red-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`}
                  />
                  {connected ? `Connected · ${testTunarr.data?.latency_ms}ms` : 'Unreachable'}
                </span>
              )}
              {/* The public asset base is worth surfacing here: it is what
                  decides whether icons render outside the LAN, and it is
                  otherwise invisible until something is wrong. */}
              {settings?.tunarr_public_url && (
                <span
                  className="truncate font-mono text-xs text-slate-600"
                  title="Public base URL used for channel icons and watermark images"
                >
                  assets → {settings.tunarr_public_url}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => testTunarr.mutate(settings?.tunarr_url ?? '')}
            disabled={!settings?.tunarr_url}
            loading={testTunarr.isPending}
          >
            Test Connection
          </Button>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                tab === t.id
                  ? 'border-indigo-500 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Version warning */}
      {versionCheck?.is_supported === false && (
        <div className="mx-6 mt-4 flex shrink-0 items-start gap-3 rounded-lg border border-amber-700/50 bg-amber-950/50 px-4 py-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-200">Unsupported Tunarr Version</p>
            <p className="mt-0.5 text-xs text-amber-300/70">
              Tunarr <strong>v{versionCheck.version}</strong> is newer than the supported version{' '}
              <strong>v{versionCheck.supported_version}</strong>. Some features may not work
              correctly. Update Linearr to the latest version for full compatibility.
            </p>
          </div>
        </div>
      )}

      {/* Panel. The guide manages its own scrolling, the rest scroll here. */}
      {tab === 'guide' ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          }
        >
          <TunarrGuide />
        </Suspense>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'channels' && <ChannelsPanel />}
          {tab === 'collections' && <CollectionsPanel />}
          {tab === 'build' && <BuildPanel />}
          {tab === 'system' && <SystemPanel />}
        </div>
      )}
    </div>
  )
}
