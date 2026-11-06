import { createHash } from 'node:crypto'

import { ConnectorFailed } from '@althar/connectors'
import { type ProjectId } from '@althar/domain'
import { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, Crypto, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import { Instance } from './Instance'
import { makeKeyedLock } from './keyedLock'
import { outward } from './outward'
import { change, fact, timestamp } from './records'
import { addItem } from './threads'
import { ActionNotPerformed, ToolRefused } from './toolErrors'
import type { ToolAccess } from './ToolServer'

/** Inputs the host recorded for the live turn, never claims from a tool's arguments. */
export interface TurnWord {
  readonly turnId: string | null
  readonly origin: 'person' | 'news' | 'system'
  readonly byPerson: boolean
  readonly messages: ReadonlyArray<string>
}

export interface ErrandStep {
  readonly key: string
  readonly tool: string
  readonly taskId?: string | undefined
  readonly target: string
  readonly head?: string | undefined
  readonly branch?: string | undefined
  /** The tool's semantic arguments, without the word/errand reference. Bound exactly when kept. */
  readonly request: Readonly<Record<string, unknown>>
  readonly waits: ReadonlyArray<{ readonly kind: string; readonly target: string; readonly since?: string | undefined }>
}

/** A read made now by the implementing tool, never the last poll's news. */
export interface FreshAction {
  /** absent is positive proof that an earlier uncertain write did not happen and is no longer in flight. */
  readonly state: 'ready' | 'absent' | 'waiting' | 'done' | 'unknown' | 'objection' | 'ended'
  readonly head?: string | undefined
  readonly branch?: string | undefined
  readonly pushedBy?: 'lead' | 'althar' | 'other'
  readonly reason?: string
  readonly answer?: string
}

/** No acting tool is shipped here. Future tools supply a fresh read and an action against that read. */
export type AskedResult = string | { readonly pending: true; readonly answer: string }

export interface AskedAction {
  readonly messageId?: string
  readonly errandId?: string
  readonly step?: string
  readonly target: string
  readonly head?: string | undefined
  readonly branch?: string | undefined
  readonly request: Readonly<Record<string, unknown>>
  readonly read: Effect.Effect<FreshAction, ToolRefused>
  /**
   * The read after an earlier call's answer was lost, where it differs:
   * what proves now that it happened. Without it, `read` reads it back.
   */
  readonly readBack?: Effect.Effect<FreshAction, ToolRefused>
  /**
   * The same intent may come again and need doing again, as a tag someone
   * deleted is asked for again, or a rerun waits on its approval anew: a
   * confirmed answer is given again only once a fresh read agrees it's
   * done, and otherwise it is done again, under a receipt of its own.
   */
  readonly recurs?: boolean
  /** Only ActionNotPerformed proves a refusal did not write; other errors require read-back. */
  readonly act: (fresh: FreshAction) => Effect.Effect<AskedResult, ToolRefused | ActionNotPerformed>
}

interface ErrandRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly messageId: string
  readonly words: string
  readonly state: 'open' | 'paused' | 'done' | 'cancelled'
  readonly reason: string | null
  readonly pausedAfterSequence?: number | null
}

interface StepRow {
  readonly stepKey: string
  readonly tool: string
  readonly target: string
  readonly taskId: string | null
  readonly head: string | null
  readonly targetBranch: string | null
  readonly request: string
  readonly waits: string
  readonly state: string
  readonly position: number
}

type Store = SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto
const refused = (message: string) => new ToolRefused({ message })
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  ) ?? 'null'

const waitsLine = (waits: string): string =>
  (JSON.parse(waits) as Array<{ kind: string; target: string }>).map((w) => `${w.kind.replaceAll('_', ' ')} ${w.target}`).join(', ') ||
  'the next step'

