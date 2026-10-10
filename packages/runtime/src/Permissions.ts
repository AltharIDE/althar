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
import { Cause, Context, Crypto, Deferred, Effect, Fiber, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { AlwaysNotOffered, AttentionClosed, NotFound } from './errors'
import { currentBranch } from './git'
import { Instance } from './Instance'
import { Live } from './Live'
import { PermissionJudge } from './PermissionJudge'
import { Policies, type Remembered, ruleSetOf } from './Policies'
import { change, fact, timestamp } from './records'
import {
  type AllowRule,
  type Always,
  type AlwaysScope,
  alwaysOf,
  alwaysRuleOf,
  holds,
  commandOf,
  decide,
  decideReader,
  essentials,
  pathsOf,
  type ProjectRuleSet,
  type RuleContext,
  sayAllowRule,
  type Verdict,
} from './rules'
import { addItem } from './threads'

/*
 * Permission requests, answered from the project rules (ADR-007). Every
 * request is recorded, and so is every decision, with the option sent to the
 * agent, and, where the project's allow rules answered, the rules and the
 * revision they belong to. Where the project has the coordinator decide,
 * what no rule answers, the allow rules included, is judged by it in a fresh
 * session (ADR-019). What the rules keep for the person, or the coordinator
 * leaves to them, becomes an attention request, and the agent waits until
 * the person answers or the turn is cancelled. An answer can keep a rule
 * (ADR-018): Allow always and Deny always save one to the project, and every
 * request still waiting is decided again by the rules as they now are.
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
  /** What the rules read it in: a task's lead's, as only a lead waits on the person. */
  readonly rules: RuleContext
  /** What an "always" answer would keep, as the call offered it: the words a scope keeps are these, never others found later. */
  readonly always: Always
}

/** The rule an "always" answer by this scope keeps, where it was offered: let through, or never allowed. */
export const rememberedOf = (always: Always, decision: 'allow' | 'reject', scope: AlwaysScope): Remembered | undefined =>
  (decision === 'allow' ? always.allow : always.deny).includes(scope)
    ? alwaysRuleOf(always, decision === 'allow' ? 'allow' : 'never', scope)
    : undefined

/** What a waiting request's call keeps of what an "always" would save, as its payload holds it. */
const alwaysPayload = (always: Always) => ({
  command: always.command,
  prefix: always.prefix,
  kind: always.kind,
  allow: always.allow,
  deny: always.deny,
})

/** A quiet receipt is bounded; the decision and judgment ledger retain the full text. */
const receiptLine = (text: string, limit = 200) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
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

