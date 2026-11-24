import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { AgentSettingsFile, RepositoryAgentSettings } from '@althar/contracts'
import type { TrustDecided, TrustFile } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * A project's repositories' own agent settings that run something, and what
 * the person decided of each (DEV-280), as adding a project asks it and its
 * settings keep it. A word on them shows at once, and goes back, saying why,
 * where it didn't hold.
 */

export interface AgentSettingsModel {
  /** Only the repositories that have any; null until read. */
  readonly repositories: ReadonlyArray<RepositoryAgentSettings> | null
  /** Those with a file not decided on as it is now: what adding a project asks. */
  readonly undecided: ReadonlyArray<RepositoryAgentSettings>
  readonly decide: (repository: RepositoryAgentSettings, trusted: boolean) => Promise<void>
  /** Why the last word on a repository's didn't hold, by its id. */
  readonly failed: { readonly repositoryId: string; readonly said: string } | null
}

/** A file as the kit shows it. */
export const trustFileOf = (file: AgentSettingsFile): TrustFile => ({
  agent: file.agent,
  agentName: file.agentName,
  file: file.file,
  runs: file.runs,
  ...(file.loadsAnyway ? { loadsAnyway: true } : {}),
})

/** What was decided of a repository's settings as they are now, all its files taken together. */
export const decidedOf = (repository: RepositoryAgentSettings): TrustDecided =>
  repository.files.every((file) => file.trusted === true)
    ? 'trusted'
    : repository.files.some((file) => file.trusted === null && file.changed)
      ? 'changed'
      : repository.files.some((file) => file.trusted === null)
        ? 'undecided'
        : 'declined'

export const useAgentSettings = (projectId: string | null): AgentSettingsModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const repositories = useQuery({ ...read.agentSettings(projectId ?? ''), enabled: projectId !== null }).data ?? null
  const [failed, setFailed] = useState<AgentSettingsModel['failed']>(null)
  const decide = useCallback(
    async (repository: RepositoryAgentSettings, trusted: boolean) => {
      if (projectId === null) return
      const key = keys.agentSettings(projectId)
      setFailed(null)
      cache.setQueryData<ReadonlyArray<RepositoryAgentSettings>>(key, (was) =>
        was?.map((one) =>
          one.repositoryId === repository.repositoryId
            ? { ...one, files: one.files.map((file) => ({ ...file, trusted, changed: false })) }
            : one,
        ),
      )
      try {
        await client.decideAgentSettings({ projectId, repositoryId: repository.repositoryId, trusted, files: repository.files })
      } catch (failure) {
        setFailed({ repositoryId: repository.repositoryId, said: messageOf(failure) })
      }
      await cache.invalidateQueries({ queryKey: key, exact: true })
    },
    [cache, client, projectId],
  )
  return {
    repositories,
    undecided: (repositories ?? []).filter((one) => one.files.some((file) => file.trusted === null)),
    decide,
    failed,
  }
}