/** Open records are included on first start, handover and task cards, independent of any session. */
export const errandLines = (projectId: string, taskId?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      id: string
      words: string
      state: string
      reason: string | null
      tool: string
      target: string
      head: string | null
      waits: string
    }>`
    SELECT e.id, e.words, e.state, e.reason, s.tool, s.target, s.head, s.waits FROM errands e
    JOIN errand_steps s ON s.errand_id = e.id WHERE e.project_id = ${projectId} AND e.state IN ('open', 'paused')
      AND s.state = 'waiting' AND (${taskId ?? null} IS NULL OR s.task_id = ${taskId ?? null})
    ORDER BY e.created_at, e.rowid, s.position`
    return rows.map((r) =>
      taskId === undefined
        ? `${r.state === 'paused' ? 'Paused' : 'Waiting'}: ${r.tool.replaceAll('_', ' ')} ${r.target}${r.head === null ? '' : ` at ${r.head}`} — ${r.reason ?? waitsLine(r.waits)}. Asked: ${JSON.stringify(r.words)} (errand ${r.id}).`
        : `${r.state === 'paused' ? 'Paused' : 'Waiting'} for ${r.target}: ${r.reason ?? waitsLine(r.waits)}.`,
    )
  })

export class Errands extends Context.Service<
  Errands,
  {
    list(access: ToolAccess): Effect.Effect<string, ToolRefused>
    turn(access: ToolAccess): Effect.Effect<TurnWord, ToolRefused>
    keep(access: ToolAccess, messageId: string, steps: ReadonlyArray<ErrandStep>): Effect.Effect<string, ToolRefused>
    pause(access: ToolAccess, id: string, reason: string): Effect.Effect<string, ToolRefused>
    resume(access: ToolAccess, id: string, messageId: string): Effect.Effect<string, ToolRefused>
    cancel(access: ToolAccess, id: string, messageId: string): Effect.Effect<string, ToolRefused>
    execute(tool: string, access: ToolAccess, action: AskedAction): Effect.Effect<string, ToolRefused>
    /**
     * Whether the person's word for an action still stands, as execute checks
     * it before acting and again after its read: the turn is live, the message
     * is theirs in it, and no paused or called-off errand of that word holds
     * the action (by its tool and target and arguments, or, given, its task).
     * Their words, else refused. An action that waits for a lock checks again
     * once it holds it, before it writes anything.
     */
    stands(
      tool: string,
      access: ToolAccess,
      action: {
        readonly messageId: string | undefined
        readonly target: string
        readonly request: Readonly<Record<string, unknown>>
        readonly taskId?: string
      },
    ): Effect.Effect<string, ToolRefused>
    /** The shared news watch calls this even when a poll has no changes. No session or agent place is held. */
    remind(projectId: string): Effect.Effect<void, ToolRefused>
    /** Every poll change touching a target refreshes this clock; wake its thread separately for a fresh/terminal read. */
    news(id: string): Effect.Effect<void, ToolRefused>
  }
