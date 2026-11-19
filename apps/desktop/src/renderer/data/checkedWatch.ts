import { ApiError, FeedPosition, type ProjectList, type WatchEvent } from '@althar/contracts'
import { Effect, Schema, Stream } from 'effect'

const snapshotRequired = () =>
  new ApiError({ reason: 'SnapshotRequired', message: 'This home’s history changed. Read a fresh snapshot before continuing.' })
export const checkedPosition = (value: unknown, homeId: string): FeedPosition => {
  const position = Schema.decodeUnknownSync(FeedPosition)(value)
  if (position.homeId !== homeId) throw new ApiError({ reason: 'HomeMismatch', message: 'This snapshot belongs to another home.' })
  if ((position.cursor === 0) !== (position.checkpoint === null)) throw snapshotRequired()
  return position
}

/** Remote feeds never fall back to an unscoped numeric cursor or replay a command after a broken connection. */
export const checkedWatch = <E>(
  api: {
    readonly watch: (position: FeedPosition) => Stream.Stream<WatchEvent, E>
    readonly snapshot: () => Effect.Effect<ProjectList, E>
  },
  homeId: string,
  initial: FeedPosition,
  listener: (event: WatchEvent) => void,
  started?: () => void,
  reset?: () => void,
) =>
  Effect.gen(function* () {
    let position = checkedPosition(initial, homeId)
    let resnapshotted = false
    for (;;) {
      const result = yield* Stream.runForEach(
        Stream.onStart(
          api.watch(position),
          Effect.sync(() => started?.()),
        ),
        (event) =>
          Effect.try({
            try: () => {
              if (event._tag === 'Changed') {
                const next = checkedPosition({ homeId, cursor: event.cursor, checkpoint: event.checkpoint }, homeId)
                if (next.cursor < position.cursor || (next.cursor === position.cursor && next.checkpoint !== position.checkpoint))
                  throw snapshotRequired()
                position = next
                resnapshotted = false
              }
              listener(event)
            },
            catch: (error) => (error instanceof ApiError ? error : snapshotRequired()),
          }),
      ).pipe(Effect.result)
      if (
        result._tag === 'Failure' &&
        result.failure instanceof ApiError &&
        result.failure.reason === 'SnapshotRequired' &&
        !resnapshotted
      ) {
        resnapshotted = true
        const snapshot = yield* api.snapshot()
        position = yield* Effect.try({
          try: () => checkedPosition(snapshot.position, homeId),
          catch: (error) => (error instanceof ApiError ? error : snapshotRequired()),
        })
        yield* Effect.sync(() => reset?.())
      } else if (result._tag === 'Failure') return yield* Effect.fail(result.failure)
      else
        return yield* Effect.fail(
          new ApiError({ reason: 'ConnectionClosed', message: 'The home disconnected. Its work continues; reconnect to carry on.' }),
        )
    }
  })
