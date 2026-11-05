import { Clock, Context, Effect, Exit, Layer } from 'effect'

/** Desktop releases background work after its first screen; headless runtimes start it immediately. */
export const AfterOpen = Context.Reference<Effect.Effect<void>>('@althar/runtime/AfterOpen', { defaultValue: () => Effect.void })

export const afterOpen = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(AfterOpen, (opened) => Effect.andThen(opened, effect))

/** Kept in runtime.log, including unfinished steps when a launch stops. No profile paths or account data. */
export const startup = <A, E, R>(stage: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis
    yield* Effect.logInfo('Startup').pipe(Effect.annotateLogs({ stage, phase: 'start', at_ms: began }))
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.flatMap(Clock.currentTimeMillis, (ended) =>
          Effect.logInfo('Startup').pipe(
            Effect.annotateLogs({ stage, phase: Exit.isSuccess(exit) ? 'done' : 'failed', duration_ms: ended - began, at_ms: ended }),
          ),
        ),
      ),
    )
  })

/** Measures only this service's construction, after its dependencies have been built. */
export const startupLayer = <A, E, R>(stage: string, layer: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
  Layer.fromBuildMemo((memo, scope) => startup(stage, Layer.buildWithMemoMap(layer, memo, scope)))
