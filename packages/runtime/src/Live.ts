import type { SessionEvent } from '@charrette/provider-adapters'
import { Context, Effect, Layer, PubSub, Stream } from 'effect'

/*
 * What is happening now, for clients that watch: every event an agent
 * streams, and the runtime's own turns, sessions and questions for the
 * person. It is not the record, which is in the store; a client that missed
 * something reads the store and the change feed.
 */

export type LiveEvent =
  | { readonly _tag: 'Agent'; readonly threadId: string; readonly event: SessionEvent }
  | {
      readonly _tag: 'SessionStarted'
      readonly threadId: string
      readonly sessionId: string
      readonly agentId: string
      readonly model?: string
    }
  | { readonly _tag: 'SessionEnded'; readonly threadId: string; readonly sessionId: string; readonly state: string }
  | { readonly _tag: 'TurnStarted'; readonly threadId: string; readonly turnId: string }
  | { readonly _tag: 'TurnEnded'; readonly threadId: string; readonly turnId: string; readonly state: string; readonly errorClass?: string }
  | {
      readonly _tag: 'AttentionNeeded'
      readonly threadId: string
      readonly attentionId: string
      readonly title: string
      readonly reason: string
    }
  | {
      readonly _tag: 'AttentionClosed'
      readonly threadId: string
      readonly attentionId: string
      readonly outcome: 'answered' | 'withdrawn'
    }

export class Live extends Context.Service<
  Live,
  {
    publish(event: LiveEvent): Effect.Effect<void>
    /** Events from the moment the stream is run. */
    readonly events: Stream.Stream<LiveEvent>
  }
>()('@charrette/runtime/Live') {
  static readonly layer: Layer.Layer<Live> = Layer.effect(
    Live,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<LiveEvent>()
      return Live.of({ publish: (event) => Effect.asVoid(PubSub.publish(pubsub, event)), events: Stream.fromPubSub(pubsub) })
    }),
  )
}
