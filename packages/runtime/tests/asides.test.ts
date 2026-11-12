import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'
import { Setups } from '../src/Setups'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'

import { callTool, fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * An aside the person opens with + (docs/decisions/tasks.md, "Asides"), through the API as the window starts one: made on
 * Scratch by the id the window made, its lead started at once and waiting for the person's first words, which go out with its
 * light brief in one turn; that turn's reply is the answer, and ends its step with no report and no reminder to give one.
 *
 * Its prompt is held to a budget: a lead's whole brief, with its finish_step and evidence rules, was most of what made a plain
 * "hi" take 16 seconds (three model calls and 30K tokens written to the model's cache, where one call and the brief alone now
 * do), and a brief that grows past it again costs every aside's first answer.
 */

/** The most an aside's first prompt may be, in characters: its brief and the person's words, with the notes of a busy project. */
const ASIDE_PROMPT_MOST = 6_000

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({ github: makeFakeService() }),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
  yield* Effect.forkScoped(
    Layer.launch(
      connection(
        emitterPort(channel.port1, (data) => data),
        { kind: 'window' },
      ),
    ).pipe(Effect.provideContext(context)),
  )
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  const store = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideContext(context as Context.Context<R>))
  const grant = yield* Context.get(context, Folders).allow(repository())
  const project = yield* client.OpenProject({ commandId: commandId(), grant })
  return { client, store, project }
})

const sqlOf = <A extends object>(query: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>) =>
  Effect.flatMap(SqlClient.SqlClient, query)

