import type { SessionEvent } from '@charrette/provider-adapters'
import { Context, Effect, Layer, PubSub, type Scope, Stream } from 'effect'

/*
 * What is happening now, for clients that watch: every event an agent
 * streams, and the runtime's own turns, sessions and questions for the
 * person. It is not the record, which is in the store; a client that missed
 * something reads the store and the change feed.
 */

export type LiveEvent =
  | { readonly _tag: 'Agent'; readonly threadId: string; readonly event: SessionEvent }
  /** A message or thought as far as it has streamed, whole each time, keyed by the thread item it will be. */
  | {
      readonly _tag: 'Streaming'
      readonly threadId: string
      readonly itemId: string
      readonly kind: 'agent_message' | 'agent_thought'
      readonly text: string
    }
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
    /** Events from the moment this returns, for as long as the scope lasts: nothing published after it is missed. */
    readonly subscribe: Effect.Effect<Stream.Stream<LiveEvent>, never, Scope.Scope>
  }
>()('@charrette/runtime/Live') {
  static readonly layer: Layer.Layer<Live> = Layer.effect(
    Live,
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<LiveEvent>()
      return Live.of({
        publish: (event) => Effect.asVoid(PubSub.publish(pubsub, event)),
        events: Stream.fromPubSub(pubsub),
        subscribe: Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription),
      })
    }),
  )
}
