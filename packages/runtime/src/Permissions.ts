import { createHash } from 'node:crypto'

import {
  type ActorId,
  type CommandEnvelope,
  Ids,
  newId,
  type ProjectId,
  providerSessionLifecycle,
  type ProviderSessionState,
  transition,
} from '@althar/domain'
import { Commands, Ledger } from '@althar/persistence-sqlite'
import { answerFor, type PermissionDecision, type PermissionMeanings, type PermissionRequest } from '@althar/provider-adapters'
import { Context, Crypto, Deferred, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { AttentionClosed, NotFound } from './errors'
import { currentBranch } from './git'
import { Instance } from './Instance'
import { Live } from './Live'
import { Policies, ruleSetOf } from './Policies'
import { change, fact, timestamp } from './records'
import { commandOf, decide, decideReader, essentials, pathsOf, type RuleContext } from './rules'

/*
 * Permission requests, answered from the project rules (ADR-007). Every
 * request is recorded, and so is every decision, with the option sent to the
 * agent. What the rules keep for the person becomes an attention request, and
 * the agent waits until the person answers or the turn is cancelled.
 */

/** Where a request comes from, and what the rules need to decide it. */
export interface RequestContext {
  readonly projectId: ProjectId
  readonly threadId: string
  /** The task the session works on; none for the coordinator. */
  readonly taskId: string | null
  /** The provider session's row id. */
  readonly sessionId: string
  readonly meanings: PermissionMeanings
  /** A task's lead works under the project rules; a role that only reads, under the reader's rules, which never ask. */
  readonly rules: { readonly role: 'task'; readonly context: RuleContext } | { readonly role: 'reader' }
}

interface Waiting {
  readonly deferred: Deferred.Deferred<PermissionDecision>
  readonly context: RequestContext
  readonly request: PermissionRequest
  readonly requestId: string
  readonly digest: string
}

/** A digest of what the action does, so a decision is tied to exactly this action. */
export const actionDigest = (request: PermissionRequest) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        kind: request.kind,
        title: request.title,
        command: commandOf(request),
        paths: pathsOf(request),
        rawInput: request.rawInput ?? null,
      }),
    )
    .digest('hex')

/** Moves a session along its lifecycle; a move the lifecycle doesn't allow is a bug. */
export const moveSession = (sessionId: string, to: ProviderSessionState, set: Readonly<Record<string, unknown>> = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: ProviderSessionState }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
    if (row === undefined) return yield* Effect.die(new NotFound({ kind: 'provider_session', id: sessionId }))
    yield* Effect.orDie(transition(providerSessionLifecycle, row.state, to))
    return yield* change('provider_sessions', sessionId, { ...set, state: to })
  })

type Store = SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto | Instance | Live | Policies

export class Permissions extends Context.Service<
  Permissions,
  {
    /** Decides a request: the adapter's `onPermission`. */
    decide(context: RequestContext, request: PermissionRequest): Effect.Effect<PermissionDecision>
    /** The person's answer to an attention request. */
    answer(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly decision: 'allow' | 'reject'
      readonly reason?: string
    }): Effect.Effect<void, AttentionClosed | NotFound>
    /** Withdraws every request a session is still waiting on, as when its agent has gone. */
    withdrawAll(sessionId: string): Effect.Effect<void>
  }
