import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToastStore } from '@/shared/store/toast.store'
import type {
  SmartCollection,
  TunarrChannel,
  TunarrChannelLink,
  TunarrCollectionLink,
} from '@/shared/types'
import { tunarrApi } from './api'

export function useTunarrChannels() {
  return useQuery({
    queryKey: ['tunarr', 'channels'],
    queryFn: () => tunarrApi.getChannels(),
  })
}

export function useTunarrLinks() {
  return useQuery({
    queryKey: ['tunarr', 'links'],
    queryFn: () => tunarrApi.getChannelLinks(),
  })
}

export function useTunarrCollectionLinks() {
  return useQuery({
    queryKey: ['tunarr', 'collection-links'],
    queryFn: () => tunarrApi.getCollectionLinks(),
  })
}

export function useTunarrSmartCollections() {
  return useQuery({
    queryKey: ['tunarr', 'smart-collections'],
    queryFn: () => tunarrApi.getSmartCollections(),
  })
}

export function useTunarrSchedule(tunarrId: string, enabled = true) {
  return useQuery({
    queryKey: ['tunarr', 'schedule', tunarrId],
    queryFn: () => tunarrApi.getChannelSchedule(tunarrId),
    enabled: enabled && Boolean(tunarrId),
  })
}

export function useTunarrChannelShows(tunarrId: string, enabled = true) {
  return useQuery({
    queryKey: ['tunarr', 'shows', tunarrId],
    queryFn: () => tunarrApi.getChannelShows(tunarrId),
    enabled: enabled && Boolean(tunarrId),
  })
}

interface CreateChannelVars {
  name: string
  number: number
  icon?: string
}

export function useCreateTunarrChannel() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: CreateChannelVars) => tunarrApi.createChannel(body),
    onSuccess: (data) => {
      queryClient.setQueryData(['tunarr', 'channels'], (prev: TunarrChannel[] | undefined) => [
        ...(prev ?? []),
        data,
      ])
      addToast(`Channel "${data.name}" created in Tunarr`)
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to create Tunarr channel', true)
    },
  })
}

interface LinkChannelVars {
  channel_number: number
  tunarr_id: string
}

export function useLinkTunarrChannel() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: LinkChannelVars) => tunarrApi.linkChannel(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tunarr', 'links'] })
      addToast('Channel linked to Tunarr')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to link channel', true)
    },
  })
}

export function useUnlinkTunarrChannel() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (channelNumber: number) => tunarrApi.unlinkChannel(channelNumber),
    onSuccess: (_data, channelNumber) => {
      queryClient.setQueryData(['tunarr', 'links'], (prev: TunarrChannelLink[] | undefined) =>
        (prev ?? []).filter((l) => l.channel_number !== channelNumber),
      )
      addToast('Channel unlinked from Tunarr')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to unlink channel', true)
    },
  })
}

interface LinkCollectionVars {
  channel_number: number
  plex_type: 'movie' | 'show'
  tunarr_collection_id: string
  tunarr_collection_name: string
}

export function useLinkTunarrCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (body: LinkCollectionVars) => tunarrApi.linkCollection(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tunarr', 'collection-links'] })
      addToast('Collection linked to Tunarr')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to link collection', true)
    },
  })
}

interface UnlinkCollectionVars {
  channelNumber: number
  plexType: 'movie' | 'show'
}

export function useUnlinkTunarrCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, plexType }: UnlinkCollectionVars) =>
      tunarrApi.unlinkCollection(channelNumber, plexType),
    onSuccess: (_data, { channelNumber, plexType }) => {
      queryClient.setQueryData(
        ['tunarr', 'collection-links'],
        (prev: TunarrCollectionLink[] | undefined) =>
          (prev ?? []).filter(
            (l) => !(l.channel_number === channelNumber && l.plex_type === plexType),
          ),
      )
      addToast('Collection unlinked from Tunarr')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to unlink collection', true)
    },
  })
}

interface PushScheduleVars {
  channelNumber: number
  preview?: boolean
}

export function usePushSchedule() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ channelNumber, preview }: PushScheduleVars) =>
      tunarrApi.pushSchedule(channelNumber, { preview }),
    onSuccess: (data, vars) => {
      if (!vars.preview) {
        const count = data.slots_pushed ?? data.slots ?? 0
        addToast(`Schedule pushed: ${count} slot${count !== 1 ? 's' : ''} updated`)
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to push schedule', true)
    },
  })
}

export function useSyncCollections() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (channelNumber: number) => tunarrApi.syncCollections(channelNumber),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['tunarr', 'collection-links'] })
      void queryClient.invalidateQueries({ queryKey: ['tunarr', 'smart-collections'] })
      addToast(
        `Synced collections: ${data.created?.length ?? 0} created, ${data.updated?.length ?? 0} updated`,
      )
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to sync collections', true)
    },
  })
}

export function useTestTunarr() {
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (tunarr_url: string) => tunarrApi.testConnection(tunarr_url),
    onSuccess: (data) => {
      if (data.ok) {
        addToast(`Tunarr connected${data.latency_ms ? ` (${data.latency_ms}ms)` : ''}`)
      } else {
        addToast('Tunarr connection failed', true)
      }
    },
    onError: (error: Error) => {
      addToast(error.message || 'Tunarr connection test failed', true)
    },
  })
}

export function useTunarrGuide(hours = 24) {
  return useQuery({
    queryKey: ['tunarr', 'guide', hours],
    queryFn: () => tunarrApi.getGuide(hours),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 minutes
  })
}

interface UpdateSmartCollectionVars {
  uuid: string
  body: Partial<SmartCollection>
}

export function useUpdateSmartCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ uuid, body }: UpdateSmartCollectionVars) =>
      tunarrApi.updateSmartCollection(uuid, body),
    onSuccess: (data) => {
      queryClient.setQueryData(
        ['tunarr', 'smart-collections'],
        (prev: SmartCollection[] | undefined) =>
          (prev ?? []).map((c) => (c.uuid === data.uuid ? data : c)),
      )
      addToast('Smart collection updated')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to update smart collection', true)
    },
  })
}

export function useDeleteSmartCollection() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (uuid: string) => tunarrApi.deleteSmartCollection(uuid),
    onSuccess: (_data, uuid) => {
      queryClient.setQueryData(
        ['tunarr', 'smart-collections'],
        (prev: SmartCollection[] | undefined) => (prev ?? []).filter((c) => c.uuid !== uuid),
      )
      addToast('Smart collection deleted')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to delete smart collection', true)
    },
  })
}

export function useTunarrTasks() {
  const addToast = useToastStore((s) => s.addToast)

  const refreshGuide = useMutation({
    mutationFn: () => tunarrApi.runUpdateXmlTvTask(),
    onSuccess: () => {
      addToast('Guide refresh task triggered')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to trigger guide refresh', true)
    },
  })

  const scanLibraries = useMutation({
    mutationFn: () => tunarrApi.runScanLibrariesTask(),
    onSuccess: () => {
      addToast('Scan libraries task triggered')
    },
    onError: (error: Error) => {
      addToast(error.message || 'Failed to trigger library scan', true)
    },
  })

  return { refreshGuide, scanLibraries }
}
