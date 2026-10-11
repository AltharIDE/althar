import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import { ApiError, type AgentStatus, type NameKind, patternProblem, type ProjectRulesView } from '@althar/contracts'

import { messageOf, type ProjectRulesChange } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The project rules screen's view model (ADR-013): the rules as they are,
 * each change saved at once as a new revision, and the agents with their
 * accounts. A pattern for names is saved only once Althar can follow it;
 * until then the screen says why it can't.
 *
 * The screen's changes go one after another. Each is worked out as it goes,
 * from the rules the runtime last said, so one made quickly after another
 * builds on it rather than on what the screen showed before it was saved;
 * the screen shows each at once, and keeps showing those still on their way
 * over what the runtime answers. A change that replaces a list names the
 * revision it was worked out from, so a rule a permission card kept
 * meanwhile isn't dropped (ADR-018): the runtime refuses it, the changes
 * after it are let go, and the screen reads the rules again.
 */

/** What of the rules is replaced whole when it changes: a list. */
const LISTS = ['alwaysAsk', 'never', 'alwaysAllow', 'commands'] as const

type Change = Omit<ProjectRulesChange, 'projectId'>

/** A change: as it is, or worked out from the rules as they are when it is saved; null where nothing is left to change. */
export type RulesEdit = Change | ((rules: ProjectRulesView) => Change | null)

const resolve = (edit: RulesEdit, rules: ProjectRulesView) => (typeof edit === 'function' ? edit(rules) : edit)
const applied = (rules: ProjectRulesView, edit: RulesEdit): ProjectRulesView => ({ ...rules, ...resolve(edit, rules) })

export interface RulesModel {
  readonly project: string | null
  readonly rules: ProjectRulesView | null
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** Saves a change; the screen shows it at once, and the rules as kept once saved. */
  readonly change: (edit: RulesEdit) => void
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

  // The changes on their way, one after another; those not yet answered; and the rules as the runtime last said them.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef<Array<RulesEdit>>([])
  const confirmed = useRef<ProjectRulesView | undefined>(undefined)
  const change = useCallback(
    (edit: RulesEdit) => {
      setError(null)
      const key = keys.rules(projectId)
      // With nothing on its way, what the screen read is what the runtime last said, unless a read begun earlier landed after a save.
      const read = cache.getQueryData<ProjectRulesView>(key)
      if (
        pending.current.length === 0 &&
        read !== undefined &&
        (confirmed.current === undefined || read.revision >= confirmed.current.revision)
      )
        confirmed.current = read
      pending.current.push(edit)
      cache.setQueryData<ProjectRulesView>(key, (now) => (now === undefined ? now : applied(now, edit)))
      /** What the screen shows: the rules as last said, with the changes still on their way. */
      const show = (rules: ProjectRulesView | undefined) => {
        if (rules !== undefined) cache.setQueryData(key, pending.current.reduce(applied, rules))
      }
      queue.current = queue.current.then(() => {
        const base = confirmed.current
        const next = base === undefined ? null : resolve(edit, base)
        if (base === undefined || next === null) {
          pending.current.shift()
          return show(base)
        }
        const replaces = LISTS.some((list) => next[list] !== undefined)
        return client.setProjectRules({ projectId, ...next, ...(replaces ? { expectedRevision: base.revision } : {}) }).then(
          async (kept) => {
            // A read begun before this was saved would put back the rules without it.
            await cache.cancelQueries({ queryKey: key, exact: true })
            pending.current.shift()
            confirmed.current = kept
            show(kept)
          },
          (failure: unknown) => {
            pending.current.shift()
            setError(messageOf(failure))
            if (failure instanceof ApiError && failure.reason === 'RulesChanged') {
              // Moved on meanwhile: what comes after was worked out from the same rules, so it goes too, and the rules are read as they are.
              confirmed.current = undefined
              void cache.invalidateQueries({ queryKey: key, exact: true })
            } else show(base)
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
