import { get, post, put } from '@/shared/api/client'
import type { Settings } from '@/shared/types'

function getSettings(): Promise<Settings> {
  return get<Settings>('/api/settings')
}

function saveSettings(body: Partial<Settings>): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/api/settings', body)
}

interface AiTestBody {
  openai_api_key: string
  openai_base_url: string
  openai_model: string
}

function testAi(
  body: AiTestBody,
): Promise<{ ok: boolean; model: string; reply: string; duration_ms: number }> {
  return post<{ ok: boolean; model: string; reply: string; duration_ms: number }>(
    '/api/ai-test',
    body,
  )
}

interface AiModelsBody {
  openai_api_key: string
  openai_base_url: string
}

function fetchAiModels(body: AiModelsBody): Promise<{ models: string[] }> {
  return post<{ models: string[] }>('/api/ai-models', body)
}

interface PlexTestResult {
  ok: boolean
  latency_ms: number
  server_name: string
  version: string
  platform: string
  username: string
  plex_pass: boolean
  machine_id: string
}

function testPlex(): Promise<PlexTestResult> {
  return post<PlexTestResult>('/api/plex/test')
}

export interface McpToolset {
  name: string
  enabled: boolean
  tool_count: number
}

export interface McpInfo {
  endpoint: string
  token: string
  tool_count: number
  toolsets: McpToolset[]
}

function getMcpInfo(): Promise<McpInfo> {
  return get<McpInfo>('/api/mcp/info')
}

function regenerateMcpToken(): Promise<{ token: string }> {
  return post<{ token: string }>('/api/mcp/regenerate-token')
}

/** Tools register at import, so the change only lands on the next restart. */
function setMcpToolsets(
  toolsets: string[],
): Promise<{ ok: boolean; toolsets: string[]; restart_required: boolean }> {
  return put<{ ok: boolean; toolsets: string[]; restart_required: boolean }>(
    '/api/mcp/toolsets',
    { toolsets },
  )
}

export const settingsApi = {
  getSettings,
  saveSettings,
  testAi,
  fetchAiModels,
  testPlex,
  getMcpInfo,
  regenerateMcpToken,
  setMcpToolsets,
}
