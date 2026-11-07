import type { ActorId, ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from './Changes'
import { Permissions } from './Permissions'
import { accountsOf, hasCoordinator, Policies, postsScreenshots, pushesCommits, resolvesConflicts, type RulesChange } from './Policies'
import { PullRequestScreenshots } from './PullRequestScreenshots'
import { Sessions } from './Sessions'

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
    const { rotateAccounts, onlyAccounts, ...change } = sent
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
    // Turned off, the coordinator stops, whoever turned it off: nothing wakes it until it is on again (ADR-097).
    // Apart from this change, so a coordinator that turns itself off ends its own call before its session goes.
    if (hasCoordinator(was) && !hasCoordinator(kept.rules)) {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const homes = yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${projectId} AND kind = 'coordinator'`
      for (const home of homes) yield* Effect.forkDetach(Effect.ignore(sessions.stop(home.id)))
    }
    return kept
  })