>()('@althar/runtime/Permissions') {
  static readonly layer: Layer.Layer<Permissions, never, Store> = Layer.effect(
    Permissions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const policies = yield* Policies
      const live = yield* Live
      const waiting = new Map<string, Waiting>()
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const recordDecision = (input: {
        readonly context: RequestContext
        readonly request: PermissionRequest
        readonly requestId: string
        readonly digest: string
        readonly decision: PermissionDecision
        readonly actorId: ActorId
        readonly commandId?: CommandEnvelope['commandId']
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const answer = answerFor(input.request.options, input.decision.decision, input.context.meanings)
          const id = yield* newId(Ids.decision)
          yield* sql`INSERT INTO decisions ${sql.insert({
            id,
            projectId: input.context.projectId,
            permissionRequestId: input.requestId,
            outcome: input.decision.decision,
            scope: answer.scope ?? 'once',
            agentOptionId: answer.optionId,
            reason: input.decision.reason ?? null,
            decidedByActorId: input.actorId,
            actionDigest: input.digest,
            decidedAt: yield* timestamp,
          })}`
          yield* fact({
            projectId: input.context.projectId,
            aggregateType: 'decision',
            aggregateId: id,
            revision: 1,
            type: 'decision.made',
            payload: { outcome: input.decision.decision, optionId: answer.optionId, scope: answer.scope, reason: input.decision.reason },
            actorId: input.actorId,
            ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
          })
          const revision = yield* change('permission_requests', input.requestId, { state: 'decided' })
          yield* fact({
            projectId: input.context.projectId,
            aggregateType: 'permission_request',
            aggregateId: input.requestId,
            revision,
            type: 'permission_request.decided',
            actorId: input.actorId,
          })
        })

      /** Ends a wait without a decision: the turn was cancelled or the session ended. Only the first call does anything. */
      const withdraw = (attentionId: string, waiter: Waiting) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          waiting.delete(attentionId)
          const withdrawn = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [attention] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${attentionId}`
              if (attention?.state !== 'open') return false
              const attentionRevision = yield* change('attention_requests', attentionId, { state: 'withdrawn' })
              yield* fact({
                projectId: waiter.context.projectId,
                aggregateType: 'attention_request',
                aggregateId: attentionId,
                revision: attentionRevision,
                type: 'attention_request.withdrawn',
                actorId: instance.systemId,
              })
              const requestRevision = yield* change('permission_requests', waiter.requestId, { state: 'cancelled' })
              yield* fact({
                projectId: waiter.context.projectId,
                aggregateType: 'permission_request',
                aggregateId: waiter.requestId,
                revision: requestRevision,
                type: 'permission_request.cancelled',
                actorId: instance.systemId,
              })
              const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${waiter.context.sessionId}`
              if (session?.state === 'waiting_approval') yield* moveSession(waiter.context.sessionId, 'active')
              return true
            }),
          )
          if (withdrawn)
            yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'withdrawn' })
        })

      const decideRequest = (requestContext: RequestContext, request: PermissionRequest) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const requestId = yield* newId(Ids.permissionRequest)
          const digest = actionDigest(request)
          const kept = essentials(request.rawInput)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO permission_requests ${sql.insert({
                id: requestId,
                projectId: requestContext.projectId,
                providerSessionId: requestContext.sessionId,
                toolCallId: request.toolCallId,
                toolKind: request.kind,
                title: request.title,
                // The rules read the whole input; the record keeps its command and paths (07), and names what it left out.
                rawInput: JSON.stringify(kept.cut.length === 0 ? kept.input : { ...kept.input, _cut: kept.cut }),
                options: JSON.stringify(request.options),
                actionDigest: digest,
                state: 'open',
                receivedAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: requestContext.projectId,
                aggregateType: 'permission_request',
                aggregateId: requestId,
                revision: 1,
                type: 'permission_request.received',
                payload: { title: request.title, kind: request.kind },
                actorId: instance.systemId,
              })
            }),
          )
          // A role that only reads is answered at once: allowed, or refused with a reason it reads.
          if (requestContext.rules.role === 'reader') {
            const read = decideReader(request)
            const decision: PermissionDecision =
              read.verdict === 'allow'
                ? { decision: 'allow', reason: 'This role may do this.' }
                : { decision: 'reject', reason: read.reason }
            yield* sql.withTransaction(
              recordDecision({ context: requestContext, request, requestId, digest, decision, actorId: instance.systemId }),
            )
            return decision
          }
          const rules = requestContext.rules.context
          // Where a push without a destination goes depends on the branch checked out now.
          const current = request.kind === 'execute' || request.kind === 'other' ? yield* currentBranch(rules.worktree) : undefined
          // The project's rules as they are now: a change the person makes applies to the next request.
          const project = ruleSetOf((yield* policies.current(requestContext.projectId)).rules)
          const verdict = decide(request, { ...rules, project, ...(current === undefined ? {} : { currentBranch: current }) })
          // What the rules refuse outright, such as an agent changing things on the code host, is answered at once with what to do instead.
          if (verdict.verdict === 'deny') {
            const decision: PermissionDecision = { decision: 'reject', reason: verdict.reason }
            yield* sql.withTransaction(
              recordDecision({ context: requestContext, request, requestId, digest, decision, actorId: instance.systemId }),
            )
            return decision
          }
          if (verdict.verdict === 'allow') {
            const decision: PermissionDecision = { decision: 'allow', reason: 'Allowed by the project rules.' }
            yield* sql.withTransaction(
              recordDecision({ context: requestContext, request, requestId, digest, decision, actorId: instance.systemId }),
            )
            return decision
          }

          const attentionId = yield* newId(Ids.attentionRequest)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO attention_requests ${sql.insert({
                id: attentionId,
                projectId: requestContext.projectId,
                taskId: requestContext.taskId,
                permissionRequestId: requestId,
                kind: 'permission',
                addresseeActorId: instance.personId,
                payload: JSON.stringify({
                  title: request.title,
                  kind: request.kind,
                  command: commandOf(request),
                  paths: pathsOf(request),
                  reason: verdict.reason,
                }),
                actionDigest: digest,
                state: 'open',
                createdAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: requestContext.projectId,
                aggregateType: 'attention_request',
                aggregateId: attentionId,
                revision: 1,
                type: 'attention_request.opened',
                payload: { reason: verdict.reason },
                actorId: instance.systemId,
              })
              yield* moveSession(requestContext.sessionId, 'waiting_approval')
            }),
          )
          const waiter: Waiting = {
            deferred: yield* Deferred.make<PermissionDecision>(),
            context: requestContext,
            request,
            requestId,
            digest,
          }
          waiting.set(attentionId, waiter)
          yield* live.publish({
            _tag: 'AttentionNeeded',
            threadId: requestContext.threadId,
            attentionId,
            title: request.title,
            reason: verdict.reason,
          })
          return yield* Deferred.await(waiter.deferred).pipe(
            Effect.onExit((exit) => (exit._tag === 'Success' ? Effect.void : Effect.ignore(run(withdraw(attentionId, waiter))))),
          )
        })

      return Permissions.of({
        decide: (requestContext, request) =>
          // A request the store couldn't record, or rules that failed, get a rejection: nothing runs that wasn't allowed.
          run(decideRequest(requestContext, request)).pipe(
            Effect.catchCause(() => Effect.succeed<PermissionDecision>({ decision: 'reject', reason: 'Althar could not decide.' })),
          ),

        answer: ({ envelope, attentionId, decision, reason }) =>
          run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const commands = yield* Commands
              const waiter = waiting.get(attentionId)
              if (waiter === undefined) {
                // A retry of an answer already given is answered from its receipt; anything else is too late.
                return yield* commands.execute({
                  envelope,
                  result: Schema.Void,
                  handle: Effect.gen(function* () {
                    const [row] = yield* sql<{ id: string }>`SELECT id FROM attention_requests WHERE id = ${attentionId}`
                    return yield* row === undefined
                      ? Effect.fail<NotFound | AttentionClosed>(new NotFound({ kind: 'attention_request', id: attentionId }))
                      : Effect.fail<NotFound | AttentionClosed>(new AttentionClosed({ attentionId }))
                  }),
                })
              }
              const answered: PermissionDecision = { decision, ...(reason === undefined ? {} : { reason }) }
              yield* commands.execute({
                envelope,
                projectId: waiter.context.projectId,
                result: Schema.Void,
                handle: Effect.gen(function* () {
                  const revision = yield* change('attention_requests', attentionId, { state: 'answered', answeredAt: yield* timestamp })
                  yield* fact({
                    projectId: waiter.context.projectId,
                    aggregateType: 'attention_request',
                    aggregateId: attentionId,
                    revision,
                    type: 'attention_request.answered',
                    actorId: envelope.actorId,
                    commandId: envelope.commandId,
                  })
                  yield* recordDecision({
                    ...waiter,
                    context: waiter.context,
                    decision: answered,
                    actorId: envelope.actorId,
                    commandId: envelope.commandId,
                  })
                  yield* moveSession(waiter.context.sessionId, 'active')
                }),
              })
              waiting.delete(attentionId)
              yield* Deferred.succeed(waiter.deferred, answered)
              yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'answered' })
            }).pipe(
              Effect.catchTags({
                SqlError: Effect.die,
                SchemaError: Effect.die,
                CommandIdReused: Effect.die,
                RowNotFound: Effect.die,
                RevisionConflict: Effect.die,
              }),
            ),
          ),

        withdrawAll: (sessionId) =>
          run(
            Effect.forEach(
              [...waiting].filter(([, waiter]) => waiter.context.sessionId === sessionId),
              // Withdrawn here, before the session's end is recorded; the waiting decision then ends too.
              ([attentionId, waiter]) => Effect.andThen(Effect.ignore(withdraw(attentionId, waiter)), Deferred.interrupt(waiter.deferred)),
              { discard: true },
            ),
          ),
      })
    }),
  )
}
