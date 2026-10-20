import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { connection, services } from '../src/Api'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Folders } from '../src/Folders'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeAgents, fakeConnectors, HOST, hosted, ROOMY, runtime } from './support'

/*
 * A task attached to a pull request it didn't open (ADR-052), by the
 * coordinator's attach_pull_request and from the window: what each says of
 * the commits a task keeps on top of the head it starts from, one or
 * several, and of a pull request that can't be attached.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Nine', '-c', 'user.email=nine@althar.test', ...args], { cwd })
    .toString()
    .trim()

const tipOf = (bare: string, branch: string) => {
  try {
    return git(bare, 'rev-parse', `refs/heads/${branch}`)
  } catch {
    return null
  }
}

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `Write ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** The fork (you/api) and the repository it came from (meridian/api) on the fake host, with a pull request into the second from the fork's `fix-send-back`. */
const forked = (state?: 'open' | 'closed') => {
  const { working, bare } = hosted(['you', 'api'])
  git(working, 'remote', 'add', 'upstream', `${HOST}/meridian/api.git`)
  git(working, 'checkout', '-q', '-b', 'fix-send-back')
  const head = commit(working, 'send.ts', 'export const sendBack = () => 1\n')
  git(working, 'push', '-q', bare, 'fix-send-back')
  git(working, 'checkout', '-q', 'main')
  git(working, 'branch', '-q', '-D', 'fix-send-back')
  const github: FakeService = makeFakeService({
    pushUrl: () => bare,
    headOf: (number) => (number === 1 ? tipOf(bare, 'fix-send-back') : null),
  })
  github.addRepository(['you', 'api'])
  github.addRepository(['meridian', 'api'])
  github.addPullRequest({
    path: ['meridian', 'api'],
    title: 'Send back won’t restart a dead lead',
    author: 'you',
    source: 'fix-send-back',
    headSha: head,
    fork: ['you', 'api'],
    ...(state === undefined ? {} : { state }),
  })
  return { working, github, head }
}

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
  )

/** GitHub connected, the fork opened as a project whose pull requests open upstream, a task in it, and the coordinator's tools. */
const project = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const [repository] = yield* projects.repositories(opened.projectId)
    yield* projects.setRepository({ projectId: opened.projectId, repositoryId: repository?.id ?? '', changeTarget: 'upstream' })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Answer the review' }),
      projectId: opened.projectId,
      title: 'Answer the review',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId: yield* (yield* Coordinator).thread(opened.projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { task, coordinator }
  })

describe('the coordinator attaching a task to a pull request', () => {
  it.live('says the one commit the task keeps on top of the head, before and once it starts there', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, coordinator } = yield* project(working)
      commit(task.worktree, 'mine.md', 'Mine.\n')
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1' }),
        'Starting it from there keeps its one commit of its own, on top of the head.',
      )
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1', start_from_head: true }),
        `${task.slug} follows PR #1 now, its branch started from its head with its one commit on top:`,
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD~1'), head)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says how many commits the task keeps on top where it has several', () => {
    const { github, head, working } = forked()
    return Effect.gen(function* () {
      const { task, coordinator } = yield* project(working)
      commit(task.worktree, 'one.md', 'One.\n')
      commit(task.worktree, 'two.md', 'Two.\n')
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1' }),
        'keeps its 2 commits of its own, on top of the head',
      )
      assert.include(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1', start_from_head: true }),
        'its branch started from its head with its 2 commits on top:',
      )
      assert.strictEqual(git(task.worktree, 'rev-parse', 'HEAD~2'), head)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says why a closed pull request can’t be attached', () => {
    const { github, working } = forked('closed')
    return Effect.gen(function* () {
      const { task, coordinator } = yield* project(working)
      assert.strictEqual(
        yield* callTool(coordinator, 'attach_pull_request', { task: task.slug, pull_request: '#1', start_from_head: true }),
        'PR #1 is closed: only an open one can be attached.',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })
})

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

describe('attaching a task to a pull request, from the window', () => {
  it.live('asks first where the task would start over, then follows it once the person says so', () => {
    const { github, working } = forked()
    return Effect.scoped(
      Effect.gen(function* () {
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
            connectors: fakeConnectors({ github }),
            accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
            busy: { machine: ROOMY },
            checksAppear: Duration.zero,
          }),
        )
        yield* Effect.forkScoped(Layer.launch(connection(emitterPort(channel.port1, (data) => data))).pipe(Effect.provideContext(context)))
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
        yield* client.ConnectToken({ commandId: commandId(), product: 'github', token: 't', webUrl: HOST })
        const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* Context.get(context, Folders).allow(working) })
        const [repository] = yield* client.GetRepositories({ projectId: project.id })
        yield* client.SetRepository({
          commandId: commandId(),
          projectId: project.id,
          repositoryId: repository?.id ?? '',
          changeTarget: 'upstream',
        })
        const task = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Answer the review' })

        const asked = yield* client.AttachPullRequest({ commandId: commandId(), taskId: task.id, pullRequest: '#1' })
        assert.deepStrictEqual(asked, { kind: 'start', name: 'PR #1', source: 'fix-send-back', started: false, kept: 0, own: 0 })
        const attached = yield* client.AttachPullRequest({ commandId: commandId(), taskId: task.id, pullRequest: '#1', start: true })
        assert.deepStrictEqual(attached, { kind: 'attached', name: 'PR #1', source: 'fix-send-back', started: true, kept: 0, own: 0 })
      }),
    )
  })
})
