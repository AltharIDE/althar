import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Ref, Stream } from 'effect'

import { type AgentConnection, connect, type PermissionDecision, type PermissionRequest, type Transport } from '../src/AgentConnection'
import type { SessionEvent } from '../src/events'

/*
 * The adapter contract (docs/architecture/03), written once and run against
 * the fake agent in CI and against the real agents on demand. Each agent
 * supplies its transport, its modes, a model to switch to, and prompts that
 * produce a short turn and a long one.
 */

export interface ContractSubject {
  readonly name: string
  readonly transport: (cwd: string) => Transport
  readonly cwd: string
  readonly modes: { readonly ask: string; readonly readOnly: string }
  readonly model: { readonly optionId: string; readonly switchTo: string }
  readonly prompts: { readonly short: string; readonly long: string }
}

export const withConnection = <A, E>(
  subject: ContractSubject,
  use: (connection: AgentConnection, permissions: Ref.Ref<ReadonlyArray<PermissionRequest>>) => Effect.Effect<A, E>,
  decide: PermissionDecision = 'reject',
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const permissions = yield* Ref.make<ReadonlyArray<PermissionRequest>>([])
      const connection = yield* connect({
        transport: subject.transport(subject.cwd),
        onPermission: (request) =>
          Effect.as(
            Ref.update(permissions, (seen) => [...seen, request]),
            decide,
          ),
      })
      return yield* use(connection, permissions)
    }),
  )

export const text = (events: ReadonlyArray<SessionEvent>) =>
  events.flatMap((event) => (event._tag === 'AgentMessage' ? [event.text] : [])).join('')

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
            const session = yield* connection.newSession({ cwd: subject.cwd, mode })
            const options = yield* session.options
            assert.strictEqual(options.find((option) => option.category === 'mode')?.currentValue, mode)
          }
        }),
      ),
    )

    it.live('changes the model within a session', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: subject.cwd, mode: subject.modes.ask })
          const options = yield* session.setOption(subject.model.optionId, subject.model.switchTo)
          assert.strictEqual(options.find((option) => option.id === subject.model.optionId)?.currentValue, subject.model.switchTo)
        }),
      ),
    )

    it.live('streams a turn in order, ending with the reason it stopped', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: subject.cwd, mode: subject.modes.ask })
          const events = yield* Stream.runCollect(session.prompt(subject.prompts.short))
          const last = events.at(-1)
          assert.strictEqual(last?._tag, 'TurnEnded')
          assert.strictEqual(last?._tag === 'TurnEnded' ? last.stopReason : undefined, 'end_turn')
          assert.isAbove(text(events).length, 0)
          assert.isTrue(events.slice(0, -1).every((event) => event._tag !== 'TurnEnded'))
        }),
      ),
    )

    it.live('stops a turn when cancelled', () =>
      withConnection(subject, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: subject.cwd, mode: subject.modes.ask })
          const turn = yield* Effect.forkChild(Stream.runCollect(session.prompt(subject.prompts.long)))
          yield* Effect.sleep('1500 millis')
          yield* session.cancel
          const events = yield* Fiber.join(turn)
          const last = events.at(-1)
          assert.strictEqual(last?._tag === 'TurnEnded' ? last.stopReason : undefined, 'cancelled')
        }),
      ),
    )
  })
