import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/** Independent query keys keep selections and results isolated across searches and projects. */
export const useMemory = (projectId: string) => {
  const { client, cache } = useServices()
  const [query, setQuery] = useState('')
  const [includeRetired, setIncludeRetired] = useState(false)
  const [offset, setOffset] = useState(0)
  const [sourceOffset, setSourceOffset] = useState(0)
  const [selected, select] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const read = reads(client)
  const result = useQuery(read.memory(projectId, query, includeRetired, offset))
  const detail = useQuery({ ...read.memoryDetail(projectId, selected ?? '', sourceOffset), enabled: selected !== null })
  const project = useQuery(read.projects()).data?.projects.find((each) => each.id === projectId)?.name ?? 'Project'
  const reset = () => {
    setOffset(0)
    select(null)
    setFailure(null)
  }
  const refresh = () => cache.invalidateQueries({ queryKey: keys.memory(projectId) })
  const changeState = async () => {
    const entry = detail.data
    if (entry === undefined || entry === null || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const saved = await client.setMemoryState({
        projectId,
        id: entry.id,
        expectedRevision: entry.revision,
        state: entry.state === 'active' ? 'retired' : 'active',
      })
      if (!saved) setFailure('This memory changed while you were reading it. Review the latest version and try again.')
      await refresh()
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }
  return {
    project,
    query,
    includeRetired,
    offset,
    selected,
    busy,
    entries: result.data?.entries ?? [],
    pending: result.data?.pending ?? 0,
    loading: result.isPending,
    detail: detail.data ?? null,
    detailLoading: selected !== null && detail.isPending,
    error: failure ?? (result.error === null ? null : messageOf(result.error)) ?? (detail.error === null ? null : messageOf(detail.error)),
    search: (value: string) => {
      reset()
      setQuery(value)
    },
    showRetired: (value: boolean) => {
      reset()
      setIncludeRetired(value)
    },
    page: (value: number) => {
      select(null)
      setOffset(value)
    },
    select: (id: string) => {
      setSourceOffset(0)
      select(id)
    },
    sourcePage: setSourceOffset,
    refresh: () => void refresh(),
    changeState: () => void changeState(),
  }
}
export type MemoryModel = ReturnType<typeof useMemory>
