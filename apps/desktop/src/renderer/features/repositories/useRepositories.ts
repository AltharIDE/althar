import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { ChangeTarget, ProjectRepository, RepositoryRole } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { shortFolder } from '../../shared/folders'

/*
 * A project's repositories screen's view model: its repositories as this
 * Mac has them, where each one's work goes, and each change kept at once. A
 * role or a pull request target shows at once and is put right if the
 * runtime says no. A folder picked or dropped is read first, so the page
 * shows what is being added while it is; adding and leaving out read the
 * repositories, and the projects, again, so the tabs and the home have them
 * before the change feed is heard.
 */

/** A folder being added, as the page shows it while it is read. */
export interface ReadingFolder {
  readonly id: string
  readonly name: string
  /** Where it is, as the person knows the place: ~/code/meridian-infra. */
  readonly where: string
}

export interface RepositoriesModel {
  readonly project: string | null
  /** Where its tasks' worktrees are, as the person knows the place; null before it has had a task. */
  readonly worktrees: string | null
  readonly repositories: ReadonlyArray<ProjectRepository> | null
  /** The repositories in a folder being added, until they are. */
  readonly reading: ReadonlyArray<ReadingFolder>
  /** A folder is being added. */
  readonly adding: boolean
  readonly error: string | null
  readonly setRole: (repositoryId: string, role: RepositoryRole) => void
  readonly setTarget: (repositoryId: string, target: ChangeTarget) => void
  readonly leaveOut: (repositoryId: string) => Promise<void>
  /** Asks for a folder, and adds the repositories at it. */
  readonly add: () => Promise<void>
  /** Adds the repositories at each folder dropped on the page. */
  readonly addDropped: (files: ReadonlyArray<File>) => Promise<void>
}

export const useRepositories = (projectId: string): RepositoriesModel => {
  const { client, cache, host } = useServices()
  const read = reads(client)
  const listed = useQuery(read.repositories(projectId))
  const summary = useQuery(read.projects()).data?.projects.find((each) => each.id === projectId)
  const [failed, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<ReadonlyArray<ReadingFolder>>([])
  const [adding, setAdding] = useState(false)
  const error = failed ?? (listed.error === null ? null : messageOf(listed.error))
  const key = keys.repositories(projectId)
  const worktrees = summary?.worktrees ?? null

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

  /**
   * Adds the repositories at a folder the person granted: read first, so
   * the page shows each one coming that the project doesn't have yet, until
   * the repositories are read again with them. No grant, as when the picker
   * is cancelled, adds nothing; a drop that isn't a folder says so.
   */
  const addGranted = useCallback(
    async (grant: string | null, name: string | null = null) => {
      if (grant === null) {
        // Only a folder on this Mac has one; something else dropped doesn't.
        if (name !== null) setError(`${name} isn’t a folder on ${device.this}.`)
        return
      }
      setError(null)
      setAdding(true)
      try {
        const folder = await client.readFolder(grant)
        const have = new Set((cache.getQueryData<ReadonlyArray<ProjectRepository>>(key) ?? []).map((repository) => repository.path))
        // Each comes whole, by its own name, as the runtime adds it: a folder inside one adds the repository it is in.
        setReading(
          folder.repositories
            .filter((repository) => !have.has(repository.path))
            .map((repository) => ({ id: repository.path, name: repository.name, where: shortFolder(repository.path) })),
        )
        await client.addRepositories(projectId, grant)
      } catch (failure) {
        setError(messageOf(failure))
      }
      await again()
      setReading([])
      setAdding(false)
    },
    [client, cache, key, projectId, again],
  )

  return {
    project: summary?.name ?? null,
    worktrees: worktrees === null ? null : shortFolder(worktrees),
    repositories: listed.data ?? null,
    reading,
    adding,
    error,
    setRole: (repositoryId, role) => change(repositoryId, { role }),
    setTarget: (repositoryId, target) => change(repositoryId, { target }),
    leaveOut: (repositoryId) => doing(() => client.leaveOutRepository(projectId, repositoryId)),
    add: async () => addGranted(await host.pickFolder('project')),
    addDropped: async (files) => {
      for (const file of files) await addGranted(await host.grantDropped(file), file.name)
    },
  }
}
