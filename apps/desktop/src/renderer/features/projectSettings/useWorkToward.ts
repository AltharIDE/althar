import { useCallback, useState } from 'react'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The branch a project's new tasks work toward in each of its repositories,
 * as the person changes it in General (ADR-093): shown at once, kept by the
 * runtime, and the repositories read again either way, so one that didn't
 * hold, as a branch the remote no longer has, goes back as it was and says
 * why at its row.
 */

export interface WorkTowardModel {
  /** The branch to show for a repository: the person's choice while it is on its way, else the one kept; null for the default. */
  readonly shown: (repositoryId: string, kept: string | null) => string | null
  readonly change: (repositoryId: string, branch: string | null) => void
  /** Why the last change didn't hold, by its repository. */
  readonly failed: { readonly repositoryId: string; readonly message: string } | null
}

export const useWorkToward = (projectId: string): WorkTowardModel => {
  const { client, cache } = useServices()
  const [pending, setPending] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [failed, setFailed] = useState<WorkTowardModel['failed']>(null)
  const change = useCallback(
    (repositoryId: string, branch: string | null) => {
      setFailed(null)
      setPending((before) => new Map(before).set(repositoryId, branch))
      void client
        .setRepository({ projectId, repositoryId, workToward: branch })
        .catch((failure: unknown) => setFailed({ repositoryId, message: messageOf(failure) }))
        .then(() => cache.refetchQueries({ queryKey: keys.repositories(projectId) }))
        .finally(() =>
          setPending((before) => {
            const next = new Map(before)
            next.delete(repositoryId)
            return next
          }),
        )
    },
    [cache, client, projectId],
  )
  const shown = useCallback(
    (repositoryId: string, kept: string | null) => (pending.has(repositoryId) ? (pending.get(repositoryId) ?? null) : kept),
    [pending],
  )
  return { shown, change, failed }
}