describe('an aside opened with +', () => {
  it.live(
    'is made on Scratch by the window’s id, its lead waiting for the first words, which its light brief goes out with in one turn that ends it',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, store, project } = yield* connected
          const taskId = `task_${randomBytes(16).toString('hex')}`
          const aside = yield* client.StartTask({
            commandId: commandId(),
            projectId: project.id,
            title: '',
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
            chat: true,
            taskId,
          })
          // The window's own id, so its one pill was keyed by it before this answered.
          assert.strictEqual(aside.id, taskId)
          // On Scratch in the transaction that made it: never on the board, even for a moment.
          const events = yield* store(
            sqlOf((sql) => sql<{ type: string }>`SELECT type FROM record_events WHERE aggregate_id = ${taskId} ORDER BY sequence`),
          )
          assert.deepStrictEqual(
            events.slice(0, 2).map((event) => event.type),
            ['task.created', 'task.shelved'],
          )
          const board = yield* client.GetBoard({ projectId: project.id })
          const card = board.tasks.find((task) => task.taskId === taskId)
          assert.isTrue(card?.scratch)
          assert.isTrue(card?.unsaid)
          // Its lead starts at once, and waits: nothing goes to it before the person's words.
          yield* until(client.GetThread({ threadId: aside.threadId }), (thread) => thread.session?.state === 'active')
          const turns = () =>
            store(
              sqlOf(
                (sql) => sql<{ prompt: string; state: string }>`
                SELECT prompt, state FROM turn_deliveries WHERE thread_id = ${aside.threadId} ORDER BY requested_at`,
              ),
            )
          assert.isEmpty(yield* turns())

          // Its first words name it and go to its thread, as the window sends them.
          yield* client.RenameTask({ commandId: commandId(), taskId, title: 'hi' })
          yield* client.Send({ commandId: commandId(), threadId: aside.threadId, body: 'hi', disposition: 'after_current' })
          // Its turn's reply ends its step: the run is over, with no reminder to report, and no report.
          yield* until(store(sqlOf((sql) => sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId}`)), (runs) =>
            runs.some((run) => run.state === 'succeeded'),
          )
          const delivered = yield* turns()
          assert.lengthOf(delivered, 1)
          const [first] = delivered
          const prompt = first?.prompt ?? ''
          // The brief and the words, together, and light: none of a task's step to report, its thread or the coordinator's news.
          assert.include(prompt, "You are an aside of this project's coordinator")
          assert.isTrue(prompt.endsWith('hi'))
          assert.isBelow(prompt.length, ASIDE_PROMPT_MOST)
          for (const heavy of ["call Althar's finish_step tool", 'gather evidence', 'The thread so far', 'Since you last spoke'])
            assert.notInclude(prompt, heavy)
          const thread = yield* client.GetThread({ threadId: aside.threadId })
          assert.isFalse(thread.items.some((item) => item.kind === 'step_result'))
          assert.isEmpty(thread.reports)
          // Said in, it is an aside like any other, with its pill.
          const after = (yield* client.GetBoard({ projectId: project.id })).tasks.find((task) => task.taskId === taskId)
          assert.strictEqual(after?.title, 'hi')
          assert.isUndefined(after?.unsaid)
          // No card of it in the coordinator's conversation.
          const coordinator = yield* client.GetCoordinator({ projectId: project.id })
          assert.isFalse(coordinator.items.some((item) => item.kind === 'task' && item.content.taskId === taskId))
        }),
      ),
  )

  it.live('reads a line its thread keeps for Althar alone, as a window does each one it hears changed, as nothing to show', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project } = yield* connected
        const aside = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Which file holds the retry?',
          description: 'Which file holds the retry?',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          chat: true,
        })
        // What its lead could see, as its session's start keeps it: the window hears it was added, and reads it by its id.
        const id = yield* store(
          addItem({ projectId: project.id as ProjectId, threadId: aside.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            role: 'skills',
            lead: 'Fake codex',
            title: 'Fake codex could see a skill',
            skills: [],
          }),
        )
        assert.isNull(yield* client.GetThreadItem({ threadId: aside.threadId, itemId: id }))
        // One that isn't there at all is still not found.
        const missing = yield* Effect.flip(client.GetThreadItem({ threadId: aside.threadId, itemId: 'item_missing' }))
        assert.strictEqual(missing.reason, 'NotFound')
      }),
    ),
  )

  it.live(
    'never installs or sets up, as it is made, before its turns or asked to; its lead is told it becomes a task, and made one, it is set up',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, store, project } = yield* connected
          // The repository's recorded setup, as a lead records it: what every task's worktree gets before its lead starts.
          const recorded = { copy: [], commands: ['echo installed > installed.txt'], at: '2026-11-12T00:00:00.000Z', taskId: null }
          yield* store(
            sqlOf(
              (sql) => sql`UPDATE repository_bindings SET recorded_setup = ${JSON.stringify(recorded)} WHERE project_id = ${project.id}`,
            ),
          )
          const taskId = `task_${randomBytes(16).toString('hex')}`
          const aside = yield* client.StartTask({
            commandId: commandId(),
            projectId: project.id,
            title: '',
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
            chat: true,
            taskId,
          })
          yield* client.Send({ commandId: commandId(), threadId: aside.threadId, body: 'hi', disposition: 'after_current' })
          yield* until(store(sqlOf((sql) => sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId}`)), (runs) =>
            runs.some((run) => run.state === 'succeeded'),
          )
          const copy = () =>
            store(sqlOf((sql) => sql<{ setup: string | null; path: string }>`SELECT setup, path FROM workspaces WHERE task_id = ${taskId}`))
          // Asked as a turn asks, and as a folder brought back asks: nothing of it is set up, and nothing ran in it.
          yield* store(Effect.flatMap(Setups, (setups) => setups.ready(taskId)))
          const [made] = yield* copy()
          assert.isNull(made?.setup ?? null)
          assert.isFalse(existsSync(join(made?.path ?? '', 'installed.txt')))
          const thread = yield* client.GetThread({ threadId: aside.threadId })
          assert.isFalse(thread.items.some((item) => item.kind === 'setup'))
          // Its lead asks for an install, or for the project, a branch or a task running: each is a build, so a task's.
          const [session] = yield* store(
            sqlOf((sql) => sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${aside.threadId} LIMIT 1`),
          )
          const lead: ToolAccess = { role: 'lead', projectId: project.id, threadId: aside.threadId, sessionId: session?.id ?? '', taskId }
          for (const [tool, args] of [
            ['install_dependencies', {}],
            ['run_project', {}],
            ['run_project', { branch: 'main' }],
          ] as const) {
            const said = yield* store(callTool(lead, tool, args))
            assert.include(said, 'an aside never installs', tool)
            assert.include(said, 'Make it a task', tool)
          }
          // The person's own Run of its copy says so in their words.
          const run = yield* Effect.flip(
            client.RunProject({ commandId: commandId(), projectId: project.id, taskId, threadId: aside.threadId }),
          )
          assert.include(run.message, 'Make it a task to run it')
          assert.isNull((yield* copy())[0]?.setup ?? null)
          // Made a task, it is work: its copy is set up behind, as the person's press lands.
          yield* client.ShelveTask({ commandId: commandId(), taskId, shelf: null })
          yield* until(copy(), (rows) => rows[0]?.setup != null)
          assert.isTrue(existsSync(join(made?.path ?? '', 'installed.txt')))
        }),
      ),
  )

  it.live('clears whatever it stands at: one waiting on the person’s answer settles as Done, its question withdrawn', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project } = yield* connected
        const aside = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Which ADRs?',
          description: 'Which ADRs should it keep? [lead:wait-for-person]',
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          chat: true,
        })
        const asks = () => store(sqlOf((sql) => sql<{ state: string }>`SELECT state FROM attention_requests WHERE task_id = ${aside.id}`))
        yield* until(asks(), (rows) => rows.some((row) => row.state === 'open'))
        // Done alone wouldn't settle it, as it waits on the person: cleared, it settles all the same.
        yield* client.MarkTaskDone({ commandId: commandId(), taskId: aside.id })
        const [task] = yield* store(sqlOf((sql) => sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${aside.id}`))
        assert.strictEqual(task?.state, 'done')
        assert.isTrue((yield* asks()).every((row) => row.state === 'withdrawn'))
        const card = (yield* client.GetBoard({ projectId: project.id })).tasks.find((one) => one.taskId === aside.id)
        assert.strictEqual(card?.phase, 'settled')
      }),
    ),
  )
})
