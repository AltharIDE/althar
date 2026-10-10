import { type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import { Commands, Ledger } from '@althar/persistence-sqlite'
import {
  type FieldAnswer,
  type Question,
  type QuestionAnswer,
  type QuestionField,
  questionContent,
  saidOf,
  takesWords,
} from '@althar/provider-adapters'
import { Cause, Context, Crypto, Deferred, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { AttentionClosed, NotFound, QuestionUnanswered } from './errors'
import { Instance } from './Instance'
import { Live } from './Live'
import { moveSession, releaseSession } from './Permissions'
import { change, fact, timestamp } from './records'
import { addItem } from './threads'

/*
 * Questions an agent asks the person (DEV-13), such as Claude Code's
 * AskUserQuestion. A question is the thread's, not the session's: it is
 * recorded as a call waiting on the person and as an item of the thread,
 * and it waits until the person answers. While the agent that asked is
 * still waiting, the answer goes straight back to it. If its session has
 * gone meanwhile (Althar restarted, the agent went, another took the thread
 * over) the question stays, and its answer is told to whichever agent is on
 * the thread next. It is withdrawn only when the agent takes it back, its
 * turn is stopped, or its task is stopped or abandoned.
 */

/** Where a question comes from. */
export interface AskContext {
  readonly projectId: ProjectId
  readonly threadId: string
  /** The task the session works on; none for the coordinator. */
  readonly taskId: string | null
  /** The provider session's row id. */
  readonly sessionId: string
}

/** What a question keeps in its call: where it was asked, and what. */
export interface QuestionPayload {
  readonly threadId: string
  readonly sessionId: string
  readonly itemId: string
  readonly toolCallId: string | null
  readonly message: string
  readonly fields: ReadonlyArray<QuestionField>
  /** What the person said, by field, once answered. */
  readonly answers?: Readonly<Record<string, FieldAnswer>>
  /** Withdrawn because the agent took it back or its turn was stopped. */
  readonly withdrawn?: 'turn'
}

/** What answering came to: told to the agent waiting on it, or to be told to the one on the thread next. */
export type Answered =
  | { readonly told: true }
  | {
      readonly told: false
      readonly threadId: string
      readonly taskId: string | null
      readonly projectId: ProjectId
      readonly body: string
    }

interface Waiting {
  readonly deferred: Deferred.Deferred<QuestionAnswer>
  readonly context: AskContext
  readonly question: Question
  /** Its session went: the question stays for the person, and nothing withdraws it on the way out. */
  released: boolean
}

/** The question in a line, for the call's title. */
export const questionTitle = (payload: Pick<QuestionPayload, 'message' | 'fields'>) =>
  payload.fields.length === 1 && payload.fields[0] !== undefined ? payload.fields[0].question : payload.message

/** What the person said, question by question, for an agent told afterwards. */
export const answerWords = (fields: ReadonlyArray<QuestionField>, answers: Readonly<Record<string, FieldAnswer>>) =>
  fields.flatMap((field) => {
    const said = answers[field.id]
    const words = said === undefined ? '' : saidOf(field, said)
    return [`${field.question} ${words === '' ? '(no answer)' : words}`]
  })

type Store = SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto | Instance | Live

export class Questions extends Context.Service<
  Questions,
  {
    /** Asks the person: the adapter's `onQuestion`. */
    ask(context: AskContext, question: Question): Effect.Effect<QuestionAnswer>
    /** The person's answer, field by field. */
    answer(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answers: Readonly<Record<string, FieldAnswer>>
    }): Effect.Effect<Answered, AttentionClosed | NotFound | QuestionUnanswered>
    /** A session has gone: what it asked stays open for the person, and is told to the agent on the thread next. */
    release(sessionId: string): Effect.Effect<void>
  }
>()('@althar/runtime/Questions') {
  static readonly layer: Layer.Layer<Questions, never, Store> = Layer.effect(
    Questions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const live = yield* Live
      const waiting = new Map<string, Waiting>()
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** Withdraws a question still open: the agent took it back, or its turn was stopped. Only the first call does anything. */
      const withdraw = (attentionId: string, waiter: Waiting) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          waiting.delete(attentionId)
          const withdrawn = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [row] = yield* sql<{ state: string; payload: string }>`
                SELECT state, payload FROM attention_requests WHERE id = ${attentionId}`
              if (row?.state !== 'open') return false
              const payload = JSON.parse(row.payload) as QuestionPayload
              const revision = yield* change('attention_requests', attentionId, {
                state: 'withdrawn',
                payload: JSON.stringify({ ...payload, withdrawn: 'turn' } satisfies QuestionPayload),
              })
              yield* fact({
                projectId: waiter.context.projectId,
                aggregateType: 'attention_request',
                aggregateId: attentionId,
                revision,
                type: 'attention_request.withdrawn',
                actorId: instance.systemId,
              })
              yield* releaseSession(waiter.context.sessionId)
              return true
            }),
          )
          if (withdrawn)
            yield* live.publish({ _tag: 'AttentionClosed', threadId: waiter.context.threadId, attentionId, outcome: 'withdrawn' })
        })

      const ask = (askContext: AskContext, question: Question) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A form with nothing Althar can ask has nothing for the person to answer.
          if (question.fields.length === 0) return { action: 'cancel' } as const
          const attentionId = yield* newId(Ids.attentionRequest)
          const toolCallId = question.toolCallId ?? null
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const itemId = yield* addItem(
                { projectId: askContext.projectId, threadId: askContext.threadId, sessionId: askContext.sessionId },
                'question',
                {
                  attentionId,
                  message: question.message,
                  toolCallId,
                  fields: question.fields,
                },
              )
              const payload: QuestionPayload = {
                threadId: askContext.threadId,
                sessionId: askContext.sessionId,
                itemId,
                toolCallId,
                message: question.message,
                fields: question.fields,
              }
              yield* sql`INSERT INTO attention_requests ${sql.insert({
                id: attentionId,
                projectId: askContext.projectId,
                taskId: askContext.taskId,
                kind: 'question',
                addresseeActorId: instance.personId,
                payload: JSON.stringify(payload),
                state: 'open',
                createdAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: askContext.projectId,
                aggregateType: 'attention_request',
                aggregateId: attentionId,
                revision: 1,
                type: 'attention_request.opened',
                payload: { question: questionTitle(payload) },
                actorId: instance.systemId,
              })
              const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${askContext.sessionId}`
              if (session?.state === 'active') yield* moveSession(askContext.sessionId, 'waiting_approval')
            }),
          )
          const waiter: Waiting = { deferred: yield* Deferred.make<QuestionAnswer>(), context: askContext, question, released: false }
          waiting.set(attentionId, waiter)
          yield* live.publish({
            _tag: 'AttentionNeeded',
            threadId: askContext.threadId,
            attentionId,
            title: questionTitle(question),
            reason: 'The agent asks.',
          })
          return yield* Deferred.await(waiter.deferred).pipe(
            Effect.onExit((exit) =>
              exit._tag === 'Success' || waiter.released ? Effect.void : Effect.ignore(run(withdraw(attentionId, waiter))),
            ),
          )
        })

      const answer = (input: {
        readonly envelope: CommandEnvelope
        readonly attentionId: string
        readonly answers: Readonly<Record<string, FieldAnswer>>
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const [row] = yield* sql<{ projectId: ProjectId; taskId: string | null; payload: string; state: string }>`
            SELECT project_id, task_id, payload, state FROM attention_requests WHERE id = ${input.attentionId} AND kind = 'question'`
          if (row === undefined) return yield* new NotFound({ kind: 'attention_request', id: input.attentionId })
          if (row.state !== 'open') return yield* new AttentionClosed({ attentionId: input.attentionId })
          const payload = JSON.parse(row.payload) as QuestionPayload
          // Only what it asks, and every question it asks answered: an option picked, or words where words are taken.
          const answers: Record<string, FieldAnswer> = {}
          for (const field of payload.fields) {
            const said = input.answers[field.id]
            const values = (said?.values ?? []).filter((value) => field.options.some((option) => option.value === value))
            const written = takesWords(field) ? (said?.words?.trim() ?? '') : ''
            // A number asked for is a number: other words would reach the agent as nothing.
            const words = field.type === 'number' && !Number.isFinite(Number(written)) ? '' : written
            const picked = field.multiple ? values : values.slice(0, 1)
            if (picked.length === 0 && words === '')
              return yield* new QuestionUnanswered({ attentionId: input.attentionId, field: field.id })
            answers[field.id] = { values: picked, ...(words === '' ? {} : { words }) }
          }
          const words = answerWords(payload.fields, answers)
          yield* commands.execute({
            envelope: input.envelope,
            projectId: row.projectId,
            result: Schema.Void,
            handle: Effect.gen(function* () {
              const [now] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${input.attentionId}`
              if (now?.state !== 'open') return yield* new AttentionClosed({ attentionId: input.attentionId })
              const at = yield* timestamp
              const revision = yield* change('attention_requests', input.attentionId, {
                state: 'answered',
                answeredAt: at,
                payload: JSON.stringify({ ...payload, answers } satisfies QuestionPayload),
              })
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'attention_request',
                aggregateId: input.attentionId,
                revision,
                type: 'attention_request.answered',
                payload: { answers },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              const decisionId = yield* newId(Ids.decision)
              yield* sql`INSERT INTO decisions ${sql.insert({
                id: decisionId,
                projectId: row.projectId,
                attentionRequestId: input.attentionId,
                outcome: 'answer',
                reason: words.join('\n'),
                decidedByActorId: input.envelope.actorId,
                decidedAt: at,
              })}`
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'decision',
                aggregateId: decisionId,
                revision: 1,
                type: 'decision.made',
                payload: { answers },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              yield* releaseSession(payload.sessionId)
            }),
          })
          const waiter = waiting.get(input.attentionId)
          waiting.delete(input.attentionId)
          yield* live.publish({ _tag: 'AttentionClosed', threadId: payload.threadId, attentionId: input.attentionId, outcome: 'answered' })
          if (waiter !== undefined && !waiter.released) {
            yield* Deferred.succeed(waiter.deferred, { action: 'accept', content: questionContent(waiter.question, answers) })
            return { told: true } as const
          }
          return {
            told: false,
            threadId: payload.threadId,
            taskId: row.taskId,
            projectId: row.projectId,
            body: ['Earlier in this thread, the agent then on it asked the person a question. The person answered:', ...words].join('\n'),
          } as const
        }).pipe(
          Effect.catchTags({
            SqlError: Effect.die,
            SchemaError: Effect.die,
            CommandIdReused: Effect.die,
            RowNotFound: Effect.die,
            RevisionConflict: Effect.die,
          }),
        )

      /** The session goes: what it asked waits on the thread, no longer on it, so it is at work until it ends. */
      const release = (sessionId: string) =>
        Effect.andThen(
          Effect.forEach(
            [...waiting].filter(([, waiter]) => waiter.context.sessionId === sessionId),
            ([attentionId, waiter]) =>
              Effect.suspend(() => {
                waiter.released = true
                waiting.delete(attentionId)
                return Deferred.interrupt(waiter.deferred)
              }),
            { discard: true },
          ),
          Effect.ignore(
            run(SqlClient.SqlClient.pipe(Effect.flatMap((sql) => sql.withTransaction(releaseSession(sessionId, { questions: false }))))),
          ),
        )

      return Questions.of({
        ask: (askContext, question) =>
          run(ask(askContext, question)).pipe(
            // A question Althar couldn't record is answered as one no one could: the agent carries on.
            Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed({ action: 'cancel' } as const))),
          ),
        answer: (input) => run(answer(input)),
        release,
      })
    }),
  )
}
