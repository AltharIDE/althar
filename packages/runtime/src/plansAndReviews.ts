import {
  PLANS_AND_REVIEWS,
  type PlansAndReviews,
  type PlansAndReviewsChange,
  NEW_PROJECT_DEFAULTS,
  type NewProjectDefaults,
  type NewProjectDefaultsChange,
} from '@althar/contracts'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { timestamp } from './records'

/*
 * The person's settings for how plans start and how long review goes on, and for what the
 * rules of a project start with when it is made, kept for the profile
 * (the `settings` table: a row a setting, only once it differs from the value
 * it had before they were settings, so a profile that never changed one has
 * none). Each is read where it applies, not when Althar starts, so a change
 * takes hold at the next plan proposed or round of review, without a restart.
 *
 * Where each value lived before: the plan countdown in Plans.ts (`COUNTDOWN`,
 * 25 s) and the review rounds in Runs.ts (`ROUNDS`, 3). When a quiet turn is
 * restarted and when agents check in stay Althar's (Stalls.ts).
 */

const COUNTDOWN = 'plan_countdown_seconds'
const ROUNDS = 'review_rounds'

const PERMISSIONS = 'new_project_permissions'
const USAGE_LIMIT = 'new_project_usage_limit'
const ROTATE = 'new_project_rotate_accounts'
const END = 'new_project_end'

const ALL = [COUNTDOWN, ROUNDS, PERMISSIONS, USAGE_LIMIT, ROTATE, END] as const

const rowsOf = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ key: string; value: string }>`SELECT key, value FROM settings WHERE key IN ${sql.in(ALL)}`
  return new Map(rows.map((row) => [row.key, row.value]))
})

/** A kept number, where it is one of the choices there are. */
const numberOf = <N extends number>(kept: string | undefined, choices: ReadonlyArray<N>, fallback: N): N => {
  const value = kept === undefined ? Number.NaN : Number(kept)
  return choices.find((choice) => choice === value) ?? fallback
}

const choiceOf = <S extends string>(kept: string | undefined, choices: ReadonlyArray<S>, fallback: S): S =>
  choices.find((choice) => choice === kept) ?? fallback

const COUNTDOWNS: ReadonlyArray<PlansAndReviews['countdown']> = [0, 10, 25, 60]
const ROUND_CHOICES: ReadonlyArray<PlansAndReviews['rounds']> = [1, 2, 3, 5]

/** How long work goes on alone now. */
export const plansAndReviewsOf = Effect.map(rowsOf, (kept): PlansAndReviews => ({
  countdown: numberOf(kept.get(COUNTDOWN), COUNTDOWNS, PLANS_AND_REVIEWS.countdown),
  rounds: numberOf(kept.get(ROUNDS), ROUND_CHOICES, PLANS_AND_REVIEWS.rounds),
}))

/** How long a proposed plan waits now before it starts on its own. */
export const countdownNow = Effect.map(plansAndReviewsOf, (settings) => Duration.seconds(settings.countdown))

/** How many rounds of review a task has now. */
export const roundsNow = Effect.map(plansAndReviewsOf, (settings) => settings.rounds)

/** What the rules of a project made now start with. */
export const newProjectDefaultsOf = Effect.map(rowsOf, (kept): NewProjectDefaults => ({
  permissions: choiceOf(kept.get(PERMISSIONS), ['rules', 'coordinator', 'ask'], NEW_PROJECT_DEFAULTS.permissions),
  usageLimit: choiceOf(kept.get(USAGE_LIMIT), ['move', 'wait', 'ask'], NEW_PROJECT_DEFAULTS.usageLimit),
  rotateAccounts: kept.get(ROTATE) === 'on',
  end: choiceOf(kept.get(END), ['draft', 'ready', 'none'], NEW_PROJECT_DEFAULTS.end),
}))

/** Keeps a setting, or, at the value it has without one, forgets it. */
const keep = (key: string, value: string | number | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (value === null) return yield* sql`DELETE FROM settings WHERE key = ${key}`.pipe(Effect.asVoid)
    const at = yield* timestamp
    yield* sql`INSERT INTO settings ${sql.insert({ key, value: String(value), updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

const unlessDefault = <A extends string | number>(value: A, fallback: A) => (value === fallback ? null : value)

/** Changes how long work goes on alone; what isn't given stays. */
export const setPlansAndReviews = (change: PlansAndReviewsChange) =>
  Effect.gen(function* () {
    if (change.countdown !== undefined) yield* keep(COUNTDOWN, unlessDefault(change.countdown, PLANS_AND_REVIEWS.countdown))
    if (change.rounds !== undefined) yield* keep(ROUNDS, unlessDefault(change.rounds, PLANS_AND_REVIEWS.rounds))
  })

/** Changes what the rules of projects made from now on start with; what isn't given stays. */
export const setNewProjectDefaults = (change: NewProjectDefaultsChange) =>
  Effect.gen(function* () {
    if (change.permissions !== undefined) yield* keep(PERMISSIONS, unlessDefault(change.permissions, NEW_PROJECT_DEFAULTS.permissions))
    if (change.usageLimit !== undefined) yield* keep(USAGE_LIMIT, unlessDefault(change.usageLimit, NEW_PROJECT_DEFAULTS.usageLimit))
    if (change.rotateAccounts !== undefined) yield* keep(ROTATE, change.rotateAccounts ? 'on' : null)
    if (change.end !== undefined) yield* keep(END, unlessDefault(change.end, NEW_PROJECT_DEFAULTS.end))
  })
