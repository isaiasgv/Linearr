import { useState, useEffect, useRef, Fragment } from 'react'
import Swal from 'sweetalert2'
import {
  Button,
  IconButton,
  SegmentedControl,
  Spinner,
  StatusDot,
  confirmDialog,
} from '@/shared/components/ui'
import type { StatusDotState } from '@/shared/components/ui'
import {
  useSettings,
  useSaveSettings,
  useTestAi,
  useFetchAiModels,
  useTestPlex,
  useMcpInfo,
  useRegenerateMcpToken,
} from '@/features/settings/hooks'
import { useTestTunarr, useTunarrVersionCheck } from '@/features/tunarr/hooks'
import { useAiLogs, useClearAiLogs, useAppLogs, useClearAppLogs } from '@/features/ai/hooks'
import { usePlexServerInfo } from '@/features/plex/hooks'
import { useToastStore } from '@/shared/store/toast.store'
import { plexApi } from '@/features/plex/api'
import type { AiLog, AppLog, Settings } from '@/shared/types'

type SettingsTab = 'plex' | 'ai' | 'tunarr' | 'logs' | 'system'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function levelBadge(level: string) {
  switch (level) {
    case 'error':
      return 'bg-red-900/50 text-red-400 border-red-800'
    case 'warn':
      return 'bg-amber-900/50 text-amber-400 border-amber-800'
    default:
      return 'bg-slate-800 text-slate-400 border-slate-700'
  }
}

/** Map a nullable connection result onto the shared StatusDot states. */
function connectionState(ok: boolean | null): StatusDotState {
  if (ok === null) return 'unknown'
  return ok ? 'ok' : 'error'
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string | number | boolean | undefined
}) {
  if (value === undefined || value === '') return null
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return (
    <div className="flex justify-between text-xs py-1">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-mono">{display}</span>
    </div>
  )
}

