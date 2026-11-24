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
  /**
   * The person's word on `files` of a repository's (all it has here, unless said): shown at once; answers why where it
   * didn't hold, and nothing where it did.
   */
  readonly decide: (
    repository: RepositoryAgentSettings,
    trusted: boolean,
    files?: RepositoryAgentSettings['files'],
  ) => Promise<string | undefined>
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

/** What was decided of a repository's settings files, all taken together. */
export const decidedOf = (files: RepositoryAgentSettings['files']): TrustDecided =>
  files.every((file) => file.trusted === true)
    ? 'trusted'
    : files.some((file) => file.trusted === null && file.changed)
      ? 'changed'
      : files.some((file) => file.trusted === null)
        ? 'undecided'
        : 'declined'

export const useAgentSettings = (projectId: string | null): AgentSettingsModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const repositories = useQuery({ ...read.agentSettings(projectId ?? ''), enabled: projectId !== null }).data ?? null
  const [failed, setFailed] = useState<AgentSettingsModel['failed']>(null)
  const decide = useCallback(
    async (repository: RepositoryAgentSettings, trusted: boolean, files: RepositoryAgentSettings['files'] = repository.files) => {
      if (projectId === null) return undefined
      const key = keys.agentSettings(projectId)
      const deciding = (file: AgentSettingsFile) => files.some((one) => one.file === file.file && one.hash === file.hash)
      // One that couldn't be read is never trusted, so shows as it was.
      const decided = (file: AgentSettingsFile) =>
        deciding(file) && file.unread === undefined ? { ...file, trusted, changed: false } : file
      setFailed(null)
      cache.setQueryData<ReadonlyArray<RepositoryAgentSettings>>(key, (was) =>
        was?.map((one) =>
          one.repositoryId === repository.repositoryId
            ? { ...one, files: one.files.map(decided), ...(one.elsewhere === undefined ? {} : { elsewhere: one.elsewhere.map(decided) }) }
            : one,
        ),
      )
      let said: string | undefined
      try {
        await client.decideAgentSettings({ projectId, repositoryId: repository.repositoryId, trusted, files })
      } catch (failure) {
        said = messageOf(failure)
        setFailed({ repositoryId: repository.repositoryId, said })
      }
      await cache.invalidateQueries({ queryKey: key, exact: true })
      return said
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
