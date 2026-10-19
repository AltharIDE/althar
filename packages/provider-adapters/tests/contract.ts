import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Ref, Schedule, type Scope, Stream } from 'effect'

import { type AgentConnection, connect, type PermissionDecision, type PermissionRequest, type Transport } from '../src/AgentConnection'
import type { SessionEvent } from '../src/events'
import { type FieldAnswer, type Question, type QuestionAnswer, questionContent } from '../src/questions'
import type { PermissionMeanings } from '../src/registry'

/*
 * The adapter contract (docs/architecture/03), written once and run against
 * the fake agent in CI and against the real agents on demand. Each agent
 * supplies its transport, modes and option meanings, a model to switch to,
 * and prompts: a short turn, a long one, one that runs a command the agent
 * asks permission for, and one that asks the person a question. Agents
 * differ in how they ask: in a form Althar answers (Claude Code's
 * AskUserQuestion), or in their own words, in a reply.
 */

export interface ContractSubject {
  readonly name: string
  readonly transport: (cwd: string) => Transport
  readonly cwd: string
  /** Null where the agent has no mode and asks by its `sessionMeta` (the registry's `modes`). */
  readonly modes: { readonly ask: string | null; readonly readOnly: string | null }
  readonly modeOptionId?: string
  readonly sessionMeta?: Readonly<Record<string, unknown>>
  /** Options held at a value for the session's life (the registry's `options.held`). */
  readonly held?: Readonly<Record<string, string>>
  readonly permissions?: PermissionMeanings
  readonly model: { readonly optionId: string; readonly switchTo: string }
  readonly prompts: { readonly short: string; readonly long: string; readonly command: string; readonly question: string }
  /** How it asks the person something: in a form Althar answers, or in its own words, as a reply. */
  readonly asks: 'form' | 'words'
}

export type Decide = (request: PermissionRequest) => Effect.Effect<PermissionDecision>

export const rejectAll: Decide = () => Effect.succeed({ decision: 'reject', reason: 'the contract rejects everything' })

export const withConnection = <A, E>(
  subject: ContractSubject,
  use: (connection: AgentConnection, permissions: Ref.Ref<ReadonlyArray<PermissionRequest>>) => Effect.Effect<A, E, Scope.Scope>,
  decide: Decide = rejectAll,
  onQuestion?: (question: Question) => Effect.Effect<QuestionAnswer>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<PermissionRequest>>([])
      const connection = yield* connect({
        transport: subject.transport(subject.cwd),
        onPermission: (request) =>
          Effect.flatMap(
            Ref.update(permissions, (seen) => [...seen, request]),
            () => decide(request),
          ),
        ...(subject.permissions === undefined ? {} : { permissions: subject.permissions }),
        ...(onQuestion === undefined ? {} : { onQuestion }),
      })
      return yield* use(connection, permissions)
    }),
  )

export const sessionIn = (subject: ContractSubject, connection: AgentConnection, mode = subject.modes.ask) =>
  connection.newSession({
    cwd: subject.cwd,
    mode,
    ...(subject.modeOptionId === undefined ? {} : { modeOptionId: subject.modeOptionId }),
    ...(subject.sessionMeta === undefined ? {} : { meta: subject.sessionMeta }),
    ...(subject.held === undefined ? {} : { held: subject.held }),
  })

export const text = (events: ReadonlyArray<SessionEvent>) =>
  events.flatMap((event) => (event._tag === 'AgentMessage' ? [event.text] : [])).join('')

const stopReason = (events: ReadonlyArray<SessionEvent>) => {
  const last = events.at(-1)
  return last?._tag === 'TurnEnded' ? last.stopReason : undefined
}

