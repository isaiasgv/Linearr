/**
 * Tuner endpoints and live sessions — the operational side of Tunarr.
 *
 * Extracted verbatim from `TunarrView`, except that Active Sessions now renders
 * an empty state instead of vanishing: a section that disappears entirely when
 * there is nothing in it reads as a missing feature, not as "no one is
 * watching".
 */
import { Button, EmptyState } from '@/shared/components/ui'
import { useRefreshXmltv, useTunarrSessions, useKillTunarrSessions } from '@/features/tunarr/hooks'

const downloadClass =
  'flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700'

function DownloadIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

export function SystemPanel() {
  const refreshXmltv = useRefreshXmltv()
  const { data: tunarrSessions } = useTunarrSessions()
  const killSessions = useKillTunarrSessions()

  const sessionEntries = Object.entries(tunarrSessions ?? {})

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-100">XMLTV / M3U</h2>
        <div className="flex flex-wrap gap-3">
          <a href="/api/tunarr/xmltv" download="xmltv.xml" className={downloadClass}>
            <DownloadIcon />
            Download XMLTV
          </a>
          <a href="/api/tunarr/m3u" download="channels.m3u" className={downloadClass}>
            <DownloadIcon />
            Download M3U
          </a>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshXmltv.mutate()}
            loading={refreshXmltv.isPending}
          >
            Refresh Guide
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Use these URLs in Plex or Jellyfin as a DVR tuner source.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-100">
          Active Sessions
          {sessionEntries.length > 0 && (
            <span className="ml-2 text-xs text-slate-500">({sessionEntries.length})</span>
          )}
        </h2>
        {sessionEntries.length === 0 ? (
          <EmptyState
            className="rounded-xl border border-slate-700 bg-slate-900"
            title="Nothing is streaming"
            description="Sessions appear here while a client is watching a channel."
          />
        ) : (
          <div className="space-y-2">
            {sessionEntries.map(([channelId, sessions]) => (
              <div
                key={channelId}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
              >
                <div>
                  <p className="text-sm text-slate-200">Channel {channelId}</p>
                  <p className="text-xs text-slate-500">
                    {Array.isArray(sessions) ? sessions.length : 1} active stream
                    {Array.isArray(sessions) && sessions.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <Button
                  variant="dangerSoft"
                  size="xs"
                  onClick={() => killSessions.mutate(channelId)}
                  disabled={killSessions.isPending}
                >
                  Kill
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
