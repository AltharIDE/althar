import type { PlanUsage as PlanUsageView, WatchEvent } from '@althar/contracts'
import type { SessionEvent } from '@althar/provider-adapters'

import type { Draft } from './drafts'
import type { ShownLaunch } from './Launches'
import type { ShownLeftRunning } from './leftRunning'
import { Context, Effect, Layer, PubSub, Queue, type Scope, Stream } from 'effect'

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
      /** Where the thread places it. */
      readonly sequence: number
      readonly kind: 'agent_message' | 'agent_thought'
      readonly agentId: string
      readonly text: string
    }
  /** A command's output as far as it has come, as its last lines, keyed by its tool call's item. */
  | { readonly _tag: 'Output'; readonly threadId: string; readonly itemId: string; readonly text: string; readonly dropped: number }
  /** What the session on a thread has left running, whole each time it changes (leftRunning.ts). */
  | { readonly _tag: 'Background'; readonly threadId: string; readonly background: ReadonlyArray<ShownLeftRunning> }
  /** What Althar runs of a project itself, whole each time it changes (Launches.ts). */
  | { readonly _tag: 'Launches'; readonly projectId: string; readonly launches: ReadonlyArray<ShownLaunch> }
  /** The tasks a coordinator is drafting now, as far as written, whole each time they change (drafts.ts). */
  | { readonly _tag: 'Drafting'; readonly threadId: string; readonly drafts: ReadonlyArray<Draft> }
  /** Every account's plan usage and the warnings not yet seen, whole each time either changes (PlanUsage.ts). */
  | { readonly _tag: 'PlanUsage'; readonly usage: PlanUsageView }
  | {
      readonly _tag: 'SessionStarted'
      readonly threadId: string
      readonly sessionId: string
      readonly agentId: string
      readonly model?: string
    }
  | { readonly _tag: 'SessionEnded'; readonly threadId: string; readonly sessionId: string; readonly state: string }
  /** The computer came online, or went offline, as the app says (`Connectivity.ts`). */
  | { readonly _tag: 'Connection'; readonly online: boolean }
  /**
   * The person's own message to a thread was accepted (from the window or a paired device), whichever way it is delivered:
   * into a turn running, queued behind one, kept for a place among the agents at work, or as the turn that starts its lead
   * again. It is the person's word at the moment they send it, not when a turn picks it up.
   */
  | { readonly _tag: 'PersonSaid'; readonly threadId: string }
  /** A turn began; `byPerson` when it carries something the person said, not only what Althar wrote. */
  | { readonly _tag: 'TurnStarted'; readonly threadId: string; readonly turnId: string; readonly byPerson?: boolean }
  | {
      readonly _tag: 'TurnEnded'
      readonly threadId: string
      readonly turnId: string
      readonly state: string
      readonly errorClass?: string
      /** What the agent said went wrong, where the turn failed. */
      readonly failure?: string
      /** Why the agent stopped, as it said: `max_tokens` when its output ran out, say. */
      readonly stopReason?: string
    }
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
      /** For a request its agent went on without: what it was, and the person's answer, for its lead to be told. */
      readonly setAside?: { readonly title: string; readonly decision: 'allow' | 'reject' }
    }

/**
 * What a client watching is sent of an event: an agent's message or thought
 * as far as it has streamed, a command's output, how full an agent's context
 * is, and what the runtime sends whole as it changes. Nothing of the rest,
 * which is the runtime's own.
 */
export const watchedOf = (event: LiveEvent): WatchEvent | undefined => {
  switch (event._tag) {
    case 'Streaming':
      return {
        _tag: 'Streaming',
        threadId: event.threadId,
        itemId: event.itemId,
        sequence: event.sequence,
        kind: event.kind,
        agentId: event.agentId,
        text: event.text,
      }
    case 'Output':
      return { _tag: 'Output', threadId: event.threadId, itemId: event.itemId, text: event.text, dropped: event.dropped }
    case 'Agent':
      return event.event._tag === 'ContextUsage'
        ? { _tag: 'Context', threadId: event.threadId, used: event.event.used, size: event.event.size }
        : undefined
    case 'Background':
      return { _tag: 'Background', threadId: event.threadId, background: event.background }
    case 'Launches':
      return { _tag: 'Launches', projectId: event.projectId, launches: event.launches }
    case 'PlanUsage':
      return { _tag: 'PlanUsage', usage: event.usage }
    case 'Drafting':
      return { _tag: 'Drafting', threadId: event.threadId, drafts: event.drafts }
    default:
      return undefined
  }
}

