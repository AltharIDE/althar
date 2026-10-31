import {
  LONG_RUNS,
  type LongRuns,
  type LongRunsChange,
  NEW_PROJECT_DEFAULTS,
  type NewProjectDefaults,
  type NewProjectDefaultsChange,
} from '@althar/contracts'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { timestamp } from './records'

/*
 * The person's settings for how long work goes on alone, and for what the
 * rules of a project start with when it is made, kept for the profile
 * (the `settings` table: a row a setting, only once it differs from the value
 * it had before they were settings, so a profile that never changed one has
 * none). Each is read where it applies, not when Althar starts, so a change
 * takes hold at the next plan proposed, round of review or look at a running
 * turn, without a restart.
 *
 * Where each value lived before: the plan countdown in Plans.ts (`COUNTDOWN`,
 * 25 s), the review rounds in Runs.ts (`ROUNDS`, 3), and the quiet-turn and
 * check-in limits in Stalls.ts (10 minutes, 20 while a command runs; 6 hours
 * or 40 turns).
 */

const COUNTDOWN = 'plan_countdown_seconds'
const ROUNDS = 'review_rounds'
const QUIET = 'quiet_minutes'
const CHECK_IN = 'check_in_hours'

const PERMISSIONS = 'new_project_permissions'
const USAGE_LIMIT = 'new_project_usage_limit'
const ROTATE = 'new_project_rotate_accounts'
const END = 'new_project_end'

const ALL = [COUNTDOWN, ROUNDS, QUIET, CHECK_IN, PERMISSIONS, USAGE_LIMIT, ROTATE, END] as const

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

const COUNTDOWNS: ReadonlyArray<LongRuns['countdown']> = [0, 10, 25, 60]
const ROUND_CHOICES: ReadonlyArray<LongRuns['rounds']> = [1, 2, 3, 5]
const QUIETS: ReadonlyArray<LongRuns['quiet']> = [5, 10, 20]
const CHECK_INS: ReadonlyArray<LongRuns['checkIn']> = [2, 6, 12, 0]

/** How long work goes on alone now. */
export const longRunsOf = Effect.map(rowsOf, (kept): LongRuns => ({
  countdown: numberOf(kept.get(COUNTDOWN), COUNTDOWNS, LONG_RUNS.countdown),
  rounds: numberOf(kept.get(ROUNDS), ROUND_CHOICES, LONG_RUNS.rounds),
  quiet: numberOf(kept.get(QUIET), QUIETS, LONG_RUNS.quiet),
  checkIn: numberOf(kept.get(CHECK_IN), CHECK_INS, LONG_RUNS.checkIn),
}))

/** How long a proposed plan waits now before it starts on its own. */
export const countdownNow = Effect.map(longRunsOf, (settings) => Duration.seconds(settings.countdown))

/** How many rounds of review a task has now. */
export const roundsNow = Effect.map(longRunsOf, (settings) => settings.rounds)

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
export const setLongRuns = (change: LongRunsChange) =>
  Effect.gen(function* () {
    if (change.countdown !== undefined) yield* keep(COUNTDOWN, unlessDefault(change.countdown, LONG_RUNS.countdown))
    if (change.rounds !== undefined) yield* keep(ROUNDS, unlessDefault(change.rounds, LONG_RUNS.rounds))
    if (change.quiet !== undefined) yield* keep(QUIET, unlessDefault(change.quiet, LONG_RUNS.quiet))
    if (change.checkIn !== undefined) yield* keep(CHECK_IN, unlessDefault(change.checkIn, LONG_RUNS.checkIn))
  })

/** Changes what the rules of projects made from now on start with; what isn't given stays. */
export const setNewProjectDefaults = (change: NewProjectDefaultsChange) =>
  Effect.gen(function* () {
    if (change.permissions !== undefined) yield* keep(PERMISSIONS, unlessDefault(change.permissions, NEW_PROJECT_DEFAULTS.permissions))
    if (change.usageLimit !== undefined) yield* keep(USAGE_LIMIT, unlessDefault(change.usageLimit, NEW_PROJECT_DEFAULTS.usageLimit))
    if (change.rotateAccounts !== undefined) yield* keep(ROTATE, change.rotateAccounts ? 'on' : null)
    if (change.end !== undefined) yield* keep(END, unlessDefault(change.end, NEW_PROJECT_DEFAULTS.end))
  })
