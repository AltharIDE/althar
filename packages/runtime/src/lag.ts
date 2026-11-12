import { monitorEventLoopDelay } from 'node:perf_hooks'

import { Duration, Effect, type Scope } from 'effect'

/*
 * How late the runtime's thread ran, for whoever works on Althar: in a
 * development build the app asks for it (`ALTHAR_LAG_LOG`), and every few
 * seconds the runtime's log says how late its event loop ran where it ran
 * late at all, so work that holds the one thread the window is answered on
 * shows where it happens rather than as a window that crawls. A window's
 * call that took long says so too, by its name (`slowCall`).
 */

/** Whether the app asked for the log of a late loop: a development build does. */
export const lagLogged = (env: NodeJS.ProcessEnv = process.env) => env.ALTHAR_LAG_LOG === '1'

/** How late the loop may run before a window of it is said. */
export const LATE = Duration.millis(100)

/** How long a window's call may take before it is said. */
export const SLOW_CALL = Duration.millis(250)

/** How late the loop ran over the last window: its worst, its p99 and its mean, in milliseconds. */
export interface Lag {
  readonly maxMs: number
  readonly p99Ms: number
  readonly meanMs: number
}

/** What a histogram of the loop's delay says, as a window of it. */
export const lagOf = (histogram: { readonly max: number; readonly mean: number; percentile(p: number): number }): Lag => {
  const ms = (ns: number) => Math.round(ns / 1e5) / 10
  return { maxMs: ms(histogram.max), p99Ms: ms(histogram.percentile(99)), meanMs: Number.isNaN(histogram.mean) ? 0 : ms(histogram.mean) }
}

/**
 * Watches the loop for as long as its scope lasts, saying each window of `every` in which it ran later than `late`.
 * `read` is how a window is read, the loop's own histogram unless a test says.
 */
export const watchLag = (
  options: { readonly every?: Duration.Duration; readonly late?: Duration.Duration; readonly read?: () => Lag } = {},
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const late = Duration.toMillis(options.late ?? LATE)
    const histogram = options.read === undefined ? monitorEventLoopDelay({ resolution: 20 }) : undefined
    histogram?.enable()
    yield* Effect.addFinalizer(() => Effect.sync(() => histogram?.disable()))
    const read =
      options.read ??
      (() => {
        const lag = lagOf(histogram ?? { max: 0, mean: 0, percentile: () => 0 })
        histogram?.reset()
        return lag
      })
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.andThen(
          Effect.sleep(options.every ?? Duration.seconds(5)),
          Effect.suspend(() => {
            const lag = read()
            return lag.maxMs > late
              ? Effect.logWarning('Event loop ran late').pipe(
                  Effect.annotateLogs({ max_ms: lag.maxMs, p99_ms: lag.p99Ms, mean_ms: lag.meanMs }),
                )
              : Effect.void
          }),
        ),
      ),
    )
  })

/** A window's call that took longer than `SLOW_CALL`, said with its name and how long, where the lag log is on. */
export const slowCall = <A, E, R>(name: Effect.Effect<string>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.timed(effect).pipe(
    Effect.flatMap(([took, value]) =>
      Duration.isGreaterThan(took, SLOW_CALL)
        ? Effect.flatMap(name, (call) =>
            Effect.logWarning('Slow call').pipe(Effect.annotateLogs({ call, ms: Math.round(Duration.toMillis(took)) }), Effect.as(value)),
          )
        : Effect.succeed(value),
    ),
  )
