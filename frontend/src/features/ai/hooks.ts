import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import { aiApi } from './api'

export function useAiLogs() {
  return useQuery({
    queryKey: ['ai-logs'],
    queryFn: () => aiApi.getAiLogs(),
    staleTime: 0,
  })
}

export function useClearAiLogs() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: () => aiApi.clearAiLogs(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-logs'] })
      addToast('AI logs cleared')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to clear AI logs', true)
    },
  })
}

export function useAppLogs() {
  return useQuery({
    queryKey: ['app-logs'],
    queryFn: () => aiApi.getAppLogs(),
    staleTime: 0,
  })
}

export function useClearAppLogs() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: () => aiApi.clearAppLogs(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app-logs'] })
      addToast('App logs cleared')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to clear app logs', true)
    },
  })
}

interface AiContentAdvisorVars {
  channelNumber: number
  model?: string
}

export function useAiContentAdvisor() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, model }: AiContentAdvisorVars) =>
      aiApi.getAiContentSuggestions(channelNumber, { model }),
    onError: (error: Error) => {
      addToast(error.message || 'Failed to get AI content suggestions', true)
    },
  })
}

export function useNetworkAdvisor() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (vars?: { model?: string }) => aiApi.getNetworkAdvisor(vars),
    onError: (error: Error) => {
      addToast(error.message || 'Failed to get network advisor suggestions', true)
    },
  })
}

export function useAiGenerateDayPreview(channelNumber: number, style: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ai-generate-day-preview', channelNumber, style],
    queryFn: () => aiApi.getAiGenerateDayPreview(channelNumber, style),
    enabled: enabled && Boolean(channelNumber) && Boolean(style),
  })
}

interface AiGenerateDayVars {
  channel_number: number
  style?: string
  [key: string]: unknown
}

export function useAiGenerateDay() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: AiGenerateDayVars) => aiApi.aiGenerateDay(body),
    onSuccess: (data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['blocks'] })
      void queryClient.invalidateQueries({ queryKey: ['block-slots'] })
      void queryClient.invalidateQueries({
        queryKey: ['ai-generate-day-preview', vars.channel_number],
      })
      addToast(`AI generated ${data.created} block slot${data.created !== 1 ? 's' : ''}`)
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to AI-generate day schedule', true)
    },
  })
}

export function use247Suggestions() {
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: () => aiApi.get247Suggestions(),
    onError: (error: Error) => addToast(error.message || 'Failed to load 24/7 suggestions', true),
  })
}

export function useAiSuggestChannels() {
  const addToast = useToastStore((s) => s.addToast)
  return useMutation({
    mutationFn: () => aiApi.aiSuggestChannels(),
    onError: (error: Error) =>
      addToast(error.message || 'Failed to get AI channel suggestions', true),
  })
}
