import type { ActorId, ProjectId } from '@althar/domain'
import { Effect } from 'effect'

import { Changes } from './Changes'
import { Permissions } from './Permissions'
import { accountsOf, Policies, postsScreenshots, pushesCommits, resolvesConflicts, type RulesChange } from './Policies'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import { botLogin } from './reviewerBots'

/** A change to a project's rules as the rules screen sends it: the rules, and the accounts its work runs on. */
export type RulesSent = RulesChange & {
  readonly rotateAccounts?: boolean | undefined
  readonly onlyAccounts?: Readonly<Record<string, ReadonlyArray<string>>> | null | undefined
}

/**
 * A new revision of a project's rules, whoever changes them: the person on the
 * rules screen, or an agent through `change_settings` (ADR-097), recorded as
 * theirs. Then what the change sets going: a call still waiting that the rules
 * no longer keep for the person is answered by them, and a switch newly on
 * acts on what waits now rather than at its next turn (ADR-030, ADR-072,
 * ADR-077). The rules as kept.
 */
export const applyRules = (projectId: string, sent: RulesSent, actorId: ActorId, expectedRevision?: number) =>
  Effect.gen(function* () {
    const policies = yield* Policies
    const { rotateAccounts, onlyAccounts, ...sentRules } = sent
    // Bots by their accounts, in small letters, each once (code-hosts § Review and triage bots).
    const change =
      sentRules.trustedBots == null
        ? sentRules
        : { ...sentRules, trustedBots: [...new Set(sentRules.trustedBots.map(botLogin).filter((login) => login !== ''))] }
    const was = (yield* policies.current(projectId as ProjectId)).rules
    const now = accountsOf(was)
    const only = onlyAccounts === undefined ? now.only : onlyAccounts
    const accounts =
      rotateAccounts === undefined && onlyAccounts === undefined
        ? {}
        : { accounts: { rotate: rotateAccounts ?? now.rotate, ...(only == null ? {} : { only }) } }
    yield* policies.set(projectId, { ...change, ...accounts }, actorId, expectedRevision)
    yield* (yield* Permissions).reconsider(projectId)
    const kept = yield* policies.current(projectId as ProjectId)
    const pullRequests = yield* Changes
    if (!resolvesConflicts(was) && resolvesConflicts(kept.rules)) yield* pullRequests.resolveNow({ projectId })
    if (!pushesCommits(was) && pushesCommits(kept.rules)) yield* pullRequests.pushNow({ projectId })
    if (!postsScreenshots(was) && postsScreenshots(kept.rules)) yield* (yield* PullRequestScreenshots).syncNow({ projectId })
    return kept
  })
