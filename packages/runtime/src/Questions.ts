import { type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import { Commands, Ledger } from '@althar/persistence-sqlite'
import {
  type FieldAnswer,
  type Question,
  type QuestionAnswer,
  answerWords,
  type QuestionField,
  questionContent,
  takesWords,
} from '@althar/provider-adapters'
import { Cause, Context, Crypto, Deferred, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { AttentionClosed, NotFound, QuestionUnanswered } from './errors'
import { Instance } from './Instance'
import { Live } from './Live'
import { moveSession, releaseSession } from './Permissions'
import { change, fact, timestamp } from './records'
import { addItem, updateItem } from './threads'

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
  /** Why it asks, in a line: what the agent said just before, as the home shows it under the question. */
  readonly why?: string
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

/**
 * The question in a line, for the call's title: what it asks first. An
 * agent asking several at once says little in its message ("Please answer
 * the following questions."), so the first question names them.
 */
export const questionTitle = (payload: Pick<QuestionPayload, 'message' | 'fields'>) => payload.fields[0]?.question ?? payload.message

/** Markdown's marks taken off, as a line shows words: code, emphasis, headings, list marks, links. */
const plain = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

/** How long a why may be: a line or two under the question. */
const WHY_LENGTH = 200

/**
 * Why an agent asks, from what it said just before: its last paragraph that
 * isn't a question itself (that one is asked anyway), plain, and only its
 * last sentences, as many as fit. Nothing where it said nothing first.
 */
export const reasonOf = (said: string | undefined, asked: ReadonlyArray<string>): string | undefined => {
  if (said === undefined) return undefined
  const paragraphs = said
    .split(/\n\s*\n/)
    .map(plain)
    .filter((paragraph) => paragraph !== '')
  const why = paragraphs
    .toReversed()
    .slice(0, 2)
    .find((paragraph) => !paragraph.endsWith('?') && !asked.includes(paragraph))
  if (why === undefined) return undefined
  // From its end, the sentences that fit; a first one that doesn't fit is cut at a word.
  const sentences = why.split(/(?<=[.!:;])\s+/)
  let kept = ''
  for (const sentence of sentences.toReversed()) {
    const next = kept === '' ? sentence : `${sentence} ${kept}`
    if (next.length > WHY_LENGTH) break
    kept = next
  }
  if (kept !== '') return kept
  const cut = why.slice(0, WHY_LENGTH - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`
}

/**
 * A question's call changed (answered, withdrawn): its thread item, which
 * shows it, is read again by every window showing the thread. Nothing for
 * a call that isn't a question.
 */
export const touchQuestion = (attentionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ projectId: ProjectId; itemId: string; content: string }>`
      SELECT a.project_id, i.id AS item_id, i.content FROM attention_requests a
      JOIN thread_items i ON i.id = json_extract(a.payload, '$.itemId')
      WHERE a.id = ${attentionId} AND a.kind = 'question'`
    if (row !== undefined) yield* updateItem(row.projectId, row.itemId, JSON.parse(row.content))
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
              yield* touchQuestion(attentionId)
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
              const why = reasonOf(question.said, [question.message, ...question.fields.map((field) => field.question)])
              const payload: QuestionPayload = {
                threadId: askContext.threadId,
                sessionId: askContext.sessionId,
                itemId,
                toolCallId,
                message: question.message,
                fields: question.fields,
                ...(why === undefined ? {} : { why }),
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
              yield* touchQuestion(input.attentionId)
              yield* releaseSession(payload.sessionId)
            }),
          })
          const waiter = waiting.get(input.attentionId)
          waiting.delete(input.attentionId)
          yield* live.publish({ _tag: 'AttentionClosed', threadId: payload.threadId, attentionId: input.attentionId, outcome: 'answered' })
          // Told the agent waiting on it, unless its session went meanwhile.
          const told =
            waiter !== undefined &&
            !waiter.released &&
            (yield* Deferred.succeed(waiter.deferred, { action: 'accept', content: questionContent(waiter.question, answers) }))
          if (told) return { told: true } as const
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

      /** The session goes: what it asked waits on the thread, no longer on it, so it is at work until it ends. Nothing where it asked nothing. */
      const release = (sessionId: string) =>
        Effect.suspend(() => {
          const asked = [...waiting].filter(([, waiter]) => waiter.context.sessionId === sessionId)
          if (asked.length === 0) return Effect.void
          return Effect.andThen(
            Effect.forEach(
              asked,
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
        })

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