>()('@althar/runtime/Errands') {
  static readonly layer = Layer.effect(
    Errands,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const locks = makeKeyedLock()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) =>
        Effect.provideContext(effect, context).pipe(
          Effect.catchCause((cause) => {
            const error = Option.getOrUndefined(Cause.findErrorOption(cause))
            return Effect.fail(
              error instanceof ToolRefused || error instanceof ActionNotPerformed
                ? refused(error.message)
                : error instanceof ConnectorFailed
                  ? refused(`The action’s answer is uncertain: ${error.message} It will be read back before another attempt.`)
                  : refused('Althar could not keep or read the errand. Try again, or tell the person.'),
            )
          }),
        )
      const turn = (access: ToolAccess) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ id: string; origin: TurnWord['origin'] }>`
        SELECT id, origin FROM turn_deliveries WHERE provider_session_id = ${access.sessionId}
          AND project_id = ${access.projectId} AND thread_id = ${access.threadId} AND state = 'delivered'
        ORDER BY requested_at DESC, rowid DESC LIMIT 1`
          if (row === undefined) return { turnId: null, origin: 'system' as const, byPerson: false, messages: [] as string[] }
          const messages = yield* sql<{ id: string }>`SELECT i.id FROM turn_delivery_inputs di JOIN user_inputs i ON i.id = di.user_input_id
        JOIN actors a ON a.id = i.author_actor_id WHERE di.delivery_id = ${row.id}
          AND i.sender_kind IN ('window', 'paired_device') AND a.kind = 'person'`
          return {
            turnId: row.id,
            origin: row.origin,
            byPerson: row.origin === 'person' && messages.length > 0,
            messages: messages.map((i) => i.id),
          }
        })
      const word = (access: ToolAccess, messageId: string) =>
        Effect.gen(function* () {
          const current = yield* turn(access)
          if (access.role === 'reviewer' || !current.byPerson || !current.messages.includes(messageId))
            return yield* refused(
              "This needs the person's message in this turn, from the window or a paired device. News and socket messages cannot give their word.",
            )
          const [input] = yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE id = ${messageId}`
          return input?.body ?? ''
        })
      const owned = (access: ToolAccess, id: string) =>
        Effect.gen(function* () {
          const [row] =
            yield* sql<ErrandRow>`SELECT * FROM errands WHERE id = ${id} AND project_id = ${access.projectId} AND thread_id = ${access.threadId}`
          if (row === undefined || access.role === 'reviewer') return yield* refused('This errand does not belong to this thread.')
          return row
        })
      const say = (row: ErrandRow, title: string) =>
        Effect.gen(function* () {
          yield* addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', { source: 'runtime', severity: 'info', title })
          const tasks = yield* sql<{ taskId: string; threadId: string }>`SELECT DISTINCT s.task_id, t.id AS thread_id FROM errand_steps s
        JOIN threads t ON t.task_id = s.task_id AND t.kind = 'task' WHERE s.errand_id = ${row.id}`
          for (const task of tasks) {
            if (task.threadId !== row.threadId)
              yield* addItem({ projectId: row.projectId, threadId: task.threadId }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title,
              })
            yield* touchTask(task.taskId)
          }
        })
      const set = (row: ErrandRow, state: ErrandRow['state'], reason: string | null) =>
        sql.withTransaction(
          Effect.gen(function* () {
            const [last] = yield* sql<{
              sequence: number
            }>`SELECT coalesce(max(sequence), 0) AS sequence FROM user_inputs WHERE thread_id = ${row.threadId}`
            const revision = yield* change('errands', row.id, {
              state,
              reason,
              ...(state === 'paused' ? { pausedAfterSequence: last?.sequence ?? 0 } : {}),
            })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'errand',
              aggregateId: row.id,
              revision,
              type: `errand.${state}`,
              actorId: instance.systemId,
              payload: { reason },
            })
            yield* say(row, `Errand ${state}: ${reason ?? row.words}`)
          }),
        )
      const stepsOf = (id: string) => sql<StepRow>`SELECT * FROM errand_steps WHERE errand_id = ${id} ORDER BY position`
      const keep = (access: ToolAccess, messageId: string, steps: ReadonlyArray<ErrandStep>) =>
        sql.withTransaction(
          Effect.gen(function* () {
            const words = yield* word(access, messageId)
            if (steps.length === 0 || new Set(steps.map((s) => s.key)).size !== steps.length)
              return yield* refused('An errand needs steps with distinct keys.')
            for (const step of steps) {
              if (step.target === '' || step.tool === '' || step.key === '' || step.waits.length === 0)
                return yield* refused('Each step needs a tool, target and what it waits on.')
              if (step.taskId !== undefined) {
                const [task] = yield* sql<{
                  id: string
                }>`SELECT id FROM tasks WHERE id = ${step.taskId} AND project_id = ${access.projectId}`
                if (task === undefined || (access.role === 'lead' && access.taskId !== step.taskId))
                  return yield* refused('The step must concern a task this caller can act on.')
              }
              if (access.role === 'lead' && step.taskId !== access.taskId)
                return yield* refused('A lead keeps errands only for its own task.')
            }
            // A retry of keeping the same words and steps adopts the existing record.
            const id = `errand_${createHash('sha256')
              .update(stable([messageId, steps]))
              .digest('hex')}`
            const [existing] = yield* sql<{ id: string }>`SELECT id FROM errands WHERE id = ${id}`
            if (existing !== undefined) return id
            const at = yield* timestamp
            const row: ErrandRow = {
              id,
              projectId: access.projectId as ProjectId,
              threadId: access.threadId,
              messageId,
              words,
              state: 'open',
              reason: null,
            }
            yield* sql`INSERT INTO errands ${sql.insert({ ...row, createdAt: at, newsAt: at })}`
            for (const [index, step] of steps.entries())
              yield* sql`INSERT INTO errand_steps ${sql.insert({ errandId: id, projectId: access.projectId, stepKey: step.key, position: index + 1, tool: step.tool, taskId: step.taskId ?? null, target: step.target, head: step.head ?? null, targetBranch: step.branch ?? null, request: stable(step.request), waits: stable(step.waits), state: 'waiting' })}`
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'errand',
              aggregateId: id,
              revision: 1,
              type: 'errand.kept',
              actorId: instance.systemId,
              payload: { messageId, steps },
            })
            yield* say(
              row,
              `Kept an errand: ${JSON.stringify(words)}. ${steps.map((s) => `${s.tool.replaceAll('_', ' ')} ${s.target}${s.head === undefined ? '' : ` at ${s.head}`}; waits on ${s.waits.map((w) => `${w.kind} ${w.target}`).join(', ')}`).join('; ')}.`,
            )
            return id
          }),
        )
      const stands = (
        tool: string,
        access: ToolAccess,
        action: {
          readonly messageId: string | undefined
          readonly target: string
          readonly request: Readonly<Record<string, unknown>>
          readonly taskId?: string
        },
      ) =>
        Effect.gen(function* () {
          const current = yield* turn(access)
          if (current.turnId === null) return yield* refused('An asked-for tool runs only during a live turn.')
          if (action.messageId === undefined) return yield* refused("Name the person's message, or an errand and its step.")
          const words = yield* word(access, action.messageId)
          const taskId = action.taskId ?? null
          const [held] = yield* sql<{ id: string }>`SELECT e.id FROM errands e JOIN errand_steps s ON s.errand_id = e.id
            WHERE e.project_id = ${access.projectId} AND e.thread_id = ${access.threadId} AND e.message_id = ${action.messageId}
              AND e.state IN ('paused', 'cancelled') AND s.tool = ${tool}
              AND ((s.target = ${action.target} AND s.request = ${stable(action.request)}) OR (${taskId} IS NOT NULL AND s.task_id = ${taskId}))
            LIMIT 1`
          if (held !== undefined) return yield* refused('This word’s errand was paused or called off. The person needs to say so again.')
          return words
        })
      const execute = (tool: string, access: ToolAccess, action: AskedAction) => {
        // The same external intent shares a receipt across messages, sessions and errands.
        // Include a task revision or operation generation in request for an action that may legitimately recur.
        const base = `asked:${createHash('sha256')
          .update(stable([access.projectId, tool, action.target, action.head, action.branch, action.request]))
          .digest('hex')}`
        return locks.withLock(
          base,
          Effect.gen(function* () {
            // An intent that recurs keeps a receipt a time, keyed after the one before: `base`, then `base#<receipt>`.
            let key = base
            let errand: ErrandRow | undefined
            let step: StepRow | undefined
            const authorize = Effect.gen(function* () {
              if (action.errandId === undefined)
                return yield* stands(tool, access, { messageId: action.messageId, target: action.target, request: action.request })
              const current = yield* turn(access)
              if (current.turnId === null) return yield* refused('An asked-for tool runs only during a live turn.')
              errand = yield* owned(access, action.errandId)
              const steps = yield* stepsOf(errand.id)
              step = steps.find((s) => s.stepKey === action.step)
              if (
                step === undefined ||
                step.tool !== tool ||
                step.target !== action.target ||
                step.request !== stable(action.request) ||
                step.head !== (action.head ?? null) ||
                step.targetBranch !== (action.branch ?? null) ||
                (access.role === 'lead' && step.taskId !== access.taskId)
              )
                return yield* refused('This call does not match the recorded errand step, target, head and arguments.')
              if (errand.state !== 'open' && !(errand.state === 'done' && step.state === 'done'))
                return yield* refused(`This errand is ${errand.state}: ${errand.reason ?? errand.words}`)
              if (steps.some((s) => s.position < step!.position && s.state !== 'done'))
                return yield* refused('An earlier step still waits.')
              return errand.words
            })
            const words = yield* authorize
            let [receipt] = yield* sql<{
              id: string
              workItemId: string
              idempotencyKey: string
              state: string
              response: string | null
            }>`SELECT id, work_item_id, idempotency_key, state, response FROM mutation_receipts WHERE project_id = ${access.projectId} AND (idempotency_key = ${base} OR idempotency_key LIKE ${`${base}#%`}) ORDER BY created_at DESC, rowid DESC LIMIT 1`
            if (receipt !== undefined) key = receipt.idempotencyKey
            const finish = (answer: string, head: string | undefined) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const [kept] = yield* sql<{
                    id: string
                    saidAt: string | null
                  }>`SELECT id, said_at FROM mutation_receipts WHERE project_id = ${access.projectId} AND idempotency_key = ${key} AND state = 'confirmed' ORDER BY created_at DESC, rowid DESC LIMIT 1`
                  if (kept === undefined) return
                  const title = `${tool.replaceAll('_', ' ')}: ${action.target}${head === undefined ? '' : ` at ${head}`}. Asked: ${JSON.stringify(words)}. ${answer}`
                  if (errand !== undefined && step !== undefined) {
                    yield* sql`UPDATE errand_steps SET state = 'done' WHERE errand_id = ${errand.id} AND step_key = ${step.stepKey}`
                    if (kept.saidAt === null) yield* say(errand, title)
                    if (errand.state !== 'done' && (yield* stepsOf(errand.id)).every((s) => s.state === 'done'))
                      yield* set(errand, 'done', null)
                  } else if (kept.saidAt === null)
                    yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'notice', {
                      source: 'runtime',
                      severity: 'info',
                      title,
                    })
                  yield* change('mutation_receipts', kept.id, { saidAt: yield* timestamp })
                }),
              )
            const previous: unknown = JSON.parse(receipt?.response ?? 'null')
            const recurring = action.recurs === true && step?.state !== 'done' && errand?.state !== 'done' && receipt?.state === 'confirmed'
            if (receipt?.state === 'confirmed' && typeof previous === 'string' && !recurring) {
              const answer = previous
              const [kept] = yield* sql<{ request: string }>`SELECT request FROM mutation_receipts WHERE id = ${receipt.id}`
              const saved = JSON.parse(kept?.request ?? '{}') as { head?: string }
              yield* finish(answer, saved.head)
              return answer
            }
            if (step?.state === 'done' || errand?.state === 'done') return yield* refused('This step is done already.')
            // This callback must contact the authority, including when a previous call's answer was lost.
            const fresh = yield* receipt !== undefined &&
            receipt.state !== 'failed' &&
            receipt.state !== 'confirmed' &&
            action.readBack !== undefined
              ? action.readBack
              : action.read
            yield* authorize // A message or objection may have arrived during the read.
            if (fresh.state === 'objection') {
              if (errand !== undefined) yield* set(errand, 'paused', fresh.reason ?? 'A new objection needs the person’s word again.')
              return yield* refused(fresh.reason ?? 'A new objection needs the person’s word again.')
            }
            if (
              fresh.state === 'ended' ||
              fresh.pushedBy === 'other' ||
              (action.branch !== undefined && fresh.branch !== undefined && fresh.branch !== action.branch)
            ) {
              if (errand !== undefined) yield* set(errand, 'cancelled', fresh.reason ?? 'The target changed or someone else acted on it.')
              return yield* refused(fresh.reason ?? 'The target changed or someone else acted on it.')
            }
            if (action.branch !== undefined && fresh.branch === undefined)
              return yield* refused('This action binds a target branch. Its fresh read must return that branch; nothing was changed.')
            if (
              action.head !== undefined &&
              fresh.head !== action.head &&
              !(errand !== undefined && (fresh.pushedBy === 'lead' || fresh.pushedBy === 'althar'))
            )
              return yield* refused('The head moved. Read it again before asking for this action.')
            if (fresh.state === 'unknown' || fresh.state === 'waiting')
              return yield* refused(fresh.reason ?? 'This step still waits; nothing was changed.')
            if (recurring && receipt !== undefined) {
              const answer = fresh.answer ?? (typeof previous === 'string' ? previous : 'Already done.')
              if (fresh.state === 'done') {
                yield* finish(answer, fresh.head)
                return answer
              }
              // Done before, and not now: this is another time of it, with a receipt of its own.
              key = `${base}#${receipt.id}`
              receipt = undefined
            }
            if (receipt !== undefined && receipt.state !== 'failed' && fresh.state !== 'done' && fresh.state !== 'absent')
              return yield* refused(
                'The earlier answer was lost. Read back whether it happened or is still in flight; it will not be acted on twice.',
              )
            if (receipt !== undefined)
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* change('mutation_receipts', receipt.id, {
                    state: fresh.state === 'done' ? 'confirmed' : 'failed',
                    saidAt: null,
                    response: fresh.state === 'done' ? JSON.stringify(fresh.answer ?? 'Already done.') : null,
                    confirmedAt: fresh.state === 'done' ? yield* timestamp : null,
                  })
                  yield* change('work_items', receipt.workItemId, {
                    state: fresh.state === 'done' ? 'done' : 'failed',
                    claimedByInstanceId: null,
                    leaseExpiresAt: null,
                    updatedAt: yield* timestamp,
                  })
                }),
              )
            const answer =
              fresh.state === 'done' && receipt !== undefined
                ? (fresh.answer ?? 'Already done.')
                : yield* outward({
                    projectId: access.projectId as ProjectId,
                    subject: { type: errand === undefined ? 'user_input' : 'errand', id: errand?.id ?? action.messageId! },
                    target: action.target,
                    operation: tool,
                    key,
                    request: {
                      messageId: errand?.messageId ?? action.messageId,
                      words,
                      target: action.target,
                      head: fresh.head ?? null,
                      request: action.request,
                    },
                    retryable: false,
                    perform:
                      fresh.state === 'done'
                        ? Effect.succeed(fresh.answer ?? 'Already done.')
                        : action
                            .act(fresh)
                            .pipe(
                              Effect.mapError((e) =>
                                e instanceof ActionNotPerformed
                                  ? e
                                  : new ConnectorFailed({ product: 'asked-for', reason: 'unreachable', message: e.message }),
                              ),
                            ),
                    confirmed: (value) => typeof value === 'string',
                    encode: (value) => value,
                    decode: (value) =>
                      typeof value === 'string'
                        ? value
                        : typeof value === 'object' &&
                            value !== null &&
                            'pending' in value &&
                            value.pending === true &&
                            'answer' in value &&
                            typeof value.answer === 'string'
                          ? { pending: true as const, answer: value.answer }
                          : undefined,
                  })
            if (typeof answer !== 'string') {
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const [pending] = yield* sql<{
                    id: string
                    workItemId: string
                  }>`SELECT id, work_item_id FROM mutation_receipts WHERE project_id = ${access.projectId} AND idempotency_key = ${key} ORDER BY created_at DESC, rowid DESC LIMIT 1`
                  if (pending !== undefined) {
                    yield* change('mutation_receipts', pending.id, { state: 'uncertain', confirmedAt: null, saidAt: yield* timestamp })
                    yield* change('work_items', pending.workItemId, { state: 'uncertain', updatedAt: yield* timestamp })
                  }
                  const title = `${tool.replaceAll('_', ' ')}: ${action.target}${fresh.head === undefined ? '' : ` at ${fresh.head}`}. Asked: ${JSON.stringify(words)}. ${answer.answer}`
                  if (errand !== undefined) yield* say(errand, title)
                  else
                    yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'notice', {
                      source: 'runtime',
                      severity: 'info',
                      title,
                    })
                }),
              )
              return answer.answer
            }
            yield* finish(answer, fresh.head)
            return answer
          }),
        )
      }
      return Errands.of({
        list: (access) =>
          provide(
            Effect.gen(function* () {
              const rows =
                yield* sql<ErrandRow>`SELECT * FROM errands WHERE project_id = ${access.projectId} AND thread_id = ${access.threadId} AND state IN ('open', 'paused') ORDER BY created_at, rowid`
              const records = []
              for (const row of rows) records.push({ ...row, steps: yield* stepsOf(row.id) })
              return JSON.stringify(records)
            }),
          ),
        turn: (access) => provide(turn(access)),
        keep: (access, message, steps) => provide(keep(access, message, steps)),
        pause: (access, id, reason) =>
          provide(
            Effect.gen(function* () {
              const row = yield* owned(access, id)
              if (row.state !== 'open') return `This errand is ${row.state}.`
              yield* set(row, 'paused', reason)
              return 'Paused the errand.'
            }),
          ),
        resume: (access, id, messageId) =>
          provide(
            sql.withTransaction(
              Effect.gen(function* () {
                const words = yield* word(access, messageId)
                const row = yield* owned(access, id)
                if (row.state !== 'paused') return yield* refused('Only a paused errand can be resumed.')
                const [message] = yield* sql<{ sequence: number }>`SELECT sequence FROM user_inputs WHERE id = ${messageId}`
                if (message === undefined || message.sequence <= (row.pausedAfterSequence ?? 0))
                  return yield* refused('Resuming needs a fresh message after the objection, not the earlier word again.')
                const revision = yield* change('errands', id, {
                  state: 'open',
                  reason: null,
                  resumeMessageId: messageId,
                  resumeWords: words,
                  newsAt: yield* timestamp,
                })
                yield* fact({
                  projectId: row.projectId,
                  aggregateType: 'errand',
                  aggregateId: id,
                  revision,
                  type: 'errand.resumed',
                  actorId: instance.systemId,
                  payload: { messageId, words },
                })
                yield* say(row, `Errand resumed: ${JSON.stringify(row.words)}. The person said ${JSON.stringify(words)}.`)
                return 'Resumed the errand on the person’s word.'
              }),
            ),
          ),
        cancel: (access, id, messageId) =>
          provide(
            Effect.gen(function* () {
              yield* word(access, messageId)
              const row = yield* owned(access, id)
              if (row.state === 'done' || row.state === 'cancelled') return `This errand is ${row.state}.`
              yield* set(row, 'cancelled', 'The person called it off.')
              return 'Called off the errand.'
            }),
          ),
        execute: (tool, access, action) => provide(execute(tool, access, action)),
        stands: (tool, access, action) => provide(stands(tool, access, action)),
        news: (id) =>
          provide(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* change('errands', id, { newsAt: yield* timestamp })
              }),
            ),
          ),
        remind: (projectId) =>
          provide(
            sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                const rows = yield* sql<
                  ErrandRow & { newsAt: string; remindedAt: string | null }
                >`SELECT * FROM errands WHERE project_id = ${projectId} AND state IN ('open', 'paused')`
                for (const row of rows) {
                  const steps = (yield* stepsOf(row.id)).filter((s) => s.state !== 'done')
                  const missing = steps.some((s) =>
                    (JSON.parse(s.waits) as Array<{ kind: string; since?: string }>).some(
                      (w) =>
                        w.kind === 'required-check-missing' && w.since !== undefined && Date.parse(at) - Date.parse(w.since) >= 3_600_000,
                    ),
                  )
                  if (
                    (!missing && Date.parse(at) - Date.parse(row.newsAt) < 86_400_000) ||
                    (row.remindedAt !== null && Date.parse(at) - Date.parse(row.remindedAt) < 86_400_000)
                  )
                    continue
                  yield* say(
                    row,
                    `Errand still waits: ${row.reason ?? steps.map((s) => `${s.target}: ${waitsLine(s.waits)}`).join('; ')}. Asked: ${JSON.stringify(row.words)}.`,
                  )
                  yield* change('errands', row.id, { remindedAt: at })
                }
              }),
            ),
          ),
      })
    }),
  )
}
