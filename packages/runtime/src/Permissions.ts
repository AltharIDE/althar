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
import { hostOf } from '@althar/contracts'
import { Commands, Ledger } from '@althar/persistence-sqlite'
import { answerFor, type PermissionDecision, type PermissionMeanings, type PermissionRequest } from '@althar/provider-adapters'
import { Cause, Context, Crypto, Deferred, Effect, Fiber, Layer, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { AlwaysNotOffered, AttentionClosed, NotFound } from './errors'
import { currentBranch } from './git'
import { Instance } from './Instance'
import { Live } from './Live'
import { PermissionJudge } from './PermissionJudge'
import { Policies, type Remembered, ruleSetOf } from './Policies'
import { runRules } from './automated'
import { touchCard } from './cards'
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
  decideInside,
  decideLeaving,
  decideReader,
  essentials,
  gitRunsOf,
  type Hold,
  lasting,
  pathsOf,
  type ProjectRuleSet,
  type RuleContext,
  runsInside,
  sayAllowRule,
  type TallyKind,
  tallyKindOf,
  type Verdict,
} from './rules'
import { passGuard } from './pushGuard'
import { type Reach, withEdits, workedOutReach } from './sandboxReach'
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
 *
 * Where a session's sandbox holds its shell commands (ADR-071), a command
 * it holds runs without the rules reading it, short of what the project
 * itself never allows or asks about; what crosses meets the rules. Every ask
 * and refusal is recorded with the kind it is counted as (`tallyKindOf`),
 * which the project's rules show the person.
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
  /**
   * A task's lead works under the project rules; a role that only reads,
   * under the reader's rules, which never ask: `offline`, as the lead of a
   * review of a pull request from outside is, with no fetch allowed either;
   * `cwd`, the folder a reader works in, which the paths it names are read from;
   * `trusted`, the coordinator in its own copies (ADR-058), never a review's lead;
   * `reads`, where a trusted reader's own tools for reading may reach.
   */
  readonly rules:
    | { readonly role: 'task'; readonly context: RuleContext }
    | {
        readonly role: 'reader'
        readonly offline?: boolean
        readonly web?: boolean
        readonly cwd?: string
        readonly trusted?: boolean
        readonly contained?: boolean
        readonly reads?: { readonly allowed: ReadonlyArray<string>; readonly denied: ReadonlyArray<string> }
      }
  /** How the session's sandbox holds its shell commands, where it has one Althar relies on (ADR-071). */
  readonly sandbox?: Hold
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
  /** Whether the session's sandbox holds it, so only what the project said itself keeps it. */
  readonly inside: boolean
  /** What it is counted as. */
  readonly kind: TallyKind
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

/**
 * A session waiting on the person goes back to work once nothing it asked
 * still waits, permission or question; one already at work stays as it is.
 */
