import { randomBytes } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { Changes } from '../src/Changes'
import { FolderCleanup } from '../src/FolderCleanup'
import { Folders } from '../src/Folders'
import { Instance } from '../src/Instance'
import { Secrets } from '../src/Secrets'

import { computer, digest, gitIn, PHRASE, sessionIds } from './elsewhereFixtures'
import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * Bringing in other tools' work, through the API as the window does it (docs/decisions/workspaces-and-runs.md, "Bringing in
 * other tools' work"; DEV-211, DEV-37): each worktree a task in place, held Up next, with the conversations that ran in it;
 * a setup the repository's; other conversations asides that carry on where they stood. Twice makes nothing twice, and
 * nothing of another tool's changes: its files read the same to the byte, and its folders are never set up, moved, rewound
 * or removed.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`
const steps = [{ key: 'implement' as const, agentId: 'codex', model: null, skipped: false }]

const connectedTo = () =>
  Effect.gen(function* () {
    const machine = computer(repository())
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    const context = yield* Layer.build(
      services({
        database: ':memory:',
        worktreeRoot: join(machine.home, 'Althar'),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents(),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({ github: makeFakeService() }),
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        elsewhere: { home: machine.home, env: {} },
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
    const grant = yield* Context.get(context, Folders).allow(machine.repository)
    const project = yield* client.OpenProject({ commandId: commandId(), grant })
    const sql = <A extends object>(run: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<A>, unknown>) =>
      store(Effect.flatMap(SqlClient.SqlClient, run))
    return { client, store, project, machine, sql }
  })

describe('bringing in other tools’ work', () => {
  it.live(
    'brings each worktree in as a held task in place with its conversations, a setup as the repository’s, the rest as asides, and twice as once',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, project, machine, sql } = yield* connectedTo()
          const found = yield* client.LookElsewhere({ projectId: project.id })
          assert.strictEqual(found.worktrees.length, 7)
          const lima = found.worktrees.find((one) => one.path === machine.worktrees.conductor)
          const codex = found.worktrees.find((one) => one.path === machine.worktrees.codex)
          assert.deepStrictEqual(lima?.conversations, [`claude_code:${sessionIds.inLima}`])
          const conductorSetup = found.setups.find((one) => one.tool === 'conductor')
          assert.isFalse(conductorSetup?.current)
          const before = digest(machine.home)

          const brought = yield* client.BringIn({
            commandId: commandId(),
            projectId: project.id,
            worktrees: [lima?.key ?? '', codex?.key ?? '', 'worktree:/nowhere'],
            setups: [conductorSetup?.key ?? '', found.setups.find((one) => one.tool === 'orca')?.key ?? ''],
            conversations: [`claude_code:${sessionIds.inRoot}`, `codex:${sessionIds.codexLegacy}`],
            steps,
          })
          assert.strictEqual(brought.tasks.length, 2)
          assert.strictEqual(brought.asides.length, 2)
          assert.strictEqual(brought.setups, 1)
          assert.strictEqual(brought.histories, 2)
          // One no longer there, and a second setup for the same repository, each say why; the rest came in.
          assert.deepStrictEqual(
            brought.failed.map((one) => one.key),
            ['setup:orca:' + (conductorSetup?.repositoryId ?? ''), 'worktree:/nowhere'],
          )

          // Each worktree is its task's workspace where its tool made it, set up already, its plan held Up next.
          const workspaces = yield* sql(
            (sql) =>
              sql<{
                taskId: string
                path: string
                branch: string
                branched: number
                madeBy: string | null
                setup: string | null
                state: string
              }>`
              SELECT task_id, path, branch, branched_at IS NOT NULL AS branched, made_by, setup, state FROM workspaces
              WHERE task_id IN ${sql.in(brought.tasks)} ORDER BY path`,
          )
          const conductorTask = workspaces.find((one) => one.madeBy === 'conductor')
          assert.strictEqual(conductorTask?.path, machine.worktrees.conductor)
          assert.strictEqual(conductorTask?.branch, 'feature/lima')
          assert.strictEqual(conductorTask?.branched, 1)
          assert.isNotNull(conductorTask?.setup)
          const codexTask = workspaces.find((one) => one.madeBy === 'codex')
          assert.strictEqual(codexTask?.branched, 0)
          const board = yield* client.GetBoard({ projectId: project.id })
          const held = board.tasks.filter((task) => brought.tasks.includes(task.taskId))
          assert.deepStrictEqual(
            held.map((task) => task.phase),
            ['held', 'held'],
          )
          assert.strictEqual(held.find((task) => task.taskId === conductorTask?.taskId)?.title, 'Lima')
          const asides = board.tasks.filter((task) => brought.asides.includes(task.taskId))
          assert.isTrue(asides.every((task) => task.scratch === true))
          assert.sameMembers(
            asides.map((task) => task.title),
            ['Gyroscope fixture failing on CI', 'Rename to compass'],
          )

          // The conversation that ran in Conductor's worktree is its task's history, after the line saying where it came from.
          const thread = yield* client.GetThread({ threadId: held.find((task) => task.taskId === conductorTask?.taskId)?.threadId ?? '' })
          assert.deepStrictEqual(
            thread.items.map((item) => item.kind),
            ['notice', 'notice', 'user_message', 'agent_message'],
          )
          assert.strictEqual(thread.items[2]?.createdAt, '2026-11-10T09:00:01.000Z')

          // The repository keeps Conductor's setup, run as it ran there.
          const [recorded] = yield* sql(
            (sql) => sql<{ recorded: string }>`SELECT recorded_setup AS recorded FROM repository_bindings WHERE project_id = ${project.id}`,
          )
          assert.deepStrictEqual(JSON.parse(recorded?.recorded ?? '{}').copy, ['.env'])
          assert.match(JSON.parse(recorded?.recorded ?? '{}').commands[0], /^export CONDUCTOR_ROOT_PATH=/)

          // What the person said there finds it.
          const search = yield* client.SearchTasks({ projectId: project.id, text: 'quaternion gyroscope' })
          assert.deepStrictEqual(
            search.tasks.map((task) => task.taskId),
            [asides.find((task) => task.title === 'Gyroscope fixture failing on CI')?.taskId],
          )

          // Twice is once: what came in is found and named, and nothing new is made.
          const count = () =>
            sql((sql) => sql<{ n: number }>`SELECT (SELECT count(*) FROM tasks) + (SELECT count(*) FROM thread_items) AS n`)
          const made = yield* count()
          const again = yield* client.BringIn({
            commandId: commandId(),
            projectId: project.id,
            worktrees: [lima?.key ?? '', codex?.key ?? ''],
            setups: [],
            conversations: [`claude_code:${sessionIds.inRoot}`, `codex:${sessionIds.codexLegacy}`, `claude_code:${sessionIds.inLima}`],
            steps,
          })
          assert.deepStrictEqual([again.tasks, again.asides, again.histories], [[], [], 0])
          assert.deepStrictEqual(yield* count(), made)
          const looked = yield* client.LookElsewhere({ projectId: project.id })
          assert.strictEqual(looked.worktrees.find((one) => one.key === lima?.key)?.taskId, conductorTask?.taskId)
          assert.isTrue(looked.setups.find((one) => one.tool === 'conductor')?.current)
          // Nothing of any tool's changed.
          assert.strictEqual(digest(machine.home), before)
        }),
      ),
    { timeout: 120_000 },
  )

  it.live('never removes, rewinds or switches a folder another tool made', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project, machine } = yield* connectedTo()
        const found = yield* client.LookElsewhere({ projectId: project.id })
        const key = found.worktrees.find((one) => one.path === machine.worktrees.orca)?.key ?? ''
        const brought = yield* client.BringIn({
          commandId: commandId(),
          projectId: project.id,
          worktrees: [key],
          setups: [],
          conversations: [],
          steps,
        })
        const taskId = brought.tasks[0] ?? ''
        const head = gitIn(machine.worktrees.orca, 'rev-parse', 'HEAD')
        const actor = yield* store(Effect.map(Instance, (instance) => instance.personId))
        const refused = yield* store(Effect.flatMap(Changes, (changes) => Effect.flip(changes.leaveWorktree(taskId, actor))))
        assert.include(String((refused as { message?: string }).message), 'another tool made')
        // Abandoned, a finished task's folder is never cleaned up: Orca's stays Orca's.
        yield* client.AbandonTask({ commandId: commandId(), taskId })
        yield* store(Effect.flatMap(FolderCleanup, (cleanup) => cleanup.cleanUp(actor)))
        assert.isTrue(existsSync(join(machine.worktrees.orca, 'README.md')))
        assert.strictEqual(gitIn(machine.worktrees.orca, 'rev-parse', 'HEAD'), head)
        assert.strictEqual(gitIn(machine.worktrees.orca, 'status', '--porcelain'), 'M README.md')
      }),
    ),
  )

  it.live('brings a worktree its tool removed back in a folder of Althar’s own, from its branch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, project, machine, sql } = yield* connectedTo()
        const found = yield* client.LookElsewhere({ projectId: project.id })
        const key = found.worktrees.find((one) => one.path === machine.worktrees.t3)?.key ?? ''
        const brought = yield* client.BringIn({
          commandId: commandId(),
          projectId: project.id,
          worktrees: [key],
          setups: [],
          conversations: [],
          steps,
        })
        const taskId = brought.tasks[0] ?? ''
        rmSync(machine.worktrees.t3, { recursive: true, force: true })
        const [thread] = yield* sql((sql) => sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId}`)
        yield* client.Send({ commandId: commandId(), threadId: thread?.id ?? '', body: 'Carry on', disposition: 'after_current' })
        // Its lead starting brings its folder back first, as for any task whose folder went.
        yield* client.StartSession({ commandId: commandId(), threadId: thread?.id ?? '', agentId: 'codex' })
        yield* until(
          sql((sql) => sql<{ id: string }>`SELECT id FROM turn_deliveries WHERE thread_id = ${thread?.id ?? ''}`),
          (rows) => rows.length > 0,
        )
        const [workspace] = yield* sql(
          (sql) => sql<{ path: string; madeBy: string | null }>`SELECT path, made_by FROM workspaces WHERE task_id = ${taskId}`,
        )
        assert.strictEqual(workspace?.madeBy, null)
        assert.isTrue(workspace?.path.startsWith(join(machine.home, 'Althar')))
        assert.strictEqual(gitIn(workspace?.path ?? '', 'branch', '--show-current'), 't3/1a2b3c4d')
        assert.isFalse(existsSync(machine.worktrees.t3))
      }),
    ),
  )

  it.live(
    'carries an aside brought in on where it stood: its copy made as the person writes, its first brief the conversation so far',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { client, project, sql } = yield* connectedTo()
          const brought = yield* client.BringIn({
            commandId: commandId(),
            projectId: project.id,
            worktrees: [],
            setups: [],
            conversations: [`claude_code:${sessionIds.inRoot}`],
            steps,
          })
          const taskId = brought.asides[0] ?? ''
          const [thread] = yield* sql((sql) => sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId}`)
          const threadId = thread?.id ?? ''
          const [unmade] = yield* sql((sql) => sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`)
          assert.isFalse(existsSync(unmade?.path ?? ''))
          yield* client.Send({ commandId: commandId(), threadId, body: 'Is it fixed now?', disposition: 'after_current' })
          yield* client.StartSession({ commandId: commandId(), threadId, agentId: 'codex' })
          const turns = yield* until(
            sql((sql) => sql<{ prompt: string }>`SELECT prompt FROM turn_deliveries WHERE thread_id = ${threadId}`),
            (rows) => rows.length > 0,
          )
          const prompt = turns[0]?.prompt ?? ''
          assert.include(prompt, "You are an aside of this project's coordinator")
          assert.include(prompt, 'brought in from another tool')
          assert.include(prompt, PHRASE)
          assert.include(prompt, '[claude-code] Looking at the test first.\n\nThe fixture rounds too early. Fixed.')
          assert.isTrue(existsSync(unmade?.path ?? ''))
          // Made as it was first needed: nothing in the thread says a folder came back.
          const items = (yield* client.GetThread({ threadId })).items
          assert.isFalse(items.some((item) => item.kind === 'notice' && JSON.stringify(item).includes('Folder back')))
        }),
      ),
  )
})
