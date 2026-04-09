import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import type { Settings } from '@/shared/types'
import { settingsApi } from './api'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getSettings(),
  })
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: Partial<Settings>) => settingsApi.saveSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      addToast('Settings saved successfully')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to save settings', true)
    },
  })
}

interface AiTestVars {
  openai_api_key: string
  openai_base_url: string
  openai_model: string
}

export function useTestAi() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: AiTestVars) => settingsApi.testAi(body),
    onSuccess: (data) => {
      if (data.ok) {
        addToast(`AI connected — ${data.model} (${data.duration_ms}ms)`)
      } else {
        addToast('AI connection test failed', true)
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'AI connection test failed', true)
    },
  })
}

interface AiModelsVars {
  openai_api_key: string
  openai_base_url: string
}

export function useFetchAiModels() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: AiModelsVars) => settingsApi.fetchAiModels(body),
    onError: (error: Error) => {
      addToast(error.message || 'Failed to fetch AI models', true)
    },
  })
}

export function useTestPlex() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: () => settingsApi.testPlex(),
    onSuccess: (data) => {
      addToast(`Plex connected — ${data.server_name} (${data.latency_ms}ms)`)
    },
    onError: (error: Error) => {
      addToast(error.message || 'Plex connection failed', true)
    },
  })
}
