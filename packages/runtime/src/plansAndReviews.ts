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
const ROUNDS_OUT = 'review_rounds_out'

const USAGE_LIMIT = 'new_project_usage_limit'
const ROTATE = 'new_project_rotate_accounts'
const END = 'new_project_end'
const PUSH_COMMITS = 'new_project_push_commits'
const POST_SCREENSHOTS = 'new_project_post_screenshots'
const RESOLVE_CONFLICTS = 'new_project_resolve_conflicts'
const MOVE_ISSUES = 'new_project_move_issues'

const ALL = [
  COUNTDOWN,
  ROUNDS,
  ROUNDS_OUT,
  USAGE_LIMIT,
  ROTATE,
  END,
  PUSH_COMMITS,
  POST_SCREENSHOTS,
  RESOLVE_CONFLICTS,
  MOVE_ISSUES,
] as const

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

/** A kept switch: `on` or `off`, kept only where it differs from the value it has without one. */
const switchOf = (kept: string | undefined, fallback: boolean): boolean => (kept === 'on' ? true : kept === 'off' ? false : fallback)

const COUNTDOWNS: ReadonlyArray<PlansAndReviews['countdown']> = [0, 10, 25, 60]
const ROUND_CHOICES: ReadonlyArray<PlansAndReviews['rounds']> = [1, 2, 3, 5]

/** How long work goes on alone now. */
export const plansAndReviewsOf = Effect.map(rowsOf, (kept): PlansAndReviews => ({
  countdown: numberOf(kept.get(COUNTDOWN), COUNTDOWNS, PLANS_AND_REVIEWS.countdown),
  rounds: numberOf(kept.get(ROUNDS), ROUND_CHOICES, PLANS_AND_REVIEWS.rounds),
  roundsOut: choiceOf(kept.get(ROUNDS_OUT), ['settled', 'ask'], PLANS_AND_REVIEWS.roundsOut),
}))

/** How long a proposed plan waits now before it starts on its own. */
export const countdownNow = Effect.map(plansAndReviewsOf, (settings) => Duration.seconds(settings.countdown))

/** How many rounds of review a task has now. */
export const roundsNow = Effect.map(plansAndReviewsOf, (settings) => settings.rounds)

/** What a task does now when its rounds of review run out with the lead's last fixes never reviewed. */
export const roundsOutNow = Effect.map(plansAndReviewsOf, (settings) => settings.roundsOut)

/** What the rules of a project made now start with. */
export const newProjectDefaultsOf = Effect.map(rowsOf, (kept): NewProjectDefaults => ({
  usageLimit: choiceOf(kept.get(USAGE_LIMIT), ['move', 'wait', 'ask'], NEW_PROJECT_DEFAULTS.usageLimit),
  rotateAccounts: kept.get(ROTATE) === 'on',
  end: choiceOf(kept.get(END), ['draft', 'ready', 'none'], NEW_PROJECT_DEFAULTS.end),
  pushCommits: switchOf(kept.get(PUSH_COMMITS), NEW_PROJECT_DEFAULTS.pushCommits),
  postScreenshots: switchOf(kept.get(POST_SCREENSHOTS), NEW_PROJECT_DEFAULTS.postScreenshots),
  resolveConflicts: switchOf(kept.get(RESOLVE_CONFLICTS), NEW_PROJECT_DEFAULTS.resolveConflicts),
  moveIssues: switchOf(kept.get(MOVE_ISSUES), NEW_PROJECT_DEFAULTS.moveIssues),
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
    if (change.roundsOut !== undefined) yield* keep(ROUNDS_OUT, unlessDefault(change.roundsOut, PLANS_AND_REVIEWS.roundsOut))
  })

/** Changes what the rules of projects made from now on start with; what isn't given stays. */
export const setNewProjectDefaults = (change: NewProjectDefaultsChange) =>
  Effect.gen(function* () {
    if (change.usageLimit !== undefined) yield* keep(USAGE_LIMIT, unlessDefault(change.usageLimit, NEW_PROJECT_DEFAULTS.usageLimit))
    if (change.rotateAccounts !== undefined) yield* keep(ROTATE, change.rotateAccounts ? 'on' : null)
    if (change.end !== undefined) yield* keep(END, unlessDefault(change.end, NEW_PROJECT_DEFAULTS.end))
    for (const [key, value, fallback] of [
      [PUSH_COMMITS, change.pushCommits, NEW_PROJECT_DEFAULTS.pushCommits],
      [POST_SCREENSHOTS, change.postScreenshots, NEW_PROJECT_DEFAULTS.postScreenshots],
      [RESOLVE_CONFLICTS, change.resolveConflicts, NEW_PROJECT_DEFAULTS.resolveConflicts],
      [MOVE_ISSUES, change.moveIssues, NEW_PROJECT_DEFAULTS.moveIssues],
    ] as const)
      if (value !== undefined) yield* keep(key, value === fallback ? null : value ? 'on' : 'off')
  })