export function SettingsView() {
  const addToast = useToastStore((s) => s.addToast)
  const { data: settings, isLoading } = useSettings()
  const saveSettings = useSaveSettings()
  const testAi = useTestAi()
  const testPlex = useTestPlex()
  const fetchAiModels = useFetchAiModels()
  const testTunarr = useTestTunarr()
  const { data: versionCheck } = useTunarrVersionCheck()
  const { data: plexServerInfo } = usePlexServerInfo()

  const [tab, setTab] = useState<SettingsTab>('plex')

  const [plexUrl, setPlexUrl] = useState('')
  const [plexToken, setPlexToken] = useState('')
  const [isPollingPlex, setIsPollingPlex] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [aiKey, setAiKey] = useState('')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiModels, setAiModels] = useState<string[]>([])

  const [tunarrUrl, setTunarrUrl] = useState('')

  useEffect(() => {
    if (settings) {
      setPlexUrl(settings.plex_url ?? '')
      setPlexToken(settings.plex_token ?? '')
      setAiKey(settings.openai_api_key ?? '')
      setAiBaseUrl(settings.openai_base_url ?? '')
      setAiModel(settings.openai_model ?? '')
      setTunarrUrl(settings.tunarr_url ?? '')
    }
  }, [settings])

  // Auto-test connections on mount if configured. The token itself is no longer
  // echoed back by the API, so rely on the `plex_token_set` presence flag.
  useEffect(() => {
    if (settings?.plex_token_set) testPlex.mutate()
    if (settings?.tunarr_url) testTunarr.mutate(settings.tunarr_url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.plex_token_set, settings?.tunarr_url])

  const handleConnectPlex = async () => {
    try {
      const { auth_url } = await plexApi.startAuth()
      window.open(auth_url, '_blank')
      setIsPollingPlex(true)
      pollingRef.current = setInterval(async () => {
        try {
          const status = await plexApi.authStatus()
          if (status.done && status.token) {
            setPlexToken(status.token)
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
            setIsPollingPlex(false)
          }
        } catch {
          /* keep polling */
        }
      }, 2000)
    } catch {
      /* handled by toast */
    }
  }

  // Modern JWT/JWK auth: the token is minted + stored server-side (tied to a
  // device keypair), so unlike the legacy flow we don't echo it into the field.
  const handleConnectPlexJwt = async () => {
    try {
      const { auth_url } = await plexApi.startJwtAuth()
      window.open(auth_url, '_blank')
      setIsPollingPlex(true)
      pollingRef.current = setInterval(async () => {
        try {
          const status = await plexApi.jwtAuthStatus()
          if (status.done) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
            setIsPollingPlex(false)
            testPlex.mutate() // re-verify the connection with the new token
          }
        } catch {
          /* keep polling */
        }
      }, 2000)
    } catch {
      /* handled by toast */
    }
  }

  const handleFetchModels = () => {
    fetchAiModels.mutate(
      { openai_api_key: aiKey, openai_base_url: aiBaseUrl },
      {
        onSuccess: (data) => {
          setAiModels(data.models)
          if (data.models.length > 0 && !data.models.includes(aiModel)) setAiModel(data.models[0])
        },
      },
    )
  }

  const handleSave = () => {
    const body: Partial<Settings> = {
      plex_url: plexUrl,
      openai_base_url: aiBaseUrl,
      openai_model: aiModel,
      tunarr_url: tunarrUrl,
    }
    // Only send secrets when the user actually typed something. The backend
    // preserves the existing secret on an empty value, but omitting it keeps the
    // intent explicit and avoids any chance of a wipe.
    if (plexToken) body.plex_token = plexToken
    if (aiKey) body.openai_api_key = aiKey
    saveSettings.mutate(body)
  }

  const plexTokenConfigured = Boolean(settings?.plex_token_set)
  const aiKeyConfigured = Boolean(settings?.openai_api_key_set)
  const SECRET_PLACEHOLDER = '•••••• (configured — leave blank to keep)'

  const plexInfo = testPlex.data
  const tunarrInfo = testTunarr.data
  const aiInfo = testAi.data

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'plex', label: 'Plex' },
    { id: 'ai', label: 'AI' },
    { id: 'tunarr', label: 'Tunarr' },
    { id: 'logs', label: 'Logs' },
    { id: 'system', label: 'System' },
  ]

  const inputClass =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500'

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <svg
                className="w-5 h-5 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage connections, integrations, and system configuration
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 shrink-0">
        <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-0 py-2 text-xs sm:text-sm font-medium rounded-md transition whitespace-nowrap px-2 ${
                tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-4 pb-24 relative">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="max-w-2xl">
            {/* ── Plex ── */}
            {tab === 'plex' && (
              <div className="space-y-5">
                {/* Always-visible Plex account info */}
                {plexServerInfo && (
                  <div className="bg-linear-to-r from-amber-950/30 to-slate-900 border border-amber-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                        <img src="/plex.svg" alt="Plex" className="w-10 h-10" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{plexServerInfo.server_name}</p>
                        <p className="text-xs text-amber-300/60">
                          {plexServerInfo.username}
                          {plexServerInfo.plex_pass && (
                            <span className="ml-2 inline-flex items-center gap-1 bg-amber-600/40 text-amber-200 rounded-full px-2 py-0.5 text-xs">
                              <img src="/plexpass.svg" alt="" className="w-3.5 h-3.5" />
                              Plex Pass
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-800/60 rounded-lg p-2">
                        <p className="text-[10px] text-slate-500">Version</p>
                        <p className="text-xs font-mono text-slate-200">{plexServerInfo.version}</p>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-2">
                        <p className="text-[10px] text-slate-500">Platform</p>
                        <p className="text-xs text-slate-200">{plexServerInfo.platform}</p>
                      </div>
                      <div className="bg-slate-800/60 rounded-lg p-2">
                        <p className="text-[10px] text-slate-500">Libraries</p>
                        <p className="text-xs font-semibold text-amber-400">
                          {plexServerInfo.library_count}
                        </p>
                      </div>
                    </div>
                    {plexServerInfo.machine_id && (
                      <div className="mt-2 bg-slate-800/60 rounded-lg p-2">
                        <p className="text-[10px] text-slate-500">Machine ID</p>
                        <p className="text-xs font-mono text-slate-400 truncate">
                          {plexServerInfo.machine_id}
                        </p>
                      </div>
                    )}
                    {plexServerInfo.libraries && plexServerInfo.libraries.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[10px] text-slate-500 mb-1.5">Library Sections</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {plexServerInfo.libraries.map((lib) => (
                            <div
                              key={lib.id}
                              className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2 py-1.5"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${lib.type === 'movie' ? 'bg-purple-400' : 'bg-blue-400'}`}
                              />
                              <span className="text-xs text-slate-300 truncate">{lib.title}</span>
                              <span className="text-[10px] text-slate-500 ml-auto shrink-0">
                                {lib.type === 'movie' ? 'Movies' : 'Shows'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Connection status card */}
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusDot
                        state={connectionState(plexInfo ? plexInfo.ok : null)}
                        pulse={false}
                      />
                      <h3 className="text-sm font-medium text-slate-200">Connection</h3>
                    </div>
                    <button
                      onClick={() => testPlex.mutate()}
                      disabled={testPlex.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg transition"
                    >
                      {testPlex.isPending ? <Spinner size="sm" /> : null}
                      Test Connection
                    </button>
                  </div>
                  {plexInfo?.ok && (
                    <div className="border-t border-slate-800 pt-3 space-y-0.5">
                      <InfoRow label="Server" value={plexInfo.server_name} />
                      <InfoRow label="Version" value={plexInfo.version} />
                      <InfoRow label="Platform" value={plexInfo.platform} />
                      <InfoRow label="Username" value={plexInfo.username} />
                      <InfoRow label="Plex Pass" value={plexInfo.plex_pass} />
                      <InfoRow label="Latency" value={`${plexInfo.latency_ms}ms`} />
                    </div>
                  )}
                  {testPlex.isError && (
                    <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-sm px-3 py-2">
                      {testPlex.error.message}
                    </p>
                  )}
                </div>

                {/* Config fields */}
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="settings-plex-url"
                      className="block text-xs text-slate-400 mb-1.5"
                    >
                      Server URL
                    </label>
                    <input
                      id="settings-plex-url"
                      type="url"
                      value={plexUrl}
                      onChange={(e) => setPlexUrl(e.target.value)}
                      placeholder="http://plex:32400"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="settings-plex-token"
                      className="block text-xs text-slate-400 mb-1.5"
                    >
                      Token
                    </label>
                    <input
                      id="settings-plex-token"
                      type="password"
                      value={plexToken}
                      onChange={(e) => setPlexToken(e.target.value)}
                      placeholder={plexTokenConfigured ? SECRET_PLACEHOLDER : 'Your Plex token'}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConnectPlex}
                      disabled={isPollingPlex}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
                    >
                      {isPollingPlex && <Spinner size="sm" />}
                      {isPollingPlex ? 'Waiting for auth...' : 'Connect with Plex'}
                    </button>
                    <button
                      onClick={handleConnectPlexJwt}
                      disabled={isPollingPlex}
                      title="Modern device-keypair auth (Plex API Unlocked). Token is kept server-side and refreshes every ~7 days."
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition"
                    >
                      Connect with Plex (JWT)
                    </button>
                    {isPollingPlex && (
                      <p className="text-xs text-slate-400">Complete auth in the new tab</p>
                    )}
                  </div>
                </div>

                {/* Webhook URL */}
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-2">
                  <h3 className="text-sm font-medium text-slate-200">Plex Webhooks</h3>
                  <p className="text-xs text-slate-500">
                    To receive real-time events (new content, playback, etc.), add this webhook URL
                    in your Plex server under <strong>Settings &gt; Webhooks</strong>.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/api/plex/webhook`}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/api/plex/webhook`
                        const fallback = () => {
                          const el = document.createElement('textarea')
                          el.value = url
                          el.style.position = 'fixed'
                          el.style.opacity = '0'
                          document.body.appendChild(el)
                          el.select()
                          document.execCommand('copy')
                          document.body.removeChild(el)
                        }
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(url).catch(fallback)
                        } else {
                          fallback()
                        }
                        addToast('Webhook URL copied')
                      }}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs transition"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-xs text-amber-500/70">
                    Requires Plex Pass on the server. If you don&apos;t have Plex Pass, webhooks are
                    not available but all other features work normally.
                  </p>
                </div>
              </div>
            )}

            {/* ── AI ── */}
            {tab === 'ai' && (
              <div className="space-y-5">
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusDot state={connectionState(aiInfo ? aiInfo.ok : null)} pulse={false} />
                      <h3 className="text-sm font-medium text-slate-200">Connection</h3>
                    </div>
                    <button
                      onClick={() =>
                        testAi.mutate({
                          openai_api_key: aiKey,
                          openai_base_url: aiBaseUrl,
                          openai_model: aiModel,
                        })
                      }
                      disabled={testAi.isPending || !aiKey}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg transition"
                    >
                      {testAi.isPending ? <Spinner size="sm" /> : null}
                      Test Connection
                    </button>
                  </div>
                  {aiInfo?.ok && (
                    <div className="border-t border-slate-800 pt-3 space-y-0.5">
                      <InfoRow label="Model" value={aiInfo.model} />
                      <InfoRow label="Reply" value={aiInfo.reply} />
                      <InfoRow label="Latency" value={`${aiInfo.duration_ms}ms`} />
                    </div>
                  )}
                  {testAi.isError && (
                    <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-sm px-3 py-2">
                      {testAi.error.message}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="settings-ai-key"
                      className="block text-xs text-slate-400 mb-1.5"
                    >
                      API Key
                    </label>
                    <input
                      id="settings-ai-key"
                      type="password"
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder={aiKeyConfigured ? SECRET_PLACEHOLDER : 'sk-...'}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="settings-ai-baseurl"
                      className="block text-xs text-slate-400 mb-1.5"
                    >
                      Base URL
                    </label>
                    <input
                      id="settings-ai-baseurl"
                      type="url"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="settings-ai-model" className="block text-xs text-slate-400">
                        Model
                      </label>
                      <button
                        onClick={handleFetchModels}
                        disabled={fetchAiModels.isPending || !aiKey}
                        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition"
                      >
                        {fetchAiModels.isPending && <Spinner size="sm" />}
                        Fetch models
                      </button>
                    </div>
                    {aiModels.length > 0 ? (
                      <select
                        id="settings-ai-model"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className={inputClass}
                      >
                        {aiModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="settings-ai-model"
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="gpt-4o"
                        className={inputClass}
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Works with any OpenAI-compatible API (OpenAI, Anthropic via proxy, Ollama, LM
                    Studio, etc.)
                  </p>
                </div>
              </div>
            )}

            {/* ── Tunarr ── */}
            {tab === 'tunarr' && (
              <div className="space-y-5">
                {/* Always-visible Tunarr info */}
                {(versionCheck?.version || tunarrInfo?.ok) && (
                  <div className="bg-linear-to-r from-emerald-950/30 to-slate-900 border border-emerald-800/30 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                        <img src="/tunarr.svg" alt="Tunarr" className="w-10 h-10" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Tunarr</p>
                        <div className="flex items-center gap-2">
                          {versionCheck?.version && (
                            <span className="text-xs text-emerald-300/60">
                              v{versionCheck.version}
                            </span>
                          )}
                          {tunarrInfo?.channels != null && (
                            <span className="text-xs text-emerald-300/60">
                              {tunarrInfo.channels} channels
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {tunarrInfo?.url && (
                        <div className="bg-slate-800/60 rounded-lg p-2 col-span-2">
                          <p className="text-[10px] text-slate-500">URL</p>
                          <p className="text-xs font-mono text-slate-200 truncate">
                            {tunarrInfo.url}
                          </p>
                        </div>
                      )}
                      {tunarrInfo?.latency_ms != null && (
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-[10px] text-slate-500">Latency</p>
                          <p className="text-xs font-mono text-slate-200">
                            {tunarrInfo.latency_ms}ms
                          </p>
                        </div>
                      )}
                      {tunarrInfo?.channels != null && (
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-[10px] text-slate-500">Channels</p>
                          <p className="text-xs font-semibold text-emerald-400">
                            {tunarrInfo.channels}
                          </p>
                        </div>
                      )}
                      {versionCheck?.supported_version && (
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-[10px] text-slate-500">Supported</p>
                          <p className="text-xs font-mono text-slate-200">
                            v{versionCheck.supported_version}
                          </p>
                        </div>
                      )}
                      {versionCheck?.is_supported != null && (
                        <div className="bg-slate-800/60 rounded-lg p-2">
                          <p className="text-[10px] text-slate-500">Compatibility</p>
                          <p
                            className={`text-xs font-medium ${versionCheck.is_supported ? 'text-emerald-400' : 'text-amber-400'}`}
                          >
                            {versionCheck.is_supported ? 'Fully supported' : 'Update recommended'}
                          </p>
                        </div>
                      )}
                    </div>
                    {versionCheck?.is_supported === false && (
                      <p className="text-xs text-amber-400 mt-2">
                        Tunarr v{versionCheck.version} is newer than supported v
                        {versionCheck.supported_version}. Update Linearr for full compatibility.
                      </p>
                    )}
                  </div>
                )}

                {/* Connection test */}
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusDot
                        state={connectionState(tunarrInfo ? tunarrInfo.ok : null)}
                        pulse={false}
                      />
                      <h3 className="text-sm font-medium text-slate-200">Connection</h3>
                    </div>
                    <button
                      onClick={() => testTunarr.mutate(tunarrUrl)}
                      disabled={testTunarr.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg transition"
                    >
                      {testTunarr.isPending ? <Spinner size="sm" /> : null}
                      Test Connection
                    </button>
                  </div>
                  {tunarrInfo?.ok && (
                    <div className="border-t border-slate-800 pt-3 space-y-0.5">
                      <InfoRow label="Server" value={tunarrInfo.url} />
                      <InfoRow label="Latency" value={`${tunarrInfo.latency_ms}ms`} />
                      {tunarrInfo.version && <InfoRow label="Version" value={tunarrInfo.version} />}
                      {tunarrInfo.channels != null && (
                        <InfoRow label="Channels" value={tunarrInfo.channels} />
                      )}
                    </div>
                  )}
                  {testTunarr.isError && (
                    <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-sm px-3 py-2">
                      {testTunarr.error.message}
                    </p>
                  )}
                </div>

                {/* Config */}
                <div>
                  <label
                    htmlFor="settings-tunarr-url"
                    className="block text-xs text-slate-400 mb-1.5"
                  >
                    Tunarr URL
                  </label>
                  <input
                    id="settings-tunarr-url"
                    type="url"
                    value={tunarrUrl}
                    onChange={(e) => setTunarrUrl(e.target.value)}
                    placeholder="http://tunarr:8000"
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Use Docker hostname if on the same network (e.g. http://tunarr:8000)
                  </p>
                </div>
              </div>
            )}

            {/* ── Logs ── */}
            {tab === 'logs' && <LogsPanelContainer />}

            {/* ── System ── */}
            {tab === 'system' && (
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-0.5">
                  <InfoRow label="App version" value={`v${__APP_VERSION__}`} />
                  <InfoRow label="API docs" value="/docs (Swagger UI)" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-200 mb-2">Database</h3>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => window.open('/api/backup', '_blank')}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg text-sm font-medium transition"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Download Backup
                    </button>
                    <button
                      onClick={() => {
                        const i = document.createElement('input')
                        i.type = 'file'
                        i.accept = '.db'
                        i.onchange = async () => {
                          const f = i.files?.[0]
                          if (!f) return
                          const { isConfirmed } = await Swal.fire({
                            title: 'Restore database?',
                            html: `This will <b>overwrite the current database</b> with <b>${f.name}</b>. This cannot be undone.`,
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonText: 'Restore',
                            cancelButtonText: 'Cancel',
                            background: '#1e293b',
                            color: '#e2e8f0',
                            confirmButtonColor: '#dc2626',
                          })
                          if (!isConfirmed) return
                          try {
                            const b = await f.arrayBuffer()
                            const r = await fetch('/api/restore', { method: 'POST', body: b })
                            if (r.ok) {
                              window.location.reload()
                            } else {
                              addToast(`Restore failed (${r.status})`, true)
                            }
                          } catch {
                            addToast('Restore failed — could not reach the server', true)
                          }
                        }
                        i.click()
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-800/50 text-amber-400 rounded-lg text-sm font-medium transition"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                      Restore
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Restore will reload the page after upload.
                  </p>
                </div>
                <McpServerCard />
                <div>
                  <a
                    href="/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Open API Documentation
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating save bar — visible only on config tabs */}
      {(tab === 'plex' || tab === 'ai' || tab === 'tunarr') && (
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none p-4 z-10">
          <div className="pointer-events-auto max-w-2xl mx-auto flex items-center justify-between gap-3 bg-slate-800/95 backdrop-blur-md border border-slate-700 rounded-xl px-4 py-3 shadow-2xl">
            <p className="text-xs text-slate-400">Changes are saved to all tabs at once.</p>
            <button
              onClick={handleSave}
              disabled={saveSettings.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition shrink-0"
            >
              {saveSettings.isPending && <Spinner size="sm" />}
              Save Settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── MCP Server card ─────────────────────────────────────────────────────── */

/** Copy text to the clipboard with a legacy execCommand fallback. */
function copyText(value: string) {
  const fallback = () => {
    const el = document.createElement('textarea')
    el.value = value
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(fallback)
  } else {
    fallback()
  }
}

function McpServerCard() {
  const addToast = useToastStore((s) => s.addToast)
  const { data: mcpInfo, isLoading, isError } = useMcpInfo()
  const regenerateToken = useRegenerateMcpToken()
  const [showToken, setShowToken] = useState(false)

  const endpointUrl = `${window.location.origin}${mcpInfo?.endpoint ?? '/mcp'}`
  const connectCommand = mcpInfo
    ? `claude mcp add --transport http linearr ${endpointUrl} --header "Authorization: Bearer ${mcpInfo.token}"`
    : ''

  const handleCopy = (value: string, label: string) => {
    copyText(value)
    addToast(`${label} copied`)
  }

  const handleRegenerate = async () => {
    const confirmed = await confirmDialog({
      title: 'Regenerate MCP token?',
      text: 'Existing MCP client connections will stop working until updated with the new token.',
      confirmText: 'Regenerate',
      danger: true,
    })
    if (confirmed) regenerateToken.mutate()
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-200">MCP Server</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Let AI assistants like Claude manage your channels, assignments and collections via the
          Model Context Protocol.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : isError || !mcpInfo ? (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded-sm px-3 py-2">
          Could not load MCP server info
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="settings-mcp-endpoint" className="block text-xs text-slate-400 mb-1.5">
              Endpoint URL
            </label>
            <div className="flex items-center gap-2">
              <input
                id="settings-mcp-endpoint"
                type="text"
                readOnly
                value={endpointUrl}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => handleCopy(endpointUrl, 'Endpoint URL')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs transition"
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="settings-mcp-token" className="block text-xs text-slate-400 mb-1.5">
              Bearer token
            </label>
            <div className="flex items-center gap-2">
              <input
                id="settings-mcp-token"
                type={showToken ? 'text' : 'password'}
                readOnly
                value={mcpInfo.token}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <IconButton
                label={showToken ? 'Hide token' : 'Show token'}
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </IconButton>
              <button
                onClick={() => handleCopy(mcpInfo.token, 'Bearer token')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs transition"
              >
                Copy
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">{mcpInfo.tool_count} tools available</p>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-slate-400">Connect with Claude Code</p>
              <button
                onClick={() => handleCopy(connectCommand, 'Connect command')}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs transition"
              >
                Copy
              </button>
            </div>
            <pre className="bg-slate-950 rounded-lg p-3 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
              {showToken
                ? connectCommand
                : `claude mcp add --transport http linearr ${endpointUrl} --header "Authorization: Bearer ${'•'.repeat(12)}"`}
            </pre>
            <p className="text-xs text-slate-500 mt-1.5">
              Claude Desktop and other clients: see{' '}
              <code className="text-slate-400">docs/MCP.md</code>.
            </p>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <Button
              variant="dangerSoft"
              size="sm"
              loading={regenerateToken.isPending}
              onClick={handleRegenerate}
            >
              Regenerate token
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Logs sub-components ─────────────────────────────────────────────────── */

function LogsPanelContainer() {
  const [logTab, setLogTab] = useState<'app' | 'ai'>('app')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const { data: aiLogs = [] } = useAiLogs()
  const clearAiLogs = useClearAiLogs()
  const { data: appLogs = [], refetch: refetchApp } = useAppLogs()
  const clearAppLogs = useClearAppLogs()

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => refetchApp(), 10_000)
    return () => clearInterval(id)
  }, [autoRefresh, refetchApp])

  const logs = logTab === 'app' ? appLogs : aiLogs
  const clear = logTab === 'app' ? clearAppLogs : clearAiLogs

  // Category options for app logs
  const appCategories = ['all', ...new Set(appLogs.map((l) => l.category))]
  const filteredAppLogs =
    categoryFilter === 'all' ? appLogs : appLogs.filter((l) => l.category === categoryFilter)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <SegmentedControl
            tone="neutral"
            options={[
              { value: 'app', label: `App (${appLogs.length})` },
              { value: 'ai', label: `AI (${aiLogs.length})` },
            ]}
            value={logTab}
            onChange={setLogTab}
          />
          {logTab === 'app' && appCategories.length > 2 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter logs by category"
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus:border-indigo-500"
            >
              {appCategories.map((c) => (
                <option key={c} value={c}>
                  {c === 'all' ? 'All categories' : c}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-3 h-3 accent-indigo-500"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => clear.mutate()}
            disabled={clear.isPending || logs.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 border border-red-800/50 text-red-400 rounded-sm text-xs font-medium transition"
          >
            {clear.isPending && <Spinner size="sm" />}
            Clear
          </button>
        </div>
      </div>
      {logs.length === 0 ? (
        <p className="text-center py-12 text-slate-500 text-sm">No {logTab} logs yet</p>
      ) : logTab === 'app' ? (
        <AppLogsTable logs={filteredAppLogs} />
      ) : (
        <AiLogsTable logs={aiLogs} />
      )}
    </div>
  )
}

function AppLogsTable({ logs }: { logs: AppLog[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const categoryColor = (cat: string) => {
    switch (cat) {
      case 'auth':
        return 'text-blue-400'
      case 'channel':
        return 'text-indigo-400'
      case 'assignment':
        return 'text-purple-400'
      case 'tunarr':
        return 'text-emerald-400'
      case 'plex':
        return 'text-amber-400'
      case 'system':
        return 'text-cyan-400'
      case 'logs':
        return 'text-slate-400'
      case 'icons':
        return 'text-pink-400'
      default:
        return 'text-slate-400'
    }
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-auto max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-slate-800 sticky top-0">
          <tr>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Time</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Level</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Category</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Message</th>
            <th className="text-right px-3 py-2 text-slate-400 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {logs.map((l) => (
            <Fragment key={l.id}>
              <tr
                tabIndex={0}
                aria-expanded={expandedId === l.id}
                className="hover:bg-slate-800/50 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpandedId(expandedId === l.id ? null : l.id)
                  }
                }}
              >
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  {formatDate(l.created_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-1.5 py-0.5 rounded-sm border text-[10px] font-medium uppercase ${levelBadge(l.level)}`}
                  >
                    {l.level}
                  </span>
                </td>
                <td className={`px-3 py-2 font-mono ${categoryColor(l.category)}`}>{l.category}</td>
                <td className="px-3 py-2 text-slate-300 truncate max-w-[300px]">{l.message}</td>
                <td className="px-3 py-2 text-right text-slate-400 font-mono">
                  {l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)}s` : '—'}
                </td>
              </tr>
              {expandedId === l.id && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 bg-slate-900/50">
                    <div className="space-y-2">
                      {l.detail && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 mb-1">Detail</p>
                          <pre className="text-xs text-slate-500 bg-slate-950 rounded-sm p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                            {l.detail}
                          </pre>
                        </div>
                      )}
                      {l.request_path && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 mb-1">Request Path</p>
                          <p className="text-xs text-slate-500 font-mono">{l.request_path}</p>
                        </div>
                      )}
                      {l.metadata && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 mb-1">Metadata</p>
                          <pre className="text-xs text-slate-500 bg-slate-950 rounded-sm p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                            {(() => {
                              try {
                                return JSON.stringify(JSON.parse(l.metadata), null, 2)
                              } catch {
                                return l.metadata
                              }
                            })()}
                          </pre>
                        </div>
                      )}
                      {!l.detail && !l.request_path && !l.metadata && (
                        <p className="text-xs text-slate-400 italic">No additional details</p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AiLogsTable({ logs }: { logs: AiLog[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  return (
    <div className="border border-slate-700 rounded-lg overflow-auto max-h-[60vh]">
      <table className="w-full text-xs">
        <thead className="bg-slate-800 sticky top-0">
          <tr>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Time</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Block</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Model</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">CH</th>
            <th className="text-right px-3 py-2 text-slate-400 font-medium">Duration</th>
            <th className="text-left px-3 py-2 text-slate-400 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {logs.map((l) => (
            <Fragment key={l.id}>
              <tr
                tabIndex={0}
                aria-expanded={expandedId === l.id}
                className="hover:bg-slate-800/50 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setExpandedId(expandedId === l.id ? null : l.id)
                  }
                }}
              >
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  {formatDate(l.created_at)}
                </td>
                <td className="px-3 py-2 text-slate-300 truncate max-w-[120px]">
                  {l.block_name || '—'}
                </td>
                <td className="px-3 py-2 text-slate-400 font-mono truncate max-w-[100px]">
                  {l.model || '—'}
                </td>
                <td className="px-3 py-2 text-slate-400">{l.channel_number ?? '—'}</td>
                <td className="px-3 py-2 text-right text-slate-400 font-mono">
                  {l.duration_ms != null ? `${(l.duration_ms / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-3 py-2">
                  {l.error ? (
                    <span className="text-red-400 truncate max-w-[120px] block" title={l.error}>
                      {l.error}
                    </span>
                  ) : (
                    <span className="text-emerald-400">OK</span>
                  )}
                </td>
              </tr>
              {expandedId === l.id && (
                <tr>
                  <td colSpan={6} className="px-3 py-3 bg-slate-900/50">
                    <div className="space-y-2">
                      {l.prompt && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 mb-1">
                            Prompt (truncated)
                          </p>
                          <pre className="text-xs text-slate-500 bg-slate-950 rounded-sm p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                            {l.prompt}
                          </pre>
                        </div>
                      )}
                      {l.response_raw && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 mb-1">
                            Response (truncated)
                          </p>
                          <pre className="text-xs text-slate-500 bg-slate-950 rounded-sm p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                            {l.response_raw}
                          </pre>
                        </div>
                      )}
                      {l.error && (
                        <div>
                          <p className="text-xs font-semibold text-red-400 mb-1">Error</p>
                          <pre className="text-xs text-red-300 bg-red-950/30 rounded-sm p-2 whitespace-pre-wrap">
                            {l.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
