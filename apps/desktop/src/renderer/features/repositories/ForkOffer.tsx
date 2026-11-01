import { useCallback, useState } from 'react'

import type { ChangeTarget, ProjectRepository } from '@althar/contracts'
import { UpstreamOffer } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The offer, once, to push a fork's tasks' branches to the repository it was
 * forked from, as Althar reads its repositories and its host says the person
 * can (ADR-085): shown in the project's room and its settings, whichever they
 * are in, and answered in place. Accepting changes the project's setting and
 * no remote.
 */

/** The project's first repository with the offer open, how to answer it, and why the last answer failed. */
export const useForkOffer = (projectId: string, repositories: ReadonlyArray<ProjectRepository> | null) => {
  const { client, cache } = useServices()
  const offering = repositories?.find((repository) => repository.fork?.offer === true) ?? null
  const [error, setError] = useState<string | null>(null)
  const key = keys.repositories(projectId)
  const answer = useCallback(
    (repositoryId: string, said: { readonly changeTarget: ChangeTarget } | { readonly notNow: true }) => {
      setError(null)
      client
        .setRepository({ projectId, repositoryId, ...said })
        .then(() =>
          // Gone at once, either way: it isn't offered again.
          cache.setQueryData<ReadonlyArray<ProjectRepository>>(key, (now) =>
            now?.map((repository) =>
              repository.id !== repositoryId || repository.fork === null
                ? repository
                : {
                    ...repository,
                    fork: {
                      ...repository.fork,
                      offer: false,
                      ...('changeTarget' in said ? { target: said.changeTarget } : {}),
                    },
                  },
            ),
          ),
        )
        .catch((failure: unknown) => setError(messageOf(failure)))
        .finally(() => void cache.refetchQueries({ queryKey: key }))
    },
    [cache, client, key, projectId],
  )
  return { offering, error, answer }
}

/** The offer, where a repository of the project has it open. */
export function ForkOffer({ offer: { offering, error, answer } }: { readonly offer: ReturnType<typeof useForkOffer> }) {
  if (offering?.fork == null) return null
  return (
    <UpstreamOffer
      upstream={offering.fork.upstream}
      onAccept={() => answer(offering.id, { changeTarget: 'upstream_branch' })}
      onNotNow={() => answer(offering.id, { notNow: true })}
      {...(error === null ? {} : { error })}
    />
  )
}
