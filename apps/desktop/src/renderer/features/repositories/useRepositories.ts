import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ChangeTarget, ProjectRepository, RepositoryRole } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * A project's repositories screen's view model: its repositories as this
 * Mac has them, and each change kept at once. A role or a pull request
 * target shows at once and is put right if the runtime says no; adding and
 * leaving out read the repositories, and the projects, again, so the tabs
 * and the home have them before the change feed is heard.
 */

export interface RepositoriesModel {
  readonly project: string | null
  readonly repositories: ReadonlyArray<ProjectRepository> | null
  readonly error: string | null
  readonly setRole: (repositoryId: string, role: RepositoryRole) => void
  readonly setTarget: (repositoryId: string, target: ChangeTarget) => void
  readonly leaveOut: (repositoryId: string) => Promise<void>
  /** Asks for a folder, and adds the repositories at it. */
  readonly add: () => Promise<void>
}

export const useRepositories = (projectId: string): RepositoriesModel => {
  const { client, cache, host } = useServices()
  const read = reads(client)
  const listed = useQuery(read.repositories(projectId))
  const project = useQuery(read.projects()).data?.projects.find((each) => each.id === projectId)?.name ?? null
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (listed.error === null ? null : messageOf(listed.error))
  const key = keys.repositories(projectId)

  /** Reads what the change touched again: the repositories, and the projects, which name them. */
  const again = useCallback(
    () => Promise.all([cache.refetchQueries({ queryKey: key }), cache.refetchQueries({ queryKey: keys.projects })]),
    [cache, key],
  )

  /** Shows a change to one repository at once, keeps it, and reads them again either way. */
  const change = useCallback(
    (repositoryId: string, set: Partial<Pick<ProjectRepository, 'role'>> & { readonly target?: ChangeTarget }) => {
      setError(null)
      cache.setQueryData<ReadonlyArray<ProjectRepository>>(key, (now) =>
        now?.map((repository) =>
          repository.id !== repositoryId
            ? repository
            : {
                ...repository,
                ...(set.role === undefined ? {} : { role: set.role }),
                ...(set.target === undefined || repository.fork === null ? {} : { fork: { ...repository.fork, target: set.target } }),
              },
        ),
      )
      client
        .setRepository({
          projectId,
          repositoryId,
          ...(set.role === undefined ? {} : { role: set.role }),
          ...(set.target === undefined ? {} : { changeTarget: set.target }),
        })
        .catch((failure: unknown) => setError(messageOf(failure)))
        .finally(() => void again())
    },
    [cache, client, key, projectId, again],
  )

  const doing = useCallback(
    async (action: () => Promise<void>) => {
      setError(null)
      try {
        await action()
      } catch (failure) {
        setError(messageOf(failure))
      }
      await again()
    },
    [again],
  )

  return {
    project,
    repositories: listed.data ?? null,
    error,
    setRole: (repositoryId, role) => change(repositoryId, { role }),
    setTarget: (repositoryId, target) => change(repositoryId, { target }),
    leaveOut: (repositoryId) => doing(() => client.leaveOutRepository(projectId, repositoryId)),
    add: async () => {
      const grant = await host.pickFolder('project')
      if (grant !== null) await doing(() => client.addRepositories(projectId, grant))
    },
  }
}
