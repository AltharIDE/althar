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

import { AlwaysNotOffered, AttentionClosed, NotFound } from './errors'
import { currentBranch } from './git'
import { Instance } from './Instance'
import { Live } from './Live'
import { Policies, type Remembered, ruleSetOf } from './Policies'
import { change, fact, timestamp } from './records'
import {
  type AllowRule,
  type Always,
  type AlwaysScope,
  alwaysOf,
  commandOf,
  decide,
  decideReader,
  essentials,
  pathsOf,
  type RuleContext,
  sayAllowRule,
  type Verdict,
} from './rules'

/*
 * Permission requests, answered from the project rules (ADR-007). Every
 * request is recorded, and so is every decision, with the option sent to the
 * agent, and, where the project's allow rules answered, the rules and the
 * revision they belong to. What the rules keep for the person becomes an
 * attention request, and the agent waits until the person answers or the
 * turn is cancelled. An answer can keep a rule (ADR-017): Allow always and
 * Deny always save one to the project, and every request still waiting is
 * decided again by the rules as they now are.
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
  /** What an "always" answer would keep, as the person was offered it. */
  readonly always: Always
}

/** The rule an "always" answer by this scope keeps, where it was offered: let through, or never allowed. */
export const rememberedOf = (always: Always, decision: 'allow' | 'reject', scope: AlwaysScope): Remembered | undefined => {
  const offered = decision === 'allow' ? always.allow : always.deny
  if (!offered.includes(scope)) return undefined
  const kept = decision === 'allow' ? ('allow' as const) : ('never' as const)
  switch (scope) {
    case 'exact':
      return always.command === null ? undefined : { decision: kept, pattern: always.command, match: 'exact' }
    case 'prefix':
      return always.prefix === null ? undefined : { decision: kept, pattern: always.prefix, match: 'prefix' }
    case 'kind':
      return always.kind === null ? undefined : { decision: kept, kind: always.kind }
  }
}