export const releaseSession = (sessionId: string, options: { readonly questions: boolean } = { questions: true }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
    if (session?.state !== 'waiting_approval') return
    // Without its questions, where they no longer wait on this session: they wait on the thread.
    const [open] = yield* sql<{ count: number }>`
      SELECT count(*) AS count FROM attention_requests a LEFT JOIN permission_requests r ON r.id = a.permission_request_id
      WHERE a.state = 'open' AND (r.provider_session_id = ${sessionId}
        OR (${options.questions ? 1 : 0} = 1 AND a.kind = 'question' AND json_extract(a.payload, '$.sessionId') = ${sessionId}))`
    if ((open?.count ?? 0) === 0) yield* moveSession(sessionId, 'active')
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
    /**
     * What a lead's sandbox lets through from the start (`sandboxReach.ts`),
     * as its session starts: the commands it runs outside it, which still
     * ask and meet the rules, and the hosts it reaches without asking, only
     * those the rules would let a network request reach without anyone. A
     * change to the rules applies from the lead's next session.
     */
    upFront(projectId: ProjectId, taskId: string | null, rules: RuleContext): Effect.Effect<Reach, SqlError.SqlError | Schema.SchemaError>
    /** Withdraws every request a session is still waiting on, as when its agent has gone. */
    withdrawAll(sessionId: string): Effect.Effect<void>
    /** Decides again every request of a project still waiting on the person, by its rules as they now are: what they no longer keep for the person is answered. */
    reconsider(projectId: string): Effect.Effect<void>
    /**
     * Allows everything on one task, or takes it back (ADR-043), recorded as
     * the person's: turned on, what its agents wait on is decided again, and
     * goes ahead, short of what its project never allows.
     */
    allowEverything(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly on: boolean
    }): Effect.Effect<void, NotFound>
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
        /** What an ask or a refusal is counted as; none for what went ahead by itself. */
        readonly kind?: TallyKind
        /** Whether it was the person's answer to an ask. */
        readonly asked?: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const answer = answerFor(input.request.options, input.decision.decision, input.context.meanings)
          const id = yield* newId(Ids.decision)
          // What it is counted as, where it asked or was refused (ADR-071).
          const kind = input.asked === true || input.decision.decision === 'reject' ? (input.kind ?? 'other') : null
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
            kind,
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
              ...(kind === null ? {} : { kind }),
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
          // A lead's git lets through what the person allowed of what can't be undone, which its guard would stop (pushGuard.ts).
          const rules = input.context.rules
          if (input.decision.decision === 'allow' && rules.role === 'task' && lasting(input.request, rules.context))
            yield* Effect.sync(() => passGuard(input.context.sessionId, gitRunsOf(commandOf(input.request), rules.context)))
        })

      const release = releaseSession

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

      /**
       * The rules a task's requests are decided by now, and the revision they
       * are: its project's, everything allowed where the task itself allows
       * everything (ADR-043). An automation's run (docs/plans/automations.md)
       * allows everything where its automation says, and never pushes to the
       * default branch, which no switch goes past. A change the person makes
       * applies to the next request.
       */
      const rulesNow = (projectId: ProjectId, taskId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const policy = yield* policies.current(projectId)
          const project = ruleSetOf(policy.rules)
          const [task] =
            taskId === null
              ? []
              : yield* sql<{ allowEverything: number; automated: number | null }>`
                  SELECT k.allow_everything,
                    (SELECT json_extract(d.parts, '$.allowEverything') FROM automation_occurrences o
                      JOIN automation_definitions d ON d.automation_id = o.automation_id AND d.number = o.definition
                      WHERE o.task_id = k.id LIMIT 1) AS automated
                  FROM tasks k WHERE k.id = ${taskId}`
          if (task !== undefined && task.automated !== null)
            return { policy, project: runRules(project, task.automated === 1 || task.allowEverything === 1) }
          return { policy, project: task?.allowEverything === 1 ? { ...project, mode: 'allow' as const } : project }
        })

      /** A task's request as the rules decide it now, with the context they read it in and the revision they are. */
      const byRules = (
        projectId: ProjectId,
        taskId: string | null,
        rules: RuleContext,
        request: PermissionRequest,
        inside = false,
        held = false,
      ) =>
        Effect.gen(function* () {
          // Where a push without a destination goes depends on the branch checked out now.
          const current = request.kind === 'execute' || request.kind === 'other' ? yield* currentBranch(rules.worktree) : undefined
          const { policy, project } = yield* rulesNow(projectId, taskId)
          const context: RuleContext = { ...rules, project, ...(current === undefined ? {} : { currentBranch: current }) }
          // A command the session's sandbox holds meets only what the project said itself (ADR-071).
          return {
            context,
            project,
            verdict: inside ? decideInside(request, context) : held ? decideLeaving(request, context) : decide(request, context),
            policyId: policy.id,
          }
        })

      /** What the rules answer, as the decision sent: refused with why, or allowed, by the allow rules that did where they did. */
      const decisionOf = (
        verdict: Extract<Verdict, { readonly verdict: 'allow' | 'deny' }>,
        policyId: string,
      ): {
        readonly decision: PermissionDecision
        readonly cited?: { readonly rules: ReadonlyArray<AllowRule>; readonly policyId: string }
      } => {
        if (verdict.verdict === 'deny') return { decision: { decision: 'reject', reason: verdict.reason, decidedBy: 'rules' } }
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
                asked: true,
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
              const { verdict, policyId } = yield* byRules(
                waiter.context.projectId,
                waiter.context.taskId,
                waiter.rules,
                waiter.request,
                waiter.inside,
                waiter.context.sandbox !== undefined,
              )
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
              const { policy: latest, project } = yield* rulesNow(requestContext.projectId, requestContext.taskId)
              const changed = latest.id !== ruled.policyId || project.mode !== ruled.project.mode
              const context: RuleContext = {
                ...ruled.rules,
                project,
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
                yield* recordDecision({
                  context: requestContext,
                  request,
                  requestId,
                  digest,
                  decision,
                  actorId: instance.coordinatorId,
                  kind: tallyKindOf(request, ruled.context),
                })
                // A denial is read on the refused call's own row, so it gets no receipt of its own.
                if (judgment.decision === 'allow')
                  yield* addItem(requestContext, 'notice', {
                    source: 'runtime',
                    severity: 'info',
                    about: 'permission',
                    requestId,
                    title: `Allowed ${receiptLine(request.title, 120)}`,
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
            // A shell command the session's sandbox holds runs there without being read (ADR-071).
            const inside = requestContext.sandbox !== undefined && runsInside(request, requestContext.sandbox)
            // A role that only reads is answered at once: allowed, or refused with a reason it reads.
            if (requestContext.rules.role === 'reader') {
              const { offline, web, cwd, trusted, contained, reads } = requestContext.rules
              const read = inside
                ? decideInside(request)
                : decideReader(request, {
                    offline: offline === true,
                    web: web === true,
                    ...(cwd === undefined ? {} : { cwd }),
                    ...(trusted === true ? { trusted } : {}),
                    ...(contained === true ? { contained } : {}),
                    ...(reads === undefined ? {} : { reads }),
                  })
              const decision: PermissionDecision =
                read.verdict === 'allow'
                  ? { decision: 'allow', reason: inside ? 'It runs inside the sandbox.' : 'This role may do this.' }
                  : { decision: 'reject', reason: read.verdict === 'deny' ? read.reason : '', decidedBy: 'rules' }
              yield* sql.withTransaction(
                recordDecision({
                  context: requestContext,
                  request,
                  requestId,
                  digest,
                  decision,
                  actorId: instance.systemId,
                  kind: inside ? 'credentials' : 'reader',
                }),
              )
              return decision
            }
            const rules = requestContext.rules.context
            // The rules first, the allow rules among them: the coordinator judges only what none of them answers.
            const ruled = yield* byRules(
              requestContext.projectId,
              requestContext.taskId,
              rules,
              request,
              inside,
              requestContext.sandbox !== undefined,
            )
            const kind = tallyKindOf(request, ruled.context)
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
              const ruledOn = decisionOf(verdict, policyId)
              // What the sandbox holds says so on the record, not that a rule let it through.
              const { decision, cited } =
                inside && verdict.verdict === 'allow'
                  ? { decision: { decision: 'allow' as const, reason: 'It runs inside the sandbox.' }, cited: undefined }
                  : ruledOn
              yield* sql.withTransaction(
                recordDecision({
                  context: requestContext,
                  request,
                  requestId,
                  digest,
                  decision,
                  actorId: instance.systemId,
                  kind,
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
                    // What it is counted as (ADR-071), beside the kind of tool call it is.
                    counted: kind,
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
              inside,
              kind,
            }
            waiting.set(attentionId, waiter)
            // The rules, or the task's switch, may have changed while the call was being made, and been decided again without it:
            // then it is decided again now.
            const now = yield* rulesNow(requestContext.projectId, requestContext.taskId)
            if (now.policy.id !== policyId || now.project.mode !== ruleContext.project?.mode) {
              const again = yield* byRules(
                requestContext.projectId,
                requestContext.taskId,
                rules,
                request,
                inside,
                requestContext.sandbox !== undefined,
              )
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

      const upFront = (projectId: ProjectId, taskId: string | null, rules: RuleContext) =>
        Effect.gen(function* () {
          const { policy, project } = yield* rulesNow(projectId, taskId)
          const reach = yield* workedOutReach(projectId, taskId)
          const edits = policy.rules.sandbox
          // A host goes in only where the rules let a request for it through without the person or the coordinator;
          // never a wildcard, which would let through hosts under it the rules ask about or refuse.
          const reached = (host: string) =>
            hostOf(host) === host &&
            decide(
              { sessionId: '', toolCallId: '', title: host, kind: 'other', rawInput: { host }, paths: [], options: [] },
              { ...rules, project },
            ).verdict === 'allow'
          return {
            commands: withEdits(reach.commands, edits?.commands),
            hosts: withEdits(reach.hosts, edits?.hosts).filter(reached),
          } satisfies Reach
        })

      return Permissions.of({
        upFront: (projectId, taskId, rules) => run(upFront(projectId, taskId, rules)),
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
                keep = {
                  scope: always,
                  rule,
                  context: (yield* byRules(
                    waiter.context.projectId,
                    waiter.context.taskId,
                    waiter.rules,
                    waiter.request,
                    waiter.inside,
                    waiter.context.sandbox !== undefined,
                  )).context,
                }
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
                    const now = (yield* rulesNow(waiter.context.projectId, waiter.context.taskId)).project
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
                    asked: true,
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

        allowEverything: ({ envelope, taskId, on }) =>
          run(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [task] = yield* sql<{ projectId: ProjectId; allowEverything: number }>`
                SELECT project_id, allow_everything FROM tasks WHERE id = ${taskId}`
              if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
              const own = on ? 1 : 0
              if (own === task.allowEverything) return
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const revision = yield* change('tasks', taskId, { allowEverything: own })
                  yield* fact({
                    projectId: task.projectId,
                    aggregateType: 'task',
                    aggregateId: taskId,
                    revision,
                    type: 'task.allow_everything_set',
                    payload: { allowEverything: on },
                    actorId: envelope.actorId,
                    commandId: envelope.commandId,
                  })
                }),
              )
              yield* touchCard(taskId)
              // What its agents wait on is decided again: it goes ahead, short of what the project never allows.
              if (on) yield* reconsider(task.projectId)
            }).pipe(
              Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die, RowNotFound: Effect.die, RevisionConflict: Effect.die }),
            ),
          ),

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
