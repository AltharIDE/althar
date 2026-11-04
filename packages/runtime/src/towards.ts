import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { BranchNotFound } from './errors'
import { remoteBranches } from './git'
import { Instance } from './Instance'
import { spotsOf } from './local'
import { hasBranch, startOf, towardOf } from './Projects'
import { change, fact } from './records'

/*
 * The branch a task works toward (ADR-093). Each of a task's workspaces has
 * one, `toward`, null for its repository's default branch: it starts from
 * it, its pull request goes into it, and keeping it current, its conflicts,
 * its checks, its diff and Run go by it. A project has a default for new
 * tasks in each repository, its Work toward (`repository_bindings.work_toward`),
 * null for the default branch as well.
 *
 * Until its first step starts, a task can be pointed at another: its
 * workspaces say so at once, and a worktree made with its draft moves to the
 * new start, unused, as the first step begins (`retarget`, local.ts), as a
 * worktree goes when the task starts Local instead.
 */

/**
 * Points a task at another branch to work toward, in each of its
 * repositories here, or back at each one's default with null. Each must
 * have the branch on the remote its work starts from; else nothing changes.
 * The caller says whether the task may still be pointed elsewhere.
 */
export const setToward = (taskId: string, toward: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const spots = yield* spotsOf(taskId)
    const next = spots.map((spot) => ({ spot, toward: towardOf({ base: spot.base, workToward: null }, toward) }))
    for (const { spot, toward: branch } of next) {
      if (branch === null || branch === spot.toward) continue
      const { remote } = yield* startOf({ ...spot, toward: branch })
      if (!(yield* hasBranch(spot.repository, branch, remote))) return yield* new BranchNotFound({ branch, repository: spot.name })
    }
    yield* sql.withTransaction(
      Effect.forEach(
        next.filter(({ spot, toward: branch }) => branch !== spot.toward),
        ({ spot, toward: branch }) =>
          Effect.gen(function* () {
            const revision = yield* change('workspaces', spot.id, { toward: branch })
            yield* fact({
              projectId: spot.projectId,
              aggregateType: 'workspace',
              aggregateId: spot.id,
              revision,
              type: 'workspace.toward_set',
              payload: { toward: branch },
              actorId: instance.systemId,
            })
          }),
        { discard: true },
      ),
    )
  })

/**
 * What a task's plan card offers to work toward: its first repository's
 * default branch, the branch it works toward where that isn't it, and the
 * remote's branches. Null for a task with no repository here.
 */
export const towardChoicesOf = (taskId: string) =>
  Effect.gen(function* () {
    const [spot] = yield* spotsOf(taskId)
    if (spot === undefined) return null
    const { remote, base } = yield* startOf({ ...spot, toward: null })
    return { toward: spot.toward, defaultBranch: base, branches: yield* remoteBranches(spot.repository, remote, base) }
  }).pipe(Effect.orElseSucceed(() => null))