/** What a watched event is of: a newer one of the same thing says all it said, whole. */
export const watchedKey = (event: WatchEvent): string => {
  switch (event._tag) {
    case 'Streaming':
    case 'Output':
      return `${event._tag}:${event.itemId}`
    case 'Launches':
      return `${event._tag}:${event.projectId}`
    case 'PlanUsage':
      return event._tag
    // A change from the store is its own: never one in place of another.
    case 'Changed':
      return `${event._tag}:${event.cursor}`
    default:
      return `${event._tag}:${event.threadId}`
  }
}

/**
 * What a client is sent of events that are each whole, as fast as it takes
 * them: while it is behind, a newer event of the same thing (`keyOf`) takes
 * the place of the one before it. What waits for a client that stalled is
 * at most one of each thing, never every event since, and what it gets when
 * it catches up is each thing as it is now. The events are taken as they
 * come, whether the client takes them or not, until the scope closes.
 */
export const newestOf = <A>(events: Stream.Stream<A>, keyOf: (event: A) => string): Effect.Effect<Stream.Stream<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // In the order each thing last changed: what changed longest ago goes first.
    const held = new Map<string, A>()
    const arrived = yield* Queue.sliding<void>(1)
    yield* Effect.forkScoped(
      Stream.runForEach(events, (event) =>
        Effect.sync(() => {
          const key = keyOf(event)
          held.delete(key)
          held.set(key, event)
          Queue.offerUnsafe(arrived, undefined)
        }),
      ),
    )
    const next: Effect.Effect<A> = Effect.suspend(() => {
      const first = held.entries().next()
      if (first.done === true) return Effect.andThen(Queue.take(arrived), next)
      held.delete(first.value[0])
      return Effect.succeed(first.value[1])
    })
    return Stream.fromEffectRepeat(next)
  })

/** How many messages a watch remembers how much of it sent, the latest: one streamed again after them is sent whole, as the first time. */
export const SENT_KEPT = 64

/**
 * A message as it streams, for one watch that asked for deltas: what came
 * after what this watch sent of it, from its `offset`; whole the first time.
 * Nothing, where nothing came since. A message's text only grows, so what was
 * sent of it is how long it was.
 */
export const deltasFor = () => {
  const sent = new Map<string, number>()
  return (event: WatchEvent): WatchEvent | undefined => {
    if (event._tag !== 'Streaming') return event
    const before = sent.get(event.itemId)
    sent.delete(event.itemId)
    sent.set(event.itemId, event.text.length)
    const oldest = sent.keys().next()
    if (sent.size > SENT_KEPT && oldest.done !== true) sent.delete(oldest.value)
    if (before === event.text.length) return undefined
    const offset = before !== undefined && before < event.text.length ? before : 0
    return { ...event, text: event.text.slice(offset), offset }
  }
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
>()('@althar/runtime/Live') {
  static readonly layer: Layer.Layer<Live> = Layer.effect(
    Live,
    Effect.gen(function* () {
      // Unbounded: the runtime's own subscribers must never miss a turn's end or a call for the person, and each takes what
      // comes as it comes. A client's watch, which may stall, takes from it as events come too, and holds the newest of each
      // thing for the client (`newestOf`), so a window that stops reading doesn't make this grow.
      const pubsub = yield* PubSub.unbounded<LiveEvent>()
      return Live.of({
        publish: (event) => Effect.asVoid(PubSub.publish(pubsub, event)),
        events: Stream.fromPubSub(pubsub),
        subscribe: Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription),
      })
    }),
  )
}
