import { Cause, Clock, Context, Duration, Effect, Layer, PubSub, Stream } from 'effect'

/*
 * What failed that Althar didn't expect (ADR-047). Each failure is kept to
 * what it belongs to: one agent's check, not every agent's; one call, not
 * the runtime. It is still told: written to the log, and said to the
 * desktop app's main process, which sends it as a crash report while the
 * person allows it (apps/desktop/src/main/crashReports.ts), masked there.
 * What the person caused or can put right is theirs to see, never reported.
 *
 * `where` is Althar's own name for the place it failed (a call such as
 * `Status`, or a part of one such as `Status.account`), and `agent` an
 * agent's id: never anything the person wrote or named.
 */

export interface Failure {
  readonly where: string
  readonly agent: string | null
  readonly name: string
  readonly message: string
  readonly stack: string
}

export interface FailuresService {
  /** Says a failure to whoever listens; never fails. */
  readonly report: (cause: Cause.Cause<unknown>, where: string, agent?: string) => Effect.Effect<void>
  readonly events: Stream.Stream<Failure>
}

/** Where none listens, as in tests and the CLI, a failure is only logged where it was kept. */
export const Failures = Context.Reference<FailuresService>('@althar/runtime/Failures', {
  defaultValue: () => ({ report: () => Effect.void, events: Stream.empty }),
})

/** How many unsaid failures are kept for a listener that is behind: the newest, as a storm's first ones say enough. */
const KEPT = 64

/** A failure as words that cross to another process: a tagged error by its tag, any error by its name, anything else as it says itself. */
export const failureOf = (cause: Cause.Cause<unknown>, where: string, agent: string | null = null): Failure => {
  const squashed = Cause.squash(cause)
  const tag =
    typeof squashed === 'object' && squashed !== null && '_tag' in squashed && typeof squashed._tag === 'string' ? squashed._tag : null
  if (squashed instanceof Error) {
    const name = tag ?? (squashed.name || 'Error')
    return { where, agent, name, message: squashed.message || name, stack: squashed.stack ?? '' }
  }
  let message: string
  try {
    message = String(squashed)
  } catch {
    message = typeof squashed
  }
  return { where, agent, name: tag ?? 'Error', message, stack: '' }
}

/** Failures said to the desktop app: one launch's, from where they happen to its main process. */
export const failuresLayer = Layer.effect(
  Failures,
  Effect.gen(function* () {
    const published = yield* PubSub.sliding<Failure>(KEPT)
    return {
      report: (cause, where, agent) =>
        Effect.suspend(() => PubSub.publish(published, failureOf(cause, where, agent ?? null))).pipe(Effect.asVoid, Effect.ignore),
      events: Stream.fromPubSub(published),
    } satisfies FailuresService
  }),
)

/**
 * `effect`, kept to what it is for: where it fails, other than by being
 * interrupted, the failure is logged and reported, and `fallback` stands in
 * for what it would have given, so whatever gathers it carries on.
 */
export const contained =
  <B>(where: string, fallback: (cause: Cause.Cause<unknown>) => B, agent?: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | B, never, R> =>
    Effect.catchCause(effect, (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.gen(function* () {
            yield* Effect.logWarning('Kept to where it failed', cause).pipe(
              Effect.annotateLogs(agent === undefined ? { where } : { where, agent }),
            )
            yield* (yield* Failures).report(cause, where, agent)
            return fallback(cause)
          }),
    )

/**
 * A loop kept going: a round of it that fails is kept to that round, as
 * `contained` keeps it, and the loop starts again `pause` after, so a
 * failure that comes back each time isn't met again at once.
 */
export const keptGoing = <E, R>(where: string, loop: Effect.Effect<never, E, R>, pause: Duration.Input = Duration.seconds(10)) =>
  Effect.forever(
    loop.pipe(
      contained(where, () => undefined),
      Effect.andThen(Effect.sleep(pause)),
    ),
  )

/**
 * A loop's items that failed, each kept apart for a while (ADR-047): one
 * that failed is tried again `first` after, twice as long after each time it
 * fails again, at most `most`, so the loop doesn't pick it again at once
 * and goes on with the rest meanwhile. One that goes through is forgotten.
 */
export const backoff = (first: Duration.Input = Duration.seconds(10), most: Duration.Input = Duration.minutes(10)) => {
  const failed = new Map<string, { readonly times: number; readonly until: number }>()
  return {
    /** When the item may be tried again, in milliseconds since the epoch: 0 for one that hasn't failed. */
    until: (key: string) => failed.get(key)?.until ?? 0,
    /** Runs `effect` for the item, kept to it as `contained` keeps it: where it fails, the item waits before it is tried again. */
    attempt: <A, E, R>(key: string, where: string, effect: Effect.Effect<A, E, R>, agent?: string): Effect.Effect<void, never, R> =>
      effect.pipe(
        Effect.as(true),
        contained(where, () => false, agent),
        Effect.flatMap((passed) =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            if (passed) return void failed.delete(key)
            const times = (failed.get(key)?.times ?? 0) + 1
            const wait = Math.min(Duration.toMillis(first) * 2 ** (times - 1), Duration.toMillis(most))
            failed.set(key, { times, until: now + wait })
          }),
        ),
      ),
  }
}
