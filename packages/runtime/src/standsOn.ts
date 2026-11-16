import { stat } from 'node:fs/promises'

import { Clock, Context, Effect } from 'effect'

/*
 * What an answer kept between reads stands on, besides the store: what git
 * and the disk said as it was worked out, and until when the time it read
 * says the same. A board's cards are worked out once and kept (Queries.ts),
 * so a read after one task changed works out that card alone; a kept card
 * is given out again only while each of these still says what it said. What
 * can't be looked at again so (git started for an answer nothing keeps, or
 * the time read with nothing to say when what it decided changes) leaves the
 * answer unsure, and an unsure answer isn't kept.
 */

/**
 * One thing an answer read outside the store, and what it said: while it says the same again, the answer holds. Looks
 * of one key look at one thing, and are looked at once a read, however many answers stood on it.
 */
export interface Look {
  readonly key: string
  readonly again: () => Promise<string>
  readonly said: string
}

/** What an answer being worked out has read so far, outside the store. */
export interface StandsOn {
  readonly looks: Array<Look>
  /** What it read that can't be looked at again so, first: it isn't to be kept. Null while it read nothing so. */
  unsure: string | null
  /** When the time it read stops saying the same, in milliseconds; Infinity where it read none, or nothing that will. */
  until: number
}

/** What the answer being worked out stands on; none outside one, where nothing is noted. */
export const StandsOn = Context.Reference<StandsOn | null>('@althar/runtime/standsOn/StandsOn', { defaultValue: () => null })

/** Notes a look in what the answer being worked out stands on, where one is. */
export const noteLook = (look: Look): Effect.Effect<void> =>
  Effect.map(StandsOn, (on) => {
    on?.looks.push(look)
  })

/** Notes that the answer being worked out read something that can't be looked at again, and what: it isn't kept. */
export const noteUnsure = (what: string): Effect.Effect<void> =>
  Effect.map(StandsOn, (on) => {
    if (on !== null) on.unsure ??= what
  })

/** Notes what another kept answer stood on, given out as part of this one. */
export const noteAll = (from: StandsOn): Effect.Effect<void> =>
  Effect.map(StandsOn, (on) => {
    if (on === null) return
    on.looks.push(...from.looks)
    on.unsure ??= from.unsure
    on.until = Math.min(on.until, from.until)
  })

/** Runs `effect` without noting what it reads: its answer is kept by its own key, which is noted instead. */
export const unnoted = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.provideService(effect, StandsOn, null)

/** The time now, read without noting it: for `nowFor`, which says when it changes. */
const nowUnnoted = Clock.clockWith((clock) => Effect.sync(() => clock.currentTimeMillisUnsafe()))

/**
 * The time now, for a rule that holds from `since` for `within` milliseconds (still asked, between agents, still
 * drafting): what is worked out from it is noted to hold only until then.
 */
export const nowFor = (since: string | null, within: number): Effect.Effect<number> =>
  nowUntil(since === null ? Number.NaN : Date.parse(since) + within)

/** The time now, for rules that each change at one of `ends`, in milliseconds: what is worked out from it holds until the first to come. */
export const nowUntil = (...ends: ReadonlyArray<number>): Effect.Effect<number> =>
  Effect.gen(function* () {
    const now = yield* nowUnnoted
    const on = yield* StandsOn
    if (on !== null) for (const end of ends) if (Number.isFinite(end) && end > now) on.until = Math.min(on.until, end)
    return now
  })

/**
 * A clock that tells whoever reads the time from it: what Effect reads for itself (a span's times, a cache's age, a
 * log's date) reads it unsafely, and isn't told.
 */
const telling = (clock: Clock.Clock, read: () => void): Clock.Clock => ({
  currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
  currentTimeMillis: Effect.suspend(() => {
    read()
    return clock.currentTimeMillis
  }),
  currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
  currentTimeNanos: Effect.suspend(() => {
    read()
    return clock.currentTimeNanos
  }),
  monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: clock.monotonicTimeNanos,
  sleep: (duration) => clock.sleep(duration),
})

/**
 * Works `effect` out, with what it stands on: each look it made, until when the time it read says the same, and whether
 * it read anything unsure, the time read other than through `nowFor` among them. What it stands on is noted, too, in
 * any answer being worked out around it.
 */
export const workedOut = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<readonly [A, StandsOn], E, R> =>
  Effect.gen(function* () {
    const on: StandsOn = { looks: [], unsure: null, until: Number.POSITIVE_INFINITY }
    const clock = yield* Clock.Clock
    const value = yield* effect.pipe(
      Effect.provideService(StandsOn, on),
      Effect.provideService(
        Clock.Clock,
        telling(clock, () => {
          on.unsure ??= 'the time'
        }),
      ),
    )
    yield* noteAll(on)
    return [value, on] as const
  })

/**
 * Whether every look still says what it said: each key looked at once, and once a read where the read keeps what was
 * seen (`seen`); where one can't be looked at, none holds.
 */
export const holds = (looks: ReadonlyArray<Look>, seen: Map<string, Promise<string>> = new Map()): Effect.Effect<boolean> =>
  looks.length === 0
    ? Effect.succeed(true)
    : Effect.tryPromise(() =>
        Promise.all(
          looks.map((look) => {
            const found = seen.get(look.key)
            if (found !== undefined) return found
            const now = look.again()
            seen.set(look.key, now)
            return now
          }),
        ),
      ).pipe(
        Effect.map((now) => now.every((said, at) => said === looks[at]?.said)),
        Effect.orElseSucceed(() => false),
      )

/** Whether a path is there, as the disk says now, without waiting on the thread for it. */
const thereNow = (path: string) =>
  stat(path).then(
    () => 'there',
    () => 'gone',
  )

/** Whether a path is there, as the disk says now: noted, so what is worked out from it holds while it stays so. */
export const there = (path: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const said = yield* Effect.promise(() => thereNow(path))
    yield* noteLook({ key: `there ${path}`, again: () => thereNow(path), said })
    return said === 'there'
  })
