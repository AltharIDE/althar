import { useCallback, useState } from 'react'

import type { ProjectRepository, RepositorySetup } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Each repository's setup as the person changes it in Running (ADR-079):
 * shown at once, kept by the runtime, and the repositories read again
 * either way, so one that didn't hold goes back as it was, and says why.
 */

export interface SetupsModel {
  readonly change: (repositoryId: string, setup: RepositorySetup) => void
  /** Why the last change didn't hold. */
  readonly failed: string | null
}

export const useSetups = (projectId: string): SetupsModel => {
  const { client, cache } = useServices()
  const [failed, setFailed] = useState<string | null>(null)
  const change = useCallback(
    (repositoryId: string, setup: RepositorySetup) => {
      const key = keys.repositories(projectId)
      setFailed(null)
      cache.setQueryData<ReadonlyArray<ProjectRepository>>(key, (now) =>
        now?.map((repository) => (repository.id === repositoryId ? { ...repository, setup } : repository)),
      )
      client
        .setRepository({ projectId, repositoryId, setup })
        .catch((failure: unknown) => setFailed(messageOf(failure)))
        .finally(() => void cache.refetchQueries({ queryKey: key }))
    },
    [cache, client, projectId],
  )
  return { change, failed }
}
