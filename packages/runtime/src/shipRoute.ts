import type { Check, MergeRules } from '@althar/connectors'
import { ShipRoute, type ShipRouteOf, type ShipStop, type ShipUnderWay } from '@althar/contracts'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Changes } from './Changes'
import { checksNeedOf } from './mergeNeeds'
import { checksOf, nameOf } from './pullRequestWords'
import { timestamp } from './records'

/*
 * A Ship's route (a task is a conversation plus parts, "Ship"): whether its
 * review comes first, and how far it goes: as far as a push, ready for
 * review, or merged once the checks its target requires pass. The person
 * picks one for a Ship, or makes one their default; without either, the
 * task's own applies, which the card shows and a press without one takes:
 * both read it here, so they never differ.
 */

/** The settings key for the route every Ship takes unless the person picks another; no row, each task's own. */
const SHIP_ROUTE = 'ship_route'

const decodeRoute = Schema.decodeUnknownOption(Schema.fromJsonString(ShipRoute))

/** The person's default route for every Ship, where they made one. */
export const shipRouteSetting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${SHIP_ROUTE}`
  return row === undefined ? undefined : Option.getOrUndefined(decodeRoute(row.value))
})

/** Makes a route the person's default for every Ship; null goes back to each task's own, which keeps no row. */
export const setShipRoute = (route: ShipRoute | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (route === null) return yield* sql`DELETE FROM settings WHERE key = ${SHIP_ROUTE}`.pipe(Effect.asVoid)
    const at = yield* timestamp
    const value = JSON.stringify({ review: route.review, far: route.far })
    yield* sql`
      INSERT INTO settings ${sql.insert({ key: SHIP_ROUTE, value, updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

/** A plan's steps and timing, as much of them as decides whether a review reads its work before it ships. */
export interface Reviewed {
  readonly steps: ReadonlyArray<{ readonly key: string; readonly skipped?: boolean | undefined }>
  readonly reviewAfterMerge?: boolean | undefined
}

/** Whether a Ship of this plan has a review before the work goes up: a reviewer, and not one that reads only after the merge. */
export const reviewsBeforeShip = (plan: Reviewed) =>
  plan.reviewAfterMerge !== true && plan.steps.some((step) => step.key === 'review' && step.skipped !== true)

/** Whether one of these needs an approval from someone else: an approvals line needing more than it has. */
export const approvalShort = (
  needs: ReadonlyArray<{
    readonly kind: string
    readonly state: string
    readonly have?: number | undefined
    readonly need?: number | undefined
  }>,
) =>
  needs.some(
    (one) =>
      one.kind === 'approvals' && (one.need !== undefined ? (one.have ?? 0) < one.need : one.state === 'unmet' || one.state === 'waiting'),
  )

/**
 * The route a Ship takes when none is chosen for it: the person's default, else what the task's ending says (ready
 * for review where it ends ready, else as far as a push), each after its review. Bent where the task makes a stop
 * pointless: no review where it has no reviewer before the work ships, and no further than ready where its pull request
 * needs someone else's approval to merge.
 */
export const routeOf = (input: {
  readonly chosen: ShipRoute | undefined
  readonly reviewable: boolean
  readonly end: string | null | undefined
  readonly approvalShort: boolean
}): ShipRouteOf => {
  const wanted: ShipRoute = input.chosen ?? { review: true, far: input.end === 'ready' ? 'ready' : 'push' }
  const bent = wanted.far === 'merge' && input.approvalShort
  return {
    route: { review: wanted.review && input.reviewable, far: bent ? 'ready' : wanted.far },
    reviewable: input.reviewable,
    bent: bent ? 'approval' : null,
  }
}

/**
 * The route of a Ship under way, as its run keeps it; one admitted before routes went as far as its ending said, or merged
 * for Review and merge, its review as its steps say.
 */
export const routeOfShip = (
  ships: { readonly route?: ShipRoute | undefined; readonly merges?: boolean | undefined },
  steps: Reviewed['steps'],
  end: string | null | undefined,
): ShipRoute =>
  ships.route ?? {
    review: steps.some((step) => step.key === 'review' && step.skipped !== true),
    far: ships.merges === true ? 'merge' : end === 'ready' ? 'ready' : 'push',
  }

/**
 * The stop a Ship under way is at: past its push, where its run says (`at`); else by the step it is on, its review or
 * the lead settling what it found, or its push; between steps, its review while it still has one.
 */
export const shipStopOf = (input: {
  readonly at: 'ready' | 'merge' | undefined
  readonly step: string | undefined
  readonly reviewing: boolean
}): ShipStop =>
  input.at ??
  (input.step === 'review' || input.step === 'settle' ? 'review' : input.step === 'publish' ? 'push' : input.reviewing ? 'review' : 'push')

const UnderWay = Schema.Struct({
  steps: Schema.Array(Schema.Struct({ key: Schema.String, skipped: Schema.optional(Schema.Boolean) })),
  end: Schema.optional(Schema.NullOr(Schema.String)),
  reviewAfterMerge: Schema.optional(Schema.Boolean),
  ships: Schema.Struct({
    route: Schema.optional(ShipRoute),
    merges: Schema.optional(Schema.Boolean),
    at: Schema.optional(Schema.Literals(['ready', 'merge'])),
    reviewOnly: Schema.optional(Schema.Boolean),
  }),
})
const decodeUnderWay = Schema.decodeUnknownOption(Schema.fromJsonString(UnderWay))

/**
 * A Ship under way (`TaskView.shipping`), from its running run's parameters and the step it is on: its route, as changed
 * since, and its stop. None for a review added after the work went up, which sends nothing.
 */
export const shipUnderWayOf = (parameters: string, step: string | null): ShipUnderWay | undefined => {
  const run = Option.getOrUndefined(decodeUnderWay(parameters))
  if (run === undefined || run.ships.reviewOnly === true) return undefined
  return {
    route: routeOfShip(run.ships, run.steps, run.end),
    at: shipStopOf({ at: run.ships.at, step: step ?? undefined, reviewing: reviewsBeforeShip(run) }),
  }
}

const Planned = Schema.Struct({
  steps: Schema.Array(Schema.Struct({ key: Schema.String, skipped: Schema.optional(Schema.Boolean) })),
  reviewAfterMerge: Schema.optional(Schema.Boolean),
  end: Schema.optional(Schema.NullOr(Schema.String)),
  here: Schema.optional(Schema.Boolean),
})
const decodePlanned = Schema.decodeUnknownOption(Schema.fromJsonString(Planned))

const Rules = Schema.Struct({
  state: Schema.String,
  rules: Schema.optional(
    Schema.Struct({
      needs: Schema.Array(
        Schema.Struct({
          kind: Schema.String,
          state: Schema.String,
          have: Schema.optional(Schema.Number),
          need: Schema.optional(Schema.Number),
        }),
      ),
    }),
  ),
})
const decodeRules = Schema.decodeUnknownOption(Schema.fromJsonString(Rules))

/**
 * The plan a Ship of the task goes by, as Ship reads it: its first run's plan, else its latest run's parameters, else the
 * plan proposed or accepted last.
 */
const shipPlanOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [planned] = yield* sql<{ parameters: string }>`
      SELECT p.parameters FROM task_plans p JOIN runs r ON r.plan_id = p.id
      WHERE r.task_id = ${taskId} ORDER BY r.created_at, r.rowid LIMIT 1`
    if (planned !== undefined) return planned.parameters
    const [last] = yield* sql<{ parameters: string }>`
      SELECT parameters FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
    if (last !== undefined) return last.parameters
    const [proposed] = yield* sql<{ parameters: string }>`
      SELECT parameters FROM task_plans WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted')
      ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
    return proposed?.parameters
  })

/**
 * The task's own route for its next Ship (`TaskView.shipRoute`), as the card offers it and a press without one takes
 * it: one function for both. Its ending is its plan's, else the project's as it stands, which reads no remote.
 */
export const taskShipRoute = (changes: Changes['Service'], taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plan = Option.getOrUndefined(decodePlanned((yield* shipPlanOf(taskId)) ?? ''))
    const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
    const end =
      plan?.end ??
      (plan?.here === true
        ? 'draft'
        : task === undefined
          ? null
          : yield* changes.endFor(task.projectId, taskId).pipe(Effect.orElseSucceed(() => null)))
    // What merging its open pull requests needs, as their hosts last said.
    const links = yield* sql<{ snapshot: string }>`SELECT snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`
    const needs = links.flatMap((link) =>
      Option.match(decodeRules(link.snapshot), {
        onNone: () => [],
        onSome: (seen) => (seen.state === 'open' ? (seen.rules?.needs ?? []) : []),
      }),
    )
    return routeOf({
      chosen: yield* shipRouteSetting,
      reviewable: plan === undefined ? false : reviewsBeforeShip(plan),
      end,
      approvalShort: approvalShort(needs),
    })
  })

