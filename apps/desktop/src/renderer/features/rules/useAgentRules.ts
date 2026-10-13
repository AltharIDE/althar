import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import type { AgentRule, AgentRules, AgentRuleSkip, ProjectRulesView } from '@althar/contracts'
import { CommandMatch, type ImportPlace, type ImportRule, RulePlace, type SkippedRule } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The agents' own settings as the first draft of a project's rules
 * (ADR-034): what their files say, read each time it is shown, as the kit's
 * proposal, each rule that can't be one of the project's with why. The
 * offer made as a project opened stands until the person answers it, from
 * its card or the proposal: taking some, or none. Taking them keeps the
 * rules the runtime answers with, so the rules screen shows them at once.
 */

export const text = {
  /** Why one of the agents' rules can't be one of the project's. */
  skip: {
    paths: 'A rule on files: the project’s rules don’t hold paths yet.',
    network: 'A rule on the web: the project’s rules don’t hold domains yet.',
    mcp: 'A rule on an MCP tool: the project’s rules hold commands.',
    tool: 'Not a rule on what a command says: the project’s rules hold commands.',
    'every-command': 'It holds for every command: “Everything else” says that here.',
    wildcard: 'Its wildcard can’t be said the same way: the project’s rules match a command by its program and how it starts.',
    unsayable: 'The project’s rules can’t say it the same way.',
    'one-agent': 'It is for one of OpenCode’s agents: the project’s rules hold for every agent.',
    fixed: 'No project can change this: agents reach the code host through Althar, and never read credentials.',
    already: 'The project has it already.',
    'under-never': 'The same command is under Never, which comes first.',
    'under-ask': 'The same command is under Always ask me, which comes first.',
  } satisfies Record<AgentRuleSkip, string>,
}

const placeOf = (decision: AgentRule['decision']): ImportPlace => {
  switch (decision) {
    case 'never':
      return RulePlace.Never
    case 'ask':
      return RulePlace.Ask
    case 'allow':
      return RulePlace.Allow
  }
}

/** What the agents' settings say, as the kit's proposal: what can be taken, what can't and why, and the files that couldn't be read. */
export const proposalOf = (read: AgentRules) => ({
  rules: read.rules.flatMap((rule): ReadonlyArray<ImportRule> =>
    'rule' in rule
      ? [
          {
            id: rule.id,
            place: placeOf(rule.decision),
            pattern: rule.rule.pattern,
            match: rule.rule.match === 'exact' ? CommandMatch.Exact : CommandMatch.Prefix,
            from: rule.from.file,
            said: rule.said,
          },
        ]
      : [],
  ),
  skipped: read.rules.flatMap((rule): ReadonlyArray<SkippedRule> =>
    'skipped' in rule ? [{ id: rule.id, from: rule.from.file, said: rule.said, why: text.skip[rule.skipped] }] : [],
  ),
  unreadable: read.files.flatMap((file) => (file.readable ? [] : [file.from.file])),
})

export interface AgentRulesModel {
  /** What their files say; null while they're read. */
  readonly read: AgentRules | null
  readonly rules: ReadonlyArray<ImportRule>
  readonly skipped: ReadonlyArray<SkippedRule>
  readonly unreadable: ReadonlyArray<string>
  /** The offer made as the project opened stands, and there is something to take. */
  readonly offering: boolean
  readonly taking: boolean
  readonly declining: boolean
  /** Why the last answer didn't hold. */
  readonly error: string | null
  /** Takes those chosen; whether they were. */
  readonly take: (ids: ReadonlyArray<string>) => Promise<boolean>
  /** Takes none, answering the offer; whether it was. */
  readonly decline: () => Promise<boolean>
}

export const useAgentRules = (projectId: string): AgentRulesModel => {
  const { client, cache } = useServices()
  const query = useQuery(reads(client).agentRules(projectId))
  const [error, setError] = useState<string | null>(null)
  const [answering, setAnswering] = useState<'take' | 'decline' | null>(null)
  const read = query.data ?? null
  const proposal = read === null ? { rules: [], skipped: [], unreadable: [] } : proposalOf(read)

  const answer = useCallback(
    async (ids: ReadonlyArray<string>, as: 'take' | 'decline') => {
      setError(null)
      setAnswering(as)
      try {
        const kept = await client.importAgentRules(projectId, ids)
        cache.setQueryData<ProjectRulesView>(keys.rules(projectId), kept)
        return true
      } catch (failure) {
        setError(messageOf(failure))
        return false
      } finally {
        setAnswering(null)
        // Answered, or changed since they were read: either way, read again.
        void cache.invalidateQueries({ queryKey: keys.agentRules(projectId), exact: true })
      }
    },
    [client, cache, projectId],
  )

  return {
    read,
    ...proposal,
    offering: read?.offered === true && proposal.rules.length > 0,
    taking: answering === 'take',
    declining: answering === 'decline',
    error: error ?? (query.error === null ? null : messageOf(query.error)),
    take: (ids) => answer(ids, 'take'),
    decline: () => answer([], 'decline'),
  }
}
