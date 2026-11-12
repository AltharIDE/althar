import type { Check } from '@althar/connectors'
import { Timestamp } from '@althar/domain'
import { Clock, Duration, Effect, Option, Schema } from 'effect'

import { Connections } from './Connections'
import { placesOf } from './pullRequestList'
import { ToolRefused } from './toolErrors'

/** A wait reads only known code hosts, never a command supplied by an agent. */
const Until = Schema.Literals(['merged', 'checks_complete', 'checks_passed', 'changed'])
const Pull = Schema.Struct({ kind: Schema.Literal('pull_request'), repository: Schema.String, number: Schema.Int, until: Until })
const Checks = Schema.Struct({
  kind: Schema.Literal('checks'),
  repository: Schema.String,
  ref: Schema.String,
  until: Schema.Literals(['checks_complete', 'checks_passed']),
})
const Time = Schema.Struct({ kind: Schema.Literal('time'), at: Timestamp })
export const WaitFor = Schema.Struct({
  reason: Schema.String,
  conditions: Schema.Array(Schema.Union([Pull, Checks, Time])).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  mode: Schema.optional(Schema.Literals(['any', 'all'])),
  timeout_seconds: Schema.optional(Schema.Int),
})

const OnHost = { connectionId: Schema.String, path: Schema.Array(Schema.String) }
const Target = Schema.Union([Time, Schema.Struct({ ...Pull.fields, ...OnHost }), Schema.Struct({ ...Checks.fields, ...OnHost })])
const Condition = Schema.Struct({ target: Target, seen: Schema.NullOr(Schema.String), met: Schema.optional(Schema.Boolean) })

/** Kept on the held attempt, so shutdown and crash recovery need no running agent. */
export const ExternalWait = Schema.Struct({
  reason: Schema.String,
  conditions: Schema.Array(Condition).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  mode: Schema.Literals(['any', 'all']),
  since: Timestamp,
  deadline: Timestamp,
  nextCheck: Timestamp,
  lastCheck: Schema.NullOr(Timestamp),
  failures: Schema.Int,
  error: Schema.NullOr(Schema.String),
})
export type ExternalWait = typeof ExternalWait.Type
type Target = typeof Target.Type

export const waitTime = (millis: number) => Timestamp.make(new Date(millis).toISOString())
const ordered = (entries: ReadonlyArray<unknown>) => entries.map((entry) => JSON.stringify(entry)).sort((a, b) => a.localeCompare(b))

const Held = Schema.Struct({ externalWait: ExternalWait })
const decodeHeld = Schema.decodeUnknownOption(Schema.fromJsonString(Held))
export const externalWaitOf = (output: string | null): ExternalWait | undefined =>
  output === null ? undefined : Option.getOrUndefined(Option.map(decodeHeld(output), (held) => held.externalWait))

export interface Observation {
  readonly met: boolean
  readonly seen?: string
  readonly summary?: string
  readonly blocked?: string
  readonly error?: string
  readonly retryAt?: string
}

/** No checks is unknown, never a vacuously successful build. */
export const checksReady = (checks: ReadonlyArray<Check>, until: 'checks_complete' | 'checks_passed') =>
  checks.length > 0 &&
  checks.every((check) =>
    until === 'checks_complete'
      ? check.state !== 'queued' && check.state !== 'running'
      : check.state === 'passed' || check.state === 'skipped' || check.state === 'neutral',
  )

export const waitOutcome = (mode: 'any' | 'all', observations: ReadonlyArray<Observation>) => {
  if (observations.some((one) => one.blocked !== undefined)) return 'blocked'
  return observations.length > 0 && (mode === 'all' ? observations.every((one) => one.met) : observations.some((one) => one.met))
    ? 'ready'
    : 'waiting'
}

