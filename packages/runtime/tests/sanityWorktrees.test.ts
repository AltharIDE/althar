import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Context, Effect, Exit, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { connection, services } from '../src/Api'
import { Folders } from '../src/Folders'
import { place } from '../src/local'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { Sessions } from '../src/Sessions'
import { Setups } from '../src/Setups'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeAgents, fakeConnectors, notices, repository, runtime, until } from './support'

/*
 * A sanity pass over worktrees and their setup: a folder that goes missing,
 * Local beside worktrees, and what the person sends to a task whose folder
 * went. Each test here is marked as failing: it shows a defect, and flips to
 * passing once that is fixed.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** Opens a repository as a project and makes a task in it, with its worktree, and the access its lead has. */
const taskIn = (path: string, worksIn?: 'checkout') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Fix the login' }),
      projectId: project.projectId,
      title: 'Fix the login',
      ...(worksIn === undefined ? {} : { draft: true, worksIn }),
    })
    const lead: ToolAccess = {
      role: 'lead',
      projectId: project.projectId as ProjectId,
      threadId: task.threadId,
      sessionId: 'none',
      taskId: task.taskId,
    }
    return { project, task, lead }
  })

/** How the task's worktrees were set up, once each has been. */
const setUpsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* until(
      sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${taskId}`,
      (rows) => rows.length > 0 && rows.every((row) => row.setup !== null),
    )
  })

describe('a recorded setup that couldn’t copy a file it names', () => {
  // Finding (sanity pass): the setup item's `ended.missing` (the files a recorded setup couldn't copy, which fail it) is
  // written by Setups.ts but dropped by Queries.ts' item reader, so the window never hears the setup failed: it shows it as
  // gone through, while the lead is told it failed. Flips to passing when fixed.
  it.live.fails('reaches the window as failed, with the files it couldn’t copy', () =>
    Effect.gen(function* () {
      // A repository that ignores `.env`: its first lead records copying it, and the person's checkout hasn't one (any more).
      const path = repository()
      writeFileSync(join(path, '.gitignore'), '.env\n')
      git(path, 'add', '.')
      git(path, 'commit', '-q', '-m', 'Ignore .env')
      const first = yield* taskIn(path)
      yield* setUpsOf(first.task.taskId)
      yield* callTool(first.lead, 'record_setup', { copy: ['.env'], commands: [] })

      // The next task's worktree is set up with it, and the copy fails.
      const projects = yield* Projects
      const next = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Second' }),
        projectId: first.project.projectId,
        title: 'Second',
      })
      const [row] = yield* setUpsOf(next.taskId)
      assert.deepStrictEqual((JSON.parse(row?.setup ?? '{}') as { missing?: unknown }).missing, ['.env'])
      // As the lead is told: it failed.
      const told = yield* (yield* Setups).told(next.taskId)
      assert.include(told ?? '', "couldn't copy `.env`")

      // As the window reads it.
      const thread = yield* (yield* Queries).thread(next.threadId)
      const setup = thread.items.find((item) => item.kind === 'setup')
      assert.deepStrictEqual(setup?.kind === 'setup' ? setup.content.ended?.missing : 'no setup item', ['.env'])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})

describe('a task whose worktree the person deleted', () => {
  // Finding (sanity pass): a worktree folder deleted by hand makes its lead's start say the agent "isn't installed, or isn't
  // on this Mac's PATH" (spawn's ENOENT for the missing cwd, read as a missing command). Flips to passing when fixed.
  it.live.fails('doesn’t say the agent isn’t installed when it is its folder that is missing', () =>
    Effect.gen(function* () {
      const { task } = yield* taskIn(repository())
      yield* setUpsOf(task.taskId)
      // The person removes the task's folder in Finder, or with rm -rf, while the task is open.
      rmSync(task.worktree, { recursive: true, force: true })
      // `process` runs the fake agent as a real process, as every real agent runs.
      yield* Effect.exit((yield* Sessions).start({ threadId: task.threadId, agentId: 'process' }))
      // Brought back, it starts; or the thread says its folder is missing. Never that an agent that is installed isn't.
      const said = (yield* notices(task.threadId)).map((one) => `${one.title} ${one.description ?? ''}`)
      assert.notMatch(said.join('\n'), /isn't installed/)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a Local task’s lead asking for its setup', () => {
  // Finding (sanity pass): install_dependencies in a Local task (its folder is the person's checkout) is refused as "The
  // task's worktree isn't on this computer … Tell the person", which is false: the checkout is right here. Flips to passing
  // when fixed.
  it.live.fails('isn’t told its folder isn’t on this computer', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, lead } = yield* taskIn(root, 'checkout')
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      const said = yield* callTool(lead, 'install_dependencies', {})
      assert.notInclude(said, "isn't on this computer")
    }).pipe(Effect.provide(runtime())),
  )
})

/** The runtime's API over a channel, as the window reaches it, with the folders it grants and its services. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents({}, [], {}),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({}),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      setups: { shell: '/bin/sh' },
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
  const grant = (path: string) => Context.get(context, Folders).allow(path)
  return { client, grant, sql: Context.get(context, SqlClient.SqlClient) }
})

describe('a file sent to a finished task whose folder was removed', () => {
  // Finding (sanity pass): once a finished task's folder is removed to free the disk, a file the person sends its lead is
  // refused, "The task's folder isn't ready yet.", and stays refused: nothing brings the folder back for a send, only for an
  // agent starting, which the refused send never gets to. Flips to passing when fixed.
  it.live.fails('brings the folder back, or keeps the file, rather than refusing it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, sql } = yield* connected
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Add a retry' })
        const [workspace] = yield* until(
          sql<{ path: string; setup: string | null }>`SELECT path, setup FROM workspaces WHERE task_id = ${task.id}`,
          (rows) => rows.length > 0 && rows.every((row) => row.setup !== null),
        )
        const worktree = workspace?.path ?? ''
        writeFileSync(join(worktree, 'retry.ts'), 'retry\n')
        git(worktree, 'add', '.')
        git(worktree, 'commit', '-q', '-m', 'Add a retry')
        // Merged and settled four days ago: past Smart's wait for a merged change, so Clean up takes its folder.
        const at = new Date(Date.now() - 4 * 86_400_000).toISOString()
        yield* sql`UPDATE workspaces SET branched_at = ${at} WHERE task_id = ${task.id}`
        yield* sql`UPDATE tasks SET state = 'done', settled_at = ${at}, seen_at = NULL, opened_at = NULL WHERE id = ${task.id}`
        const freed = yield* client.CleanUpFolders({ commandId: commandId() })
        assert.strictEqual(freed.failed, 0)
        const [gone] = yield* sql<{ state: string }>`SELECT state FROM workspaces WHERE task_id = ${task.id}`
        assert.strictEqual(gone?.state, 'cleaned')

        // The person follows it up, with the log of what broke since.
        const from = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
        writeFileSync(join(from, 'build.log'), 'error: the retry loops forever\n')
        const sent = yield* Effect.exit(
          client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'It loops forever now: see the log',
            disposition: 'after_current',
            files: [{ grant: yield* grant(join(from, 'build.log')) }],
          }),
        )
        assert.isTrue(Exit.isSuccess(sent), Exit.isFailure(sent) ? String(Exit.isFailure(sent) && sent.cause) : '')
      }),
    ),
  )
})
