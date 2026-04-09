import { del, get, post } from '@/shared/api/client'
import type { AiLog, AppLog } from '@/shared/types'
import type { AiContentAdvisorResult, NetworkAdvisorResult } from './types'

function getAiLogs(): Promise<AiLog[]> {
  return get<AiLog[]>('/api/ai-logs')
}

function clearAiLogs(): Promise<void> {
  return del<void>('/api/ai-logs')
}

function getAiContentSuggestions(
  channelNumber: number,
  body?: { model?: string },
): Promise<AiContentAdvisorResult> {
  return post<AiContentAdvisorResult>(
    `/api/channels/${channelNumber}/ai-content-suggestions`,
    body,
  )
}

function getNetworkAdvisor(body?: { model?: string }): Promise<NetworkAdvisorResult> {
  return post<NetworkAdvisorResult>('/api/network/ai-advisor', body)
}

function getAiGenerateDayPreview(
  channelNumber: number,
  style: string = 'cable',
): Promise<unknown> {
  return post<unknown>('/api/blocks/ai-generate-day', {
    channel_number: channelNumber,
    style,
  })
}

interface AiGenerateDayBody {
  channel_number: number
  style?: string
  [key: string]: unknown
}

function aiGenerateDay(body: AiGenerateDayBody): Promise<{ created: number }> {
  return post<{ created: number }>('/api/blocks/ai-generate-day', body)
}

function get247Suggestions(): Promise<import('@/shared/types').Suggestion247[]> {
  return get<import('@/shared/types').Suggestion247[]>('/api/channels/suggest-247')
}

function aiSuggestChannels(): Promise<import('@/shared/types').AiChannelSuggestResult> {
  return post<import('@/shared/types').AiChannelSuggestResult>('/api/channels/ai-suggest')
}

function getAppLogs(): Promise<AppLog[]> {
  return get<AppLog[]>('/api/app-logs')
}

function clearAppLogs(): Promise<void> {
  return del<void>('/api/app-logs')
}

export const aiApi = {
  getAiLogs,
  clearAiLogs,
  getAppLogs,
  clearAppLogs,
  getAiContentSuggestions,
  getNetworkAdvisor,
  getAiGenerateDayPreview,
  aiGenerateDay,
  get247Suggestions,
  aiSuggestChannels,
}