/** Resolve names to the project's connected repositories before retaining a target. */
export const prepareExternalWait = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const asked = yield* Schema.decodeUnknownEffect(WaitFor)(input).pipe(
      Effect.mapError(
        () => new ToolRefused({ message: 'Give a reason and conditions: a pull_request, checks on a ref, or a time in UTC.' }),
      ),
    )
    const seconds = asked.timeout_seconds ?? 86_400
    const reason = asked.reason.replace(/\s+/g, ' ').trim()
    if (reason.length === 0 || reason.length > 240 || asked.conditions.length === 0 || asked.conditions.length > 16)
      return yield* new ToolRefused({ message: 'Give a short waiting reason and between 1 and 16 conditions.' })
    if (seconds < 1 || seconds > 604_800)
      return yield* new ToolRefused({ message: 'A wait lasts between 1 second and 7 days; the default is 24 hours.' })
    const now = yield* Clock.currentTimeMillis
    const deadline = waitTime(now + seconds * 1000)
    const places = asked.conditions.every((one) => one.kind === 'time') ? [] : (yield* placesOf(projectId)).places
    const conditions = yield* Effect.forEach(asked.conditions, (one) =>
      Effect.gen(function* () {
        if (one.kind === 'time') {
          if (!Number.isFinite(Date.parse(one.at)) || Date.parse(one.at) > Date.parse(deadline))
            return yield* new ToolRefused({ message: 'The wake-up time must be a real time before the wait expires.' })
          return { target: one, seen: null }
        }
        if ((one.kind === 'pull_request' && one.number < 1) || (one.kind === 'checks' && one.ref.trim() === ''))
          return yield* new ToolRefused({ message: 'Give a positive pull request number or a nonempty branch or commit ref.' })
        const named = one.repository.trim().toLowerCase()
        const matches = places.filter(
          (place) => typeof place !== 'string' && [place.name.toLowerCase(), place.path.join('/').toLowerCase()].includes(named),
        )
        const place = matches[0]
        if (matches.length !== 1 || typeof place === 'string' || place === undefined)
          return yield* new ToolRefused({ message: `Name one connected repository of this project unambiguously: ${one.repository}.` })
        return { target: { ...one, connectionId: place.connectionId, path: place.path }, seen: null }
      }),
    )
    return {
      reason,
      conditions,
      mode: asked.mode ?? 'any',
      since: waitTime(now),
      deadline,
      nextCheck: waitTime(now),
      lastCheck: null,
      failures: 0,
      error: null,
    } satisfies ExternalWait
  })

/** One read of a typed condition. Connector caches and rate-limit rules still apply. */
export const observeExternal = (condition: ExternalWait['conditions'][number]) =>
  Effect.gen(function* () {
    const { target } = condition
    if (target.kind === 'pull_request' && target.until === 'changed' && condition.met === true)
      return {
        met: true,
        ...(condition.seen === null ? {} : { seen: condition.seen }),
        summary: `${target.repository}#${target.number} changed during this wait.`,
      }
    if (target.kind === 'time')
      return { met: (yield* Clock.currentTimeMillis) >= Date.parse(target.at), seen: target.at, summary: `Time reached: ${target.at}.` }
    const { host } = yield* (yield* Connections).adapters(target.connectionId)
    if (host === undefined) return yield* new ToolRefused({ message: 'The connection no longer reaches this code host.' })
    const repository = yield* host.repository(target.path)
    if (target.kind === 'checks') {
      const checks = yield* host.checks(repository, target.ref, { strict: true })
      return observedChecks(target, checks, target.ref)
    }
    const pull = yield* host.change(repository, target.number, { queue: true })
    const name = `${target.repository}#${target.number}`
    if (target.until === 'merged')
      return {
        met: pull.state === 'merged',
        seen: pull.state,
        summary: `${name}: ${pull.state}.`,
        ...(pull.state === 'closed'
          ? { blocked: `${name} was closed without merging. Decide whether to reopen it or change the goal.` }
          : {}),
      }
    if (target.until === 'changed') {
      const checks = pull.headSha === null ? [] : yield* host.checks(repository, pull.headSha, { strict: true })
      const activity = yield* host.activity(repository, target.number, null)
      // Ignore ordering and clocks that do not describe a host change. Include new review/comment identities and queue results.
      const seen = JSON.stringify([
        pull.state,
        pull.headSha,
        pull.updatedAt,
        pull.queued,
        pull.leftQueue,
        pull.queueSha,
        ordered(checks.map((one) => [one.id, one.state])),
        ordered(activity.comments.map((one) => [one.id, one.at])),
        ordered(activity.reviews.map((one) => [one.id, one.at])),
      ])
      return {
        met: condition.seen !== null && seen !== condition.seen,
        seen,
        summary: `${name} changed; read its current state before acting.`,
      }
    }
    if (pull.state !== 'open')
      return { met: true, seen: pull.state, summary: `${name} is ${pull.state}; there are no open-PR checks to wait for.` }
    if (pull.headSha === null) return { met: false, summary: `${name}: its head is not known yet.` }
    return observedChecks(target, yield* host.checks(repository, pull.headSha, { strict: true }), pull.headSha)
  }).pipe(Effect.timeout(Duration.seconds(30)))

const observedChecks = (target: Exclude<Target, { readonly kind: 'time' }>, checks: ReadonlyArray<Check>, head: string): Observation => ({
  met: target.until !== 'merged' && target.until !== 'changed' && checksReady(checks, target.until),
  seen: JSON.stringify([head, ordered(checks.map((one) => [one.id, one.state]))]),
  summary: `${target.repository}${target.kind === 'pull_request' ? `#${target.number}` : ` at ${target.ref}`}: ${checks.length === 0 ? 'no checks reported' : checks.map((one) => `${one.name}: ${one.state}`).join(', ')}.`,
})
