import { Clock, Context, Duration, Effect, Layer, Ref } from 'effect'

import { RuntimeConfig } from './Config'
import { Live } from './Live'

/*
 * Whether the computer is online, and whether an agent's service answers
 * (ADR-059). The desktop app says the first, from Electron's own reading of
 * the network, whenever it changes; without an app to say so, as for the
 * command-line client and tests, it is online. Each change is said on Live
 * (`Connection`), so what waits for the connection looks again. Whether a
 * service answers is a light request to its address: any answer at all, an
 * error included, means it can be reached. It is asked at most every few
 * seconds per address, however many steps wait on it.
 */

/** How long a service's answer stands before it is asked again. */
const KEPT = Duration.seconds(5)

/** How long a service has to answer. */
const WITHIN = Duration.seconds(5)

/** How long a step waits before each try again at a service that keeps failing while the computer is online. */
const PAUSES = [Duration.seconds(15), Duration.minutes(1), Duration.minutes(4)]

/** How often a step waiting for the connection asks again whether its service answers, while the computer is online. */
const EVERY = Duration.seconds(30)

/** Whether an address answers a light request, any answer at all, within the time given. */
const answersAt = (url: string) =>
  Effect.tryPromise(() => fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(Duration.toMillis(WITHIN)) })).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

export class Connectivity extends Context.Service<
  Connectivity,
  {
    /** Whether the computer is online, as the app last said: online until it says otherwise. */
    readonly online: Effect.Effect<boolean>
    /** The app says whether the computer is online; a change is said on Live. */
    set(online: boolean): Effect.Effect<void>
    /**
     * Whether a service answers at its address: never while the computer is
     * offline; without an address, whenever it is online.
     */
    answers(url: string | undefined): Effect.Effect<boolean>
    /** How long a step waits before each try again at a service that keeps failing while the computer is online. */
    readonly pauses: ReadonlyArray<Duration.Duration>
    /** How often a step waiting for the connection asks again whether its service answers. */
    readonly every: Duration.Duration
  }
>()('@althar/runtime/Connectivity') {
  static readonly layer: Layer.Layer<Connectivity, never, Live | RuntimeConfig> = Layer.effect(
    Connectivity,
    Effect.gen(function* () {
      const live = yield* Live
      const options = (yield* RuntimeConfig).connectivity ?? {}
      const ask = options.answers ?? answersAt
      const online = yield* Ref.make(true)
      const heard = new Map<string, { readonly at: number; readonly answers: boolean }>()
      return Connectivity.of({
        online: Ref.get(online),
        set: (now) =>
          Effect.gen(function* () {
            const was = yield* Ref.getAndSet(online, now)
            if (was === now) return
            // What was heard of each service before doesn't stand for after.
            heard.clear()
            yield* live.publish({ _tag: 'Connection', online: now })
          }),
        answers: (url) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(online))) return false
            if (url === undefined) return true
            const at = yield* Clock.currentTimeMillis
            const kept = heard.get(url)
            if (kept !== undefined && at - kept.at < Duration.toMillis(KEPT)) return kept.answers
            const answers = yield* ask(url)
            heard.set(url, { at, answers })
            return answers
          }),
        pauses: options.pauses ?? PAUSES,
        every: options.every ?? EVERY,
      })
    }),
  )
}
