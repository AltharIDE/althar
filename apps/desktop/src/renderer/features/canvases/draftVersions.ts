import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

import { ApiError, type CanvasDetail } from '@althar/contracts'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { type CanvasSpot, type GatheredComment, markEarlier } from '../../shared/comments'

/** Check versions without holding up the draft's first render. */
export const useDraftCanvasVersions = (key: string, comments: ReadonlyArray<GatheredComment>) => {
  const { client } = useServices()
  const canvases = useMemo(
    () => comments.filter((one): one is GatheredComment & { on: CanvasSpot } => one.on.kind === 'canvas'),
    [comments],
  )
  const ids = useMemo(() => [...new Set(canvases.map((one) => one.on.canvasId))], [canvases])
  const versions = useQueries({
    queries: ids.map((id) => reads(client).canvas(id)),
    combine: useCallback((results: ReadonlyArray<UseQueryResult<CanvasDetail>>) => results.map(({ data, error }) => ({ data, error })), []),
  })
  useEffect(() => {
    const earlier = new Map<string, boolean>()
    for (const one of canvases) {
      const read = versions[ids.indexOf(one.on.canvasId)]
      if (read?.error instanceof ApiError && read.error.reason === 'NotFound') earlier.set(one.id, true)
      else if (read?.data !== undefined) earlier.set(one.id, !read.data.versions.some((version) => version.number === one.on.version))
    }
    if (earlier.size > 0) markEarlier(key, earlier)
  }, [key, canvases, versions, ids])
}
