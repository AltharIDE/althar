import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { AgentStatus, ProjectRulesView } from '@althar/contracts'

import { messageOf, type ProjectRulesChange } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The project rules screen's view model (ADR-013): the rules as they are,
 * each change saved at once as a new revision, and the agents with their
 * accounts, for the accounts row.
 */

export interface RulesModel {
  readonly project: string | null
  readonly rules: ProjectRulesView | null
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** Saves a change; the screen shows it at once, and the rules as kept once saved. */
  readonly change: (change: Omit<ProjectRulesChange, 'projectId'>) => void
}

export const useRules = (projectId: string): RulesModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const rulesRead = useQuery(read.rules(projectId))
  const project = useQuery(read.projects()).data?.projects.find((each) => each.id === projectId)?.name ?? null
  const agents = useQuery(read.status()).data?.agents ?? []
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (rulesRead.error === null ? null : messageOf(rulesRead.error))

  const change = useCallback(
    (next: Omit<ProjectRulesChange, 'projectId'>) => {
      setError(null)
      const key = keys.rules(projectId)
      cache.setQueryData<ProjectRulesView>(key, (now) => (now === undefined ? now : { ...now, ...next }))
      client.setProjectRules({ projectId, ...next }).then(
        (kept) => cache.setQueryData(key, kept),
        (failure: unknown) => setError(messageOf(failure)),
      )
    },
    [client, cache, projectId],
  )

  return { project, rules: rulesRead.data ?? null, agents, error, change }
}
