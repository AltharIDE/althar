import { useCallback, useRef, useState } from 'react'

import type { RepositorySetup } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Each repository's setup as the person changes it in Running (ADR-079):
 * shown at once, kept by the runtime, and the repositories read again
 * either way, so one that didn't hold goes back as it was, and says why.
 *
 * Each change sends the whole setup, so a repository's changes go one after
 * another, never side by side: an older one landing late would undo a newer.
 * Until the last of them is kept and read back, the newest is what shows,
 * whatever a read in between says.
 */

export interface SetupsModel {
  /** The setup to show for a repository: the person's newest change while it is on its way, else the one kept. */
  readonly shown: (repositoryId: string, kept: RepositorySetup | null) => RepositorySetup | null
  readonly change: (repositoryId: string, setup: RepositorySetup) => void
  /** Why the last change didn't hold. */
  readonly failed: string | null
}

export const useSetups = (projectId: string): SetupsModel => {
  const { client, cache } = useServices()
  const [failed, setFailed] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlyMap<string, RepositorySetup>>(new Map())
  // Each repository's last change on its way, and how many it has had, so only the last reads back.
  const queues = useRef(new Map<string, { readonly tail: Promise<void>; readonly turn: number }>())
  const change = useCallback(
    (repositoryId: string, setup: RepositorySetup) => {
      setFailed(null)
      setPending((now) => new Map(now).set(repositoryId, setup))
      const before = queues.current.get(repositoryId)
      const turn = (before?.turn ?? 0) + 1
      const last = () => queues.current.get(repositoryId)?.turn === turn
      const tail = (before?.tail ?? Promise.resolve())
        .then(() => client.setRepository({ projectId, repositoryId, setup }))
        .catch((failure: unknown) => setFailed(messageOf(failure)))
      queues.current.set(repositoryId, { tail, turn })
      void tail.then(async () => {
        if (!last()) return
        await cache.refetchQueries({ queryKey: keys.repositories(projectId) })
        if (!last()) return
        queues.current.delete(repositoryId)
        setPending((now) => {
          const next = new Map(now)
          next.delete(repositoryId)
          return next
        })
      })
    },
    [cache, client, projectId],
  )
  const shown = useCallback((repositoryId: string, kept: RepositorySetup | null) => pending.get(repositoryId) ?? kept, [pending])
  return { shown, change, failed }
}
