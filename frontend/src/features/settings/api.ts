import { get, post } from '@/shared/api/client'
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

function testAi(body: AiTestBody): Promise<{ ok: boolean; model: string; reply: string; duration_ms: number }> {
  return post<{ ok: boolean; model: string; reply: string; duration_ms: number }>('/api/ai-test', body)
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

export const settingsApi = {
  getSettings,
  saveSettings,
  testAi,
  fetchAiModels,
  testPlex,
}