/** What a waiting request's call keeps of what an "always" would save, as its payload holds it. */
const alwaysPayload = (always: Always) => ({
  command: always.command,
  prefix: always.prefix,
  kind: always.kind,
  allow: always.allow,
  deny: always.deny,
})

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
    /** The person's answer to an attention request; with `always`, the rule it keeps, by the scope they chose of those offered. */
    answer(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly decision: 'allow' | 'reject'
      readonly reason?: string
      readonly always?: AlwaysScope
    }): Effect.Effect<void, AttentionClosed | NotFound | AlwaysNotOffered>
    /** Withdraws every request a session is still waiting on, as when its agent has gone. */
    withdrawAll(sessionId: string): Effect.Effect<void>
    /** Decides again every request of a project still waiting on the person, by its rules as they now are: what they no longer keep for the person is answered. */
    reconsider(projectId: string): Effect.Effect<void>
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
        /** The project's allow rules that answered, and the revision of the rules they are in. */
        readonly cited?: { readonly rules: ReadonlyArray<AllowRule>; readonly policyId: string }
        /** The rule the person's "always" answer kept. */
        readonly saved?: Remembered
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
            rule: input.cited === undefined ? null : JSON.stringify(input.cited.rules),
            policyId: input.cited?.policyId ?? null,
            actionDigest: input.digest,
            decidedAt: yield* timestamp,
          })}`
          yield* fact({
            projectId: input.context.projectId,
            aggregateType: 'decision',
            aggregateId: id,
            revision: 1,
            type: 'decision.made',
            payload: {
              outcome: input.decision.decision,
              optionId: answer.optionId,
              scope: answer.scope,
              reason: input.decision.reason,
              ...(input.cited === undefined ? {} : { rules: input.cited.rules }),
              ...(input.saved === undefined ? {} : { saved: input.saved }),
            },
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

      /**
       * A session waiting on the person goes back to work once nothing it
       * asked still waits; one already at work stays as it is.
       */
      const release = (sessionId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
          if (session?.state !== 'waiting_approval') return
          const [open] = yield* sql<{ count: number }>`
            SELECT count(*) AS count FROM attention_requests a JOIN permission_requests r ON r.id = a.permission_request_id
            WHERE r.provider_session_id = ${sessionId} AND a.state = 'open'`
          if ((open?.count ?? 0) === 0) yield* moveSession(sessionId, 'active')
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
              yield* release(waiter.context.sessionId)
              return true
            }),
          )
          if (withdrawn)
            yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'withdrawn' })
        })

      /** A task's request as the project's rules decide it now, with the context they read it in and the revision they are. */
      const judge = (requestContext: RequestContext, request: PermissionRequest) =>
        Effect.gen(function* () {
          const rules = requestContext.rules.role === 'task' ? requestContext.rules.context : { worktree: '', defaultBranch: '' }
          // Where a push without a destination goes depends on the branch checked out now.
          const current = request.kind === 'execute' || request.kind === 'other' ? yield* currentBranch(rules.worktree) : undefined
          // The project's rules as they are now: a change the person makes applies to the next request.
          const policy = yield* policies.current(requestContext.projectId)
          const context: RuleContext = {
            ...rules,
            project: ruleSetOf(policy.rules),
            ...(current === undefined ? {} : { currentBranch: current }),
          }
          return { context, verdict: decide(request, context), policyId: policy.id }
        })

      /** What the rules answer, as the decision sent: refused with why, or allowed, by the allow rules that did where they did. */
      const decisionOf = (
        verdict: Exclude<Verdict, { readonly verdict: 'ask' }>,
        policyId: string,
      ): {
        readonly decision: PermissionDecision
        readonly cited?: { readonly rules: ReadonlyArray<AllowRule>; readonly policyId: string }
      } => {
        if (verdict.verdict === 'deny') return { decision: { decision: 'reject', reason: verdict.reason } }
        const [first] = verdict.rules ?? []
        return first === undefined || verdict.rules === undefined
          ? { decision: { decision: 'allow', reason: 'Allowed by the project rules.' } }
          : {
              decision: { decision: 'allow', reason: `Always allowed: ${sayAllowRule(first)}.` },
              cited: { rules: verdict.rules, policyId },
            }
      }

      /**
       * Answers a request still waiting as the rules now say, as the person
       * would have: its call answered, the decision recorded as the rules',
       * the session back at work, and the agent told. Only the first answer
       * to a call does anything.
       */
      const settle = (
        attentionId: string,
        waiter: Waiting,
        decided: {
          readonly decision: PermissionDecision
          readonly cited?: { readonly rules: ReadonlyArray<AllowRule>; readonly policyId: string }
        },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const settled = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [attention] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${attentionId}`
              if (attention?.state !== 'open') return false
              const revision = yield* change('attention_requests', attentionId, { state: 'answered', answeredAt: yield* timestamp })
              yield* fact({
                projectId: waiter.context.projectId,
                aggregateType: 'attention_request',
                aggregateId: attentionId,
                revision,
                type: 'attention_request.answered',
                actorId: instance.systemId,
              })
              yield* recordDecision({
                ...waiter,
                decision: decided.decision,
                actorId: instance.systemId,
                ...(decided.cited === undefined ? {} : { cited: decided.cited }),
              })
              yield* release(waiter.context.sessionId)
              return true
            }),
          )
          if (!settled) return
          waiting.delete(attentionId)
          yield* Deferred.succeed(waiter.deferred, decided.decision)
          yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'answered' })
        })

      const reconsider = (projectId: string) =>
        Effect.forEach(
          [...waiting].filter(([, waiter]) => waiter.context.projectId === projectId && waiter.context.rules.role === 'task'),
          ([attentionId, waiter]) =>
            Effect.gen(function* () {
              const { verdict, policyId } = yield* judge(waiter.context, waiter.request)
              if (verdict.verdict !== 'ask') yield* settle(attentionId, waiter, decisionOf(verdict, policyId))
            }).pipe(Effect.ignore),
          { discard: true },
        )

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
          const { context: ruleContext, verdict, policyId } = yield* judge(requestContext, request)
          // What the rules refuse outright, such as an agent changing things on the code host, is answered at once with what to do instead.
          if (verdict.verdict !== 'ask') {
            const { decision, cited } = decisionOf(verdict, policyId)
            yield* sql.withTransaction(
              recordDecision({
                context: requestContext,
                request,
                requestId,
                digest,
                decision,
                actorId: instance.systemId,
                ...(cited === undefined ? {} : { cited }),
              }),
            )
            return decision
          }
          // What isn't held for the person is where a judge would answer first (DEV-22: the lead decides); for now it waits for the person.
          const always = alwaysOf(request, ruleContext)

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
                  held: verdict.held,
                  always: alwaysPayload(always),
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
              const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${requestContext.sessionId}`
              if (session?.state !== 'waiting_approval') yield* moveSession(requestContext.sessionId, 'waiting_approval')
            }),
          )
          const waiter: Waiting = {
            deferred: yield* Deferred.make<PermissionDecision>(),
            context: requestContext,
            request,
            requestId,
            digest,
            always,
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

        answer: ({ envelope, attentionId, decision, reason, always }) =>
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
              // An "always" keeps the rule the person was offered by that scope, and nothing they weren't.
              const saved = always === undefined ? undefined : rememberedOf(waiter.always, decision, always)
              if (always !== undefined && saved === undefined) return yield* new AlwaysNotOffered({ attentionId, scope: always })
              const answered: PermissionDecision = { decision, ...(reason === undefined ? {} : { reason }) }
              yield* commands.execute({
                envelope,
                projectId: waiter.context.projectId,
                result: Schema.Void,
                handle: Effect.gen(function* () {
                  // Answered meanwhile by the rules, as when another answer kept a rule that covers it.
                  const [attention] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${attentionId}`
                  if (attention?.state !== 'open') return yield* new AttentionClosed({ attentionId })
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
                    ...(saved === undefined ? {} : { saved }),
                  })
                  yield* release(waiter.context.sessionId)
                  // The rule goes in with the answer, as a revision of the project's rules recorded as the person's.
                  if (saved !== undefined) yield* policies.remember(waiter.context.projectId, saved, envelope.actorId)
                }),
              })
              waiting.delete(attentionId)
              yield* Deferred.succeed(waiter.deferred, answered)
              yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'answered' })
              // A rule kept answers every other request it now covers, or refuses.
              if (saved !== undefined) yield* reconsider(waiter.context.projectId)
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

        reconsider: (projectId) => run(reconsider(projectId)),

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