type Store = SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto | Instance | Live | Policies | PermissionJudge

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
      const judge = yield* PermissionJudge
      const waiting = new Map<string, Waiting>()
      const deciding = new Map<Fiber.Fiber<PermissionDecision>, string>()
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
      const byRules = (projectId: ProjectId, rules: RuleContext, request: PermissionRequest) =>
        Effect.gen(function* () {
          // Where a push without a destination goes depends on the branch checked out now.
          const current = request.kind === 'execute' || request.kind === 'other' ? yield* currentBranch(rules.worktree) : undefined
          // The project's rules as they are now: a change the person makes applies to the next request.
          const policy = yield* policies.current(projectId)
          const project = ruleSetOf(policy.rules)
          const context: RuleContext = { ...rules, project, ...(current === undefined ? {} : { currentBranch: current }) }
          return { context, project, verdict: decide(request, context), policyId: policy.id }
        })

      /** What the rules answer, as the decision sent: refused with why, or allowed, by the allow rules that did where they did. */
      const decisionOf = (
        verdict: Extract<Verdict, { readonly verdict: 'allow' | 'deny' }>,
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

      /** Whether the rules settle a verdict themselves: refused, or allowed. */
      const settles = (verdict: Verdict): verdict is Extract<Verdict, { readonly verdict: 'allow' | 'deny' }> =>
        verdict.verdict === 'allow' || verdict.verdict === 'deny'

      /**
       * Decides again every request of a project still waiting on the person,
       * by its rules as they now are: what they now settle is answered. One
       * they would leave to the coordinator stays with the person, who has it.
       */
      const reconsider = (projectId: string) =>
        Effect.forEach(
          [...waiting].filter(([, waiter]) => waiter.context.projectId === projectId),
          ([attentionId, waiter]) =>
            Effect.gen(function* () {
              const { verdict, policyId } = yield* byRules(waiter.context.projectId, waiter.rules, waiter.request)
              if (settles(verdict)) yield* settle(attentionId, waiter, decisionOf(verdict, policyId))
            }).pipe(Effect.ignore),
          { discard: true },
        )

      /**
       * The coordinator's judgment of what no rule answers (ADR-019). It is
       * applied only where the rules, read again with the answer, still leave
       * the request to the coordinator: if they changed meanwhile, what they
       * now say decides, an allow rule kept meanwhile included, or the person.
       */
      const judged = (
        requestContext: RequestContext,
        request: PermissionRequest,
        requestId: string,
        digest: string,
        ruled: { readonly rules: RuleContext; readonly project: ProjectRuleSet; readonly context: RuleContext; readonly policyId: string },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const judgment = yield* judge.judge({ ...requestContext, request, rules: ruled.project, workspace: ruled.context })
          // A destination such as HEAD can change while the coordinator thinks. Git stays outside the transaction.
          const branchNow = request.kind === 'execute' || request.kind === 'other' ? yield* currentBranch(ruled.rules.worktree) : undefined
          // Re-read the rules and commit the answer together: a concurrent edit cannot slip past this check.
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const latest = yield* policies.current(requestContext.projectId)
              const changed = latest.id !== ruled.policyId
              const context: RuleContext = {
                ...ruled.rules,
                project: ruleSetOf(latest.rules),
                ...(branchNow === undefined ? {} : { currentBranch: branchNow }),
              }
              const next = decide(request, context)
              const applied = !changed && next.verdict === 'judge' && judgment.decision !== 'ask'
              const revision = yield* change('permission_requests', requestId, { state: 'open' })
              yield* fact({
                projectId: requestContext.projectId,
                aggregateType: 'permission_request',
                aggregateId: requestId,
                revision,
                type: 'permission_request.judged',
                actorId: instance.coordinatorId,
                payload: { ...judgment, policyId: ruled.policyId, applied },
              })
              if (applied) {
                const decision: PermissionDecision = {
                  decision: judgment.decision === 'allow' ? 'allow' : 'reject',
                  reason: judgment.reason,
                  ...(judgment.decision === 'deny' ? { decidedBy: 'coordinator' as const } : {}),
                }
                yield* recordDecision({ context: requestContext, request, requestId, digest, decision, actorId: instance.coordinatorId })
                yield* addItem(requestContext, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  about: 'permission',
                  requestId,
                  title: `${judgment.decision === 'allow' ? 'Allowed' : 'Denied'} ${receiptLine(request.title, 120)}`,
                  description: receiptLine(`By the coordinator: ${judgment.reason}`),
                })
                return { decision }
              }
              // Left to the person: not held, so their card offers the always answers, and an allow rule they keep answers next time first.
              const verdict: Exclude<Verdict, { readonly verdict: 'judge' }> =
                next.verdict === 'judge'
                  ? {
                      verdict: 'ask',
                      reason: changed
                        ? 'The project rules changed while the coordinator was deciding. Please decide this request.'
                        : judgment.reason,
                      held: false,
                    }
                  : next
              return { context, verdict, policyId: latest.id }
            }),
          )
        })

      const decideRequest = (requestContext: RequestContext, request: PermissionRequest) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const requestId = yield* newId(Ids.permissionRequest)
          return yield* Effect.gen(function* () {
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
            // The rules first, the allow rules among them: the coordinator judges only what none of them answers.
            const ruled = yield* byRules(requestContext.projectId, rules, request)
            let ruleContext = ruled.context
            let policyId = ruled.policyId
            let verdict: Exclude<Verdict, { readonly verdict: 'judge' }>
            if (ruled.verdict.verdict === 'judge') {
              const result = yield* judged(requestContext, request, requestId, digest, { ...ruled, rules })
              if ('decision' in result) return result.decision
              ruleContext = result.context
              policyId = result.policyId
              verdict = result.verdict
            } else verdict = ruled.verdict
            // What the rules refuse outright, such as an agent changing things on the code host, is answered at once with what to do
            // instead; what they let through, by the allow rules where they did, goes through.
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
            // The rest waits for the person, with what an "always" would keep, where it would hold.
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
              rules,
              always,
            }
            waiting.set(attentionId, waiter)
            // The rules may have changed while the call was being made, and been decided again without it: then it is decided again now.
            if ((yield* policies.current(requestContext.projectId)).id !== policyId) {
              const again = yield* byRules(requestContext.projectId, rules, request)
              if (settles(again.verdict)) yield* settle(attentionId, waiter, decisionOf(again.verdict, again.policyId))
            }
            if (waiting.has(attentionId))
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
          }).pipe(
            Effect.onInterrupt(() =>
              sql
                .withTransaction(
                  Effect.gen(function* () {
                    const [row] = yield* sql<{ state: string }>`SELECT state FROM permission_requests WHERE id = ${requestId}`
                    if (row?.state !== 'open') return
                    const revision = yield* change('permission_requests', requestId, { state: 'cancelled' })
                    yield* fact({
                      projectId: requestContext.projectId,
                      aggregateType: 'permission_request',
                      aggregateId: requestId,
                      revision,
                      type: 'permission_request.cancelled',
                      actorId: instance.systemId,
                    })
                  }),
                )
                .pipe(Effect.orDie),
            ),
          )
        })

      return Permissions.of({
        decide: (requestContext, request) =>
          Effect.gen(function* () {
            // Track the whole callback, including its commit, until the adapter gets the answer.
            const fiber = yield* Effect.forkChild(
              run(decideRequest(requestContext, request)).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.interrupt
                    : Effect.succeed<PermissionDecision>({ decision: 'reject', reason: 'Althar could not decide.' }),
                ),
              ),
            )
            deciding.set(fiber, requestContext.sessionId)
            return yield* Fiber.join(fiber).pipe(Effect.ensuring(Effect.sync(() => deciding.delete(fiber))))
          }),

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
              // An "always" keeps the very rule the call offered by that scope, and only while it would hold: checked again
              // with the answer, against the rules as they are then.
              let keep: { readonly scope: AlwaysScope; readonly rule: Remembered; readonly context: RuleContext } | undefined
              if (always !== undefined) {
                const rule = rememberedOf(waiter.always, decision, always)
                if (rule === undefined) return yield* new AlwaysNotOffered({ attentionId, scope: always })
                // Where a push without a destination goes is read now, from git, before the answer's transaction.
                keep = { scope: always, rule, context: (yield* byRules(waiter.context.projectId, waiter.rules, waiter.request)).context }
              }
              const answered: PermissionDecision = { decision, ...(reason === undefined ? {} : { reason }) }
              yield* commands.execute({
                envelope,
                projectId: waiter.context.projectId,
                result: Schema.Void,
                handle: Effect.gen(function* () {
                  // Answered meanwhile by the rules, as when another answer kept a rule that covers it.
                  const [attention] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${attentionId}`
                  if (attention?.state !== 'open') return yield* new AttentionClosed({ attentionId })
                  // A rule the rules as they now are would override, as when the person has since kept it for themselves, isn't kept.
                  if (keep !== undefined) {
                    const now = ruleSetOf((yield* policies.current(waiter.context.projectId)).rules)
                    if (!holds(waiter.request, { ...keep.context, project: now }, keep.rule))
                      return yield* new AlwaysNotOffered({ attentionId, scope: keep.scope })
                  }
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
                    ...(keep === undefined ? {} : { saved: keep.rule }),
                  })
                  yield* release(waiter.context.sessionId)
                  // The rule goes in with the answer, as a revision of the project's rules recorded as the person's.
                  if (keep !== undefined) yield* policies.remember(waiter.context.projectId, keep.rule, envelope.actorId)
                }),
              })
              waiting.delete(attentionId)
              yield* Deferred.succeed(waiter.deferred, answered)
              yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'answered' })
              // A rule kept answers every other request it now covers, or refuses.
              if (keep !== undefined) yield* reconsider(waiter.context.projectId)
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
            Effect.andThen(
              Effect.forEach(
                [...deciding].filter(([, ofSession]) => ofSession === sessionId),
                ([fiber]) => Fiber.interrupt(fiber),
                { discard: true },
              ),
              Effect.forEach(
                [...waiting].filter(([, waiter]) => waiter.context.sessionId === sessionId),
                // Withdrawn here, before the session's end is recorded; the waiting decision then ends too.
                ([attentionId, waiter]) =>
                  Effect.andThen(Effect.ignore(withdraw(attentionId, waiter)), Deferred.interrupt(waiter.deferred)),
                { discard: true },
              ),
            ),
          ),
      })
    }),
  )
}
