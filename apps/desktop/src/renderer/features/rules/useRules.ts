import { useCallback, useEffect, useState } from 'react'

import type { AgentStatus, ProjectRulesView } from '@althar/contracts'

import { messageOf, type ProjectRulesChange } from '../../data/client'
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
  const { client } = useServices()
  const [project, setProject] = useState<string | null>(null)
  const [rules, setRules] = useState<ProjectRulesView | null>(null)
  const [agents, setAgents] = useState<ReadonlyArray<AgentStatus>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.getProjectRules(projectId).then(setRules, (failure: unknown) => setError(messageOf(failure)))
    client.listProjects().then(
      (list) => setProject(list.projects.find((each) => each.id === projectId)?.name ?? null),
      () => {},
    )
    client.status().then(
      (status) => setAgents(status.agents),
      () => {},
    )
  }, [client, projectId])

  const change = useCallback(
    (next: Omit<ProjectRulesChange, 'projectId'>) => {
      setError(null)
      setRules((now) => (now === null ? now : { ...now, ...next }))
      client.setProjectRules({ projectId, ...next }).then(setRules, (failure: unknown) => setError(messageOf(failure)))
    },
    [client, projectId],
  )

  return { project, rules, agents, error, change }
}
