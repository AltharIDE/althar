import { Effect, Schema } from 'effect'

/*
 * The lifecycles drawn in docs/architecture/03 (provider session) and 05 (node
 * attempt), as data. A state may move only along an edge listed here; a state
 * with no edges is terminal.
 */

export const NodeAttemptState = Schema.Literals([
  'ready',
  'admitted',
  'running',
  'waiting_attention',
  'verifying',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'uncertain',
  'reconciling',
  'held',
  'superseded',
])
export type NodeAttemptState = typeof NodeAttemptState.Type

export const ProviderSessionState = Schema.Literals([
  'probing',
  'auth_required',
  'ready',
  'starting',
  'active',
  'waiting_approval',
  'completed',
  'cancelling',
  'cancelled',
  'lost',
  'reconciling',
  'uncertain',
  'failed',
  'superseded',
])
export type ProviderSessionState = typeof ProviderSessionState.Type

export interface Lifecycle<S extends string> {
  readonly name: string
  readonly edges: { readonly [From in S]: ReadonlyArray<S> }
}

/**
 * A switch to another agent ends the current attempt as `superseded`; a new
 * attempt of the same node takes over. `held` waits without a person, for
 * example for a usage limit to reset, and goes back to running.
 */
export const nodeAttemptLifecycle: Lifecycle<NodeAttemptState> = {
  name: 'node attempt',
  edges: {
    ready: ['admitted'],
    admitted: ['running', 'cancelled'],
    running: ['waiting_attention', 'held', 'verifying', 'succeeded', 'failed', 'cancelling', 'uncertain', 'superseded'],
    waiting_attention: ['running', 'cancelling', 'superseded'],
    verifying: ['succeeded', 'failed', 'uncertain'],
    cancelling: ['cancelled', 'uncertain'],
    held: ['running', 'cancelling', 'superseded'],
    uncertain: ['reconciling'],
    reconciling: ['succeeded', 'failed', 'waiting_attention'],
    succeeded: [],
    failed: [],
    cancelled: [],
    superseded: [],
  },
}

/** A session replaced by a switch ends as `superseded`, and its controller is fenced. */
export const providerSessionLifecycle: Lifecycle<ProviderSessionState> = {
  name: 'provider session',
  edges: {
    probing: ['auth_required', 'ready', 'failed'],
    auth_required: ['ready', 'failed'],
    ready: ['starting'],
    starting: ['active', 'failed'],
    active: ['waiting_approval', 'completed', 'cancelling', 'lost', 'superseded'],
    waiting_approval: ['active', 'cancelling', 'superseded'],
    cancelling: ['cancelled', 'uncertain'],
    lost: ['reconciling'],
    reconciling: ['active', 'uncertain', 'failed'],
    completed: [],
    cancelled: [],
    uncertain: [],
    failed: [],
    superseded: [],
  },
}

export const canTransition = <S extends string>(lifecycle: Lifecycle<S>, from: S, to: S): boolean => lifecycle.edges[from].includes(to)

export const isTerminal = <S extends string>(lifecycle: Lifecycle<S>, state: S): boolean => lifecycle.edges[state].length === 0

export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()('InvalidTransition', {
  lifecycle: Schema.String,
  from: Schema.String,
  to: Schema.String,
}) {}

/** Succeeds with the new state when the lifecycle allows the move, and fails with `InvalidTransition` otherwise. */
export const transition = <S extends string>(lifecycle: Lifecycle<S>, from: S, to: S): Effect.Effect<S, InvalidTransition> =>
  canTransition(lifecycle, from, to) ? Effect.succeed(to) : Effect.fail(new InvalidTransition({ lifecycle: lifecycle.name, from, to }))