/**
 * Where an open pull request a Ship goes on to merge stands, read from its host now: gone (merged or closed); to merge
 * now, as its branch's merge queue waits for the checks itself, or every check it requires has passed (or the host
 * can't say which); waiting, on the required checks still to finish (optional ones never hold it); or not to merge, a
 * required check having failed, by name.
 */
export type MergeStanding =
  | { readonly kind: 'gone'; readonly name: string }
  | { readonly kind: 'merge'; readonly name: string }
  | { readonly kind: 'waiting'; readonly name: string; readonly target: string; readonly on: ReadonlyArray<string> }
  | { readonly kind: 'failed'; readonly name: string; readonly failed: ReadonlyArray<string> }

export const mergeStandingOf = (changes: Changes['Service'], taskId: string, url: string) =>
  Effect.gen(function* () {
    const { host, repository, change } = yield* changes.pullRequest(taskId, url)
    const name = nameOf(change)
    const read = yield* host.change(repository, change.number, { queue: true })
    if (read.state !== 'open') return { kind: 'gone', name } satisfies MergeStanding
    // In its branch's queue, or merging through one: the queue waits for its checks.
    if (read.queued === true) return { kind: 'merge', name } satisfies MergeStanding
    const ways = yield* host.mergeWays(repository, read.target).pipe(Effect.orElseSucceed(() => null))
    if (ways?.queue != null) return { kind: 'merge', name } satisfies MergeStanding
    const ran: ReadonlyArray<Check> | null = read.headSha === null ? null : yield* host.checks(repository, read.headSha)
    const rules: MergeRules | null =
      host.mergeRules === undefined ? null : yield* host.mergeRules(repository, read).pipe(Effect.orElseSucceed(() => null))
    const need = checksNeedOf(ran === null || read.headSha === null ? null : checksOf(read.headSha, ran), rules?.requiredChecks ?? null)
    if (need.state === 'unmet') return { kind: 'failed', name, failed: need.who ?? [] } satisfies MergeStanding
    if (need.state === 'waiting') return { kind: 'waiting', name, target: read.target, on: need.who ?? [] } satisfies MergeStanding
    return { kind: 'merge', name } satisfies MergeStanding
  })
