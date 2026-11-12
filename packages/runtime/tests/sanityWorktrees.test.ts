import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { backWords } from '../src/bringBack'
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
  // written by Setups.ts and reaches the window through Queries.ts' item reader, so the window hears the setup failed, as
  // the lead is told.
  it.live('reaches the window as failed, with the files it couldn’t copy', () =>
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
  // Finding (sanity pass): a worktree folder deleted by hand made its lead's start say the agent "isn't installed, or isn't
  // on this Mac's PATH" (spawn's ENOENT for the missing cwd, read as a missing command). It comes back from its branch before
  // the lead starts, as a removed one does; one that can't is said as its folder.
  it.live('doesn’t say the agent isn’t installed when it is its folder that is missing', () =>
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
      // It came back from its branch, as a removed one does, and the thread says so.
      assert.isTrue(existsSync(task.worktree))
      assert.include(said.join('\n'), backWords)
      // Marked gone as of then, as a removed one is: its header says it is coming back, and nothing removes it, until it is
      // set up again.
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ cleanedAt: string | null }>`SELECT cleaned_at FROM workspaces WHERE task_id = ${task.taskId}`
      assert.isNotNull(row?.cleanedAt ?? null)
    }).pipe(Effect.provide(runtime())),
  )

  // Neighbouring path: a Local task's folder is the person's checkout, which Althar never brings back. Gone, its lead's
  // start says the folder is, not that the agent isn't installed.
  it.live('says a Local task’s checkout is gone, rather than that the agent isn’t installed', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task } = yield* taskIn(root, 'checkout')
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      rmSync(root, { recursive: true, force: true })
      yield* Effect.exit((yield* Sessions).start({ threadId: task.threadId, agentId: 'process' }))
      const said = (yield* notices(task.threadId)).map((one) => `${one.title} ${one.description ?? ''}`).join('\n')
      assert.notMatch(said, /isn't installed/)
      assert.include(said, `Its folder isn't there any more: ${root}.`)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a Local task’s lead asking for its setup', () => {
  // Finding (sanity pass): install_dependencies in a Local task (its folder is the person's checkout) was refused as "The
  // task's worktree isn't on this computer … Tell the person", which is false: the checkout is right here. It runs the
  // setup there, as asked.
  it.live('isn’t told its folder isn’t on this computer', () =>
    Effect.gen(function* () {
      const root = repository()
      const { task, lead } = yield* taskIn(root, 'checkout')
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      const said = yield* callTool(lead, 'install_dependencies', {})
      assert.notInclude(said, "isn't on this computer")
      // Its setup runs in the checkout: here, a repository with nothing to install, and nothing to record from it.
      assert.include(said, 'nothing Althar can tell to install')
      assert.notInclude(said, 'record_setup')
    }).pipe(Effect.provide(runtime())),
  )

  // Neighbouring path: record_setup there was refused with the same false words. The person's checkout was ready before
  // the task, so what it needed isn't what a new worktree needs: there is nothing to record from it.
  it.live('isn’t told its folder isn’t on this computer as it records a setup, and records none', () =>
    Effect.gen(function* () {
      const { task, lead } = yield* taskIn(repository(), 'checkout')
      assert.deepStrictEqual(yield* place(task.taskId, 'checkout'), { kind: 'ready' })
      const said = yield* callTool(lead, 'record_setup', { commands: [] })
      assert.notInclude(said, "isn't on this computer")
      assert.include(said, 'works Local')
      const sql = yield* SqlClient.SqlClient
      const [binding] = yield* sql<{ recorded: string | null }>`SELECT recorded_setup AS recorded FROM repository_bindings`
      assert.isNull(binding?.recorded ?? null)
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
  // Finding (sanity pass): once a finished task's folder was removed to free the disk, a file the person sent its lead was
  // refused, "The task's folder isn't ready yet.", and stayed refused: nothing brought the folder back for a send, only for
  // an agent starting, which the refused send never got to. The folder now comes back before the file is copied into it.
  it.live('brings the folder back, or keeps the file, rather than refusing it', () =>
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

        // A file that can't be sent is refused before anything comes back for it.
        const from = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
        writeFileSync(join(from, 'gone.log'), 'x\n')
        const unsendable = yield* grant(join(from, 'gone.log'))
        rmSync(join(from, 'gone.log'))
        const refused = yield* Effect.exit(
          client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'See',
            disposition: 'after_current',
            files: [{ grant: unsendable }],
          }),
        )
        assert.isTrue(Exit.isFailure(refused))
        const [still] = yield* sql<{ state: string }>`SELECT state FROM workspaces WHERE task_id = ${task.id}`
        assert.strictEqual(still?.state, 'cleaned')

        // The person follows it up, with the log of what broke since.
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
        // Its folder is back, with what it had committed, for the file to be copied into; kept as opened, so a cleanup
        // doesn't take it again with the file before its lead reads it.
        assert.isTrue(existsSync(join(worktree, 'retry.ts')))
        const [opened] = yield* sql<{ openedAt: string | null }>`SELECT opened_at FROM tasks WHERE id = ${task.id}`
        assert.isNotNull(opened?.openedAt ?? null)
      }),
    ),
  )

  // Neighbouring path: a folder that can't come back, its branch gone with it, refuses the file as a file, in words for it.
  it.live('refuses a file for a folder that can’t come back as the file, saying why', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, sql } = yield* connected
        const root = repository()
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(root) })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Add a retry' })
        const [workspace] = yield* until(
          sql<{ path: string; branch: string; setup: string | null }>`
            SELECT path, branch, setup FROM workspaces WHERE task_id = ${task.id}`,
          (rows) => rows.length > 0 && rows.every((row) => row.setup !== null),
        )
        // On a branch of its own, deleted by hand with its folder.
        yield* sql`UPDATE workspaces SET branched_at = ${new Date().toISOString()} WHERE task_id = ${task.id}`
        rmSync(workspace?.path ?? '', { recursive: true, force: true })
        git(root, 'worktree', 'prune')
        git(root, 'branch', '-D', workspace?.branch ?? '')
        const from = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
        writeFileSync(join(from, 'build.log'), 'error\n')
        const sent = yield* Effect.exit(
          client.Send({
            commandId: commandId(),
            threadId: task.threadId,
            body: 'See the log',
            disposition: 'after_current',
            files: [{ grant: yield* grant(join(from, 'build.log')) }],
          }),
        )
        assert.isTrue(Exit.isFailure(sent))
        assert.include(String(Exit.isFailure(sent) && sent.cause), 'nowhere to put the file')
      }),
    ),
  )
})
