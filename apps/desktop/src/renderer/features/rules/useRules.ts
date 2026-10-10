import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { ApiError, type AgentStatus, type NameKind, patternProblem, type ProjectRulesView } from '@althar/contracts'

import { messageOf, type ProjectRulesChange } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The project rules screen's view model (ADR-013): the rules as they are,
 * each change saved at once as a new revision, and the agents with their
 * accounts, for the accounts row. A pattern for names is saved only once
 * Althar can follow it; until then the screen says why it can't.
 *
 * A change that replaces a list names the revision it was made against, so
 * a rule a permission card kept meanwhile isn't dropped (ADR-018): the
 * runtime refuses it, and the screen reads the rules again. The screen's own
 * changes go one after another, each against the revision the last left.
 */

/** What of the rules is replaced whole when it changes: a list. */
const LISTS = ['alwaysAsk', 'never', 'alwaysAllow', 'commands'] as const

export interface RulesModel {
  readonly project: string | null
  readonly rules: ProjectRulesView | null
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** Saves a change; the screen shows it at once, and the rules as kept once saved. */
  readonly change: (change: Omit<ProjectRulesChange, 'projectId'>) => void
  /** Why the pattern last given for branches or titles wasn't saved. */
  readonly patternErrors: Readonly<Record<NameKind, string | null>>
  /** Saves the person's pattern for branches or titles, or takes it back with null. */
  readonly setPattern: (kind: NameKind, pattern: string | null) => void
}

export const useRules = (projectId: string): RulesModel => {
  const { client, cache } = useServices()
  const read = reads(client)
  const rulesRead = useQuery(read.rules(projectId))
  const project = useQuery(read.projects()).data?.projects.find((each) => each.id === projectId)?.name ?? null
  const agents = useQuery(read.status()).data?.agents ?? []
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (rulesRead.error === null ? null : messageOf(rulesRead.error))

  // The changes on their way, one after another.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const change = useCallback(
    (next: Omit<ProjectRulesChange, 'projectId'>) => {
      setError(null)
      const key = keys.rules(projectId)
      cache.setQueryData<ProjectRulesView>(key, (now) => (now === undefined ? now : { ...now, ...next }))
      const replaces = LISTS.some((list) => next[list] !== undefined)
      queue.current = queue.current.then(() => {
        // Against the rules as the last change left them, or as last read.
        const revision = cache.getQueryData<ProjectRulesView>(key)?.revision
        return client
          .setProjectRules({ projectId, ...next, ...(replaces && revision !== undefined ? { expectedRevision: revision } : {}) })
          .then(
            (kept) => void cache.setQueryData(key, kept),
            (failure: unknown) => {
              setError(messageOf(failure))
              // Moved on meanwhile: read them as they are, for the person to make the change again.
              if (failure instanceof ApiError && failure.reason === 'RulesChanged')
                void cache.invalidateQueries({ queryKey: key, exact: true })
            },
          )
      })
    },
    [client, cache, projectId],
  )

  const [patternErrors, setPatternErrors] = useState<Readonly<Record<NameKind, string | null>>>({ branch: null, title: null })
  const setPattern = useCallback(
    (kind: NameKind, pattern: string | null) => {
      const problem = pattern === null ? null : patternProblem(kind, pattern)
      setPatternErrors((now) => ({ ...now, [kind]: problem }))
      if (problem === null) change(kind === 'branch' ? { branchPattern: pattern } : { titlePattern: pattern })
    },
    [change],
  )

  return { project, rules: rulesRead.data ?? null, agents, error, change, patternErrors, setPattern }
}