export const contract = (subject: ContractSubject) =>
  describe(`${subject.name}: the adapter contract`, () => {
    it.live('connects and reports what it can do', () =>
      withConnection(subject, (connection) =>
        Effect.sync(() => {
          assert.strictEqual(connection.info.protocolVersion, 1)
          assert.isString(connection.info.name)
        }),
      ),
    )

    it.live('starts a session in the mode it is told, never the one the agent defaults to', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          for (const mode of [subject.modes.ask, subject.modes.readOnly]) {
            // An agent with no mode starts in none, as its `sessionMeta` holds it.
            if (mode === null) continue
            const session = yield* sessionIn(subject, connection, mode)
            assert.strictEqual(yield* session.mode, mode)
          }
        }),
      ),
    )

    it.live('changes the model within a session', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* sessionIn(subject, connection)
          const options = yield* session.setOption(subject.model.optionId, subject.model.switchTo)
          assert.strictEqual(options.find((option) => option.id === subject.model.optionId)?.currentValue, subject.model.switchTo)
        }),
      ),
    )

    it.live('streams a turn in order, ending with the reason it stopped', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* sessionIn(subject, connection)
          const events = yield* Stream.runCollect(session.prompt(subject.prompts.short))
          assert.strictEqual(stopReason(events), 'end_turn')
          assert.isAbove(text(events).length, 0)
          assert.isTrue(events.slice(0, -1).every((event) => event._tag !== 'TurnEnded'))
        }),
      ),
    )

    it.live('stops a turn when interrupted, and waits for it to end', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* sessionIn(subject, connection)
          const turn = yield* Effect.forkChild(Stream.runCollect(session.prompt(subject.prompts.long)))
          yield* Effect.sleep('1500 millis')
          yield* session.interrupt
          assert.strictEqual(stopReason(yield* Fiber.join(turn)), 'cancelled')
        }),
      ),
    )

    it.live('gives a turn only its own events, even after an earlier turn was stopped early', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* sessionIn(subject, connection)
          yield* Stream.runCollect(Stream.take(session.prompt(subject.prompts.short), 1))
          // The first turn reads to its own end; until it has, a prompt is refused.
          const next = yield* Effect.retry(Stream.runCollect(session.prompt(subject.prompts.short)), {
            schedule: Schedule.spaced('250 millis'),
            times: 240,
            while: (error) => error._tag === 'TurnInProgress',
          })
          assert.strictEqual(stopReason(next), 'end_turn')
          assert.strictEqual(next.filter((event) => event._tag === 'TurnEnded').length, 1)
        }),
      ),
    )

    it.live('lets a turn carry on when a command is rejected', () =>
      withConnection(subject, (connection, permissions) =>
        Effect.gen(function* () {
          const session = yield* sessionIn(subject, connection)
          const events = yield* Stream.runCollect(session.prompt(subject.prompts.command))
          assert.isAbove((yield* Ref.get(permissions)).length, 0, 'the agent never asked')
          const answered = events.filter((event) => event._tag === 'PermissionAnswered')
          assert.isTrue(answered.every((event) => event._tag === 'PermissionAnswered' && event.decision === 'reject'))
          assert.strictEqual(stopReason(events), 'end_turn')
        }),
      ),
    )

    it.live(
      subject.asks === 'form'
        ? 'asks the person in a form, and carries on with their answer'
        : 'asks the person in its own words, with no form to answer',
      () => {
        const asked: Array<Question> = []
        // The last option of a choice, the first of several picks, yes, and a word or a number where words are asked for.
        const picks = (question: Question) =>
          Object.fromEntries(
            question.fields.map((field): [string, FieldAnswer] => [
              field.id,
              field.type === 'text' || field.type === 'number'
                ? { values: [], words: field.type === 'number' ? '3' : 'blue' }
                : { values: [(field.multiple ? field.options[0] : field.options.at(-1))?.value ?? ''] },
            ]),
          )
        return withConnection(
          subject,
          (connection) =>
            Effect.gen(function* () {
              const session = yield* sessionIn(subject, connection)
              const events = yield* Stream.runCollect(session.prompt(subject.prompts.question))
              assert.strictEqual(stopReason(events), 'end_turn')
              if (subject.asks === 'words') {
                assert.lengthOf(asked, 0, 'the agent asked in a form')
                assert.isNotEmpty(text(events).trim())
                return
              }
              const [question] = asked
              assert.isDefined(question, 'the agent never asked')
              const choice = question?.fields.find((field) => field.type === 'choice' && !field.multiple)
              const chosen = choice?.options.at(-1)?.label ?? ''
              assert.isNotEmpty(chosen, 'the question offered no options')
              assert.include(text(events).toLowerCase(), chosen.toLowerCase(), 'the agent did not carry on with the answer')
            }),
          rejectAll,
          (question) =>
            Effect.sync(() => asked.push(question)).pipe(
              Effect.as({ action: 'accept' as const, content: questionContent(question, picks(question)) }),
            ),
        )
      },
    )

    it.live('withdraws a waiting permission request when the turn is interrupted', () =>
      Effect.gen(function* () {
        const asked = yield* Deferred.make<void>()
        const waitForever: Decide = () => Effect.andThen(Deferred.succeed(asked, undefined), Effect.never)
        yield* withConnection(
          subject,
          (connection) =>
            Effect.gen(function* () {
              const session = yield* sessionIn(subject, connection)
              const turn = yield* Effect.forkChild(Stream.runCollect(session.prompt(subject.prompts.command)))
              yield* Deferred.await(asked)
              yield* session.interrupt
              const events = yield* Fiber.join(turn)
              assert.isTrue(events.some((event) => event._tag === 'PermissionWithdrawn'))
              assert.strictEqual(stopReason(events), 'cancelled')
            }),
          waitForever,
        )
      }),
    )
  })
