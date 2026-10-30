import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { SqlClient } from 'effect/sql'

import { Permissions } from '../src/Permissions'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { callTool, notices, repository, runtime, turns, until } from './support'

/*
 * A tag the lead makes, pushed by Althar (ADR-013): agents have no sign-in
 * to the code host, and a tag often starts a release, so it waits for the
 * person as the lead's own push of it would, and goes up only once allowed.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/** A task in a repository whose work goes to a bare remote here, with its lead running: the lead's access, its worktree and the remote. */
const leadWithRemote = (origin: 'bare' | 'none' = 'bare') =>
  Effect.gen(function* () {
    const root = repository()
    const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    if (origin === 'bare') git(root, 'remote', 'add', 'origin', remote)
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: root })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Release 1.0.0',
    })
    const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
    const sessions = yield* Sessions
    const sessionId = yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
    yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
    const access = { role: 'lead' as const, projectId: project.projectId, threadId: task.threadId, sessionId, taskId: task.taskId }
    return { access, worktree: worktree?.path ?? '', remote, root }
  })

/** The one card waiting on the person: its id and what it shows. */
const card = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* until(
    sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE state = 'open' AND kind = 'permission'`,
    (rows) => rows.length === 1,
  )
  return { id: row?.id ?? '', payload: JSON.parse(row?.payload ?? '{}') as { command?: string; held?: boolean } }
})

const answer = (attentionId: string, decision: 'allow' | 'reject') =>
  Effect.gen(function* () {
    const permissions = yield* Permissions
    yield* permissions.answer({ envelope: yield* Runtime.envelope('attention.answer', { attentionId, decision }), attentionId, decision })
  })

describe('push_tag', () => {
  it.live('pushes a tag the lead made once the person allows it, and never one they refused or the remote has', () =>
    Effect.gen(function* () {
      const { access, worktree, remote } = yield* leadWithRemote()

      // Only a tag that is there, by a name git takes.
      assert.include(yield* callTool(access, 'push_tag', { tag: 'v1.0.0' }), "There's no tag v1.0.0 here.")
      assert.include(yield* callTool(access, 'push_tag', { tag: '--mirror' }), "isn't a name git takes for a tag")
      assert.include(yield* callTool(access, 'push_tag', { tag: 'v1.0.0', repository: 'nowhere' }), 'Say which repository')

      writeFileSync(join(worktree, 'CHANGELOG.md'), '1.0.0\n')
      git(worktree, 'add', '.')
      git(worktree, 'commit', '-q', '-m', 'Release 1.0.0')
      const head = git(worktree, 'rev-parse', 'HEAD')
      git(worktree, 'tag', 'v1.0.0')

      // It waits for the person, held for them as a push of tags always is, and goes up once they allow it.
      const pushing = yield* Effect.forkChild(callTool(access, 'push_tag', { tag: 'v1.0.0' }))
      const asked = yield* card
      assert.deepInclude(asked.payload, { command: 'git push origin refs/tags/v1.0.0', held: true })
      assert.strictEqual(git(remote, 'tag', '--list'), '')
      yield* answer(asked.id, 'allow')
      assert.strictEqual(yield* Fiber.join(pushing), `Pushed v1.0.0, on ${head.slice(0, 8)}, to origin.`)
      assert.strictEqual(git(remote, 'rev-parse', 'v1.0.0^{commit}'), head)
      assert.include(
        (yield* notices(access.threadId)).map((notice) => notice.title),
        'Pushed tag v1.0.0 to origin.',
      )

      // Refused, nothing goes up.
      git(worktree, 'tag', 'v1.0.1')
      const refused = yield* Effect.forkChild(callTool(access, 'push_tag', { tag: 'refs/tags/v1.0.1' }))
      yield* answer((yield* card).id, 'reject')
      assert.include(yield* Fiber.join(refused), "v1.0.1 wasn't pushed")
      assert.strictEqual(git(remote, 'tag', '--list'), 'v1.0.0')

      // A tag the remote has on another commit stays as it is there.
      git(worktree, 'tag', '-f', 'v1.0.0', 'HEAD~1')
      const moving = yield* Effect.forkChild(callTool(access, 'push_tag', { tag: 'v1.0.0' }))
      yield* answer((yield* card).id, 'allow')
      assert.include(yield* Fiber.join(moving), 'origin has a tag v1.0.0 already')
      assert.strictEqual(git(remote, 'rev-parse', 'v1.0.0^{commit}'), head)

      // Its lead gone, there is no one to ask for: nothing is asked or pushed.
      git(worktree, 'tag', 'v1.0.2')
      yield* (yield* Sessions).stop(access.threadId)
      assert.include(yield* callTool(access, 'push_tag', { tag: 'v1.0.2' }), 'Only a running lead can push a tag.')
      assert.strictEqual(git(remote, 'tag', '--list'), 'v1.0.0')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('push_tag, where the tag doesn’t go up at once', () => {
  /** A tag on a new commit in the worktree, by its name. */
  const tagged = (worktree: string, tag: string) => {
    writeFileSync(join(worktree, 'CHANGELOG.md'), `${tag}\n`)
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', `Release ${tag}`)
    git(worktree, 'tag', tag)
  }

  /** Pushes the tag as the lead asks, the person allowing it: what the lead is told. */
  const allowed = (access: Parameters<typeof callTool>[0], tag: string) =>
    Effect.gen(function* () {
      const pushing = yield* Effect.forkChild(callTool(access, 'push_tag', { tag }))
      yield* answer((yield* card).id, 'allow')
      return yield* Fiber.join(pushing)
    })

  it.live('returns while the person hasn’t answered, and tells the lead once they have', () =>
    Effect.gen(function* () {
      const { access, worktree, remote } = yield* leadWithRemote()
      tagged(worktree, 'v3.0.0')
      const head = git(worktree, 'rev-parse', 'HEAD')
      // Unanswered for as long as an agent waits for a tool: the call says so, and nothing has gone up.
      assert.strictEqual(
        yield* callTool(access, 'push_tag', { tag: 'v3.0.0' }),
        "Asked the person to allow pushing v3.0.0 to origin. Nothing goes up until they do; you'll be told when it's pushed, or if it isn't.",
      )
      assert.strictEqual(git(remote, 'tag', '--list'), '')
      yield* answer((yield* card).id, 'allow')
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${access.threadId} AND body LIKE 'Pushed v3.0.0%'`,
        (rows) => rows.length === 1,
      )
      const [told] = yield* sql<{
        body: string
      }>`SELECT body FROM user_inputs WHERE thread_id = ${access.threadId} AND body LIKE 'Pushed v3.0.0%'`
      assert.strictEqual(told?.body, `Pushed v3.0.0, on ${head.slice(0, 8)}, to origin.`)
      assert.strictEqual(git(remote, 'rev-parse', 'v3.0.0^{commit}'), head)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says there is nowhere to push it in a repository with no remote, and asks nothing', () =>
    Effect.gen(function* () {
      const { access, worktree } = yield* leadWithRemote('none')
      tagged(worktree, 'v2.0.0')
      assert.match(yield* callTool(access, 'push_tag', { tag: 'v2.0.0' }), /^althar-repo-\w+ has no remote to push v2\.0\.0 to\.$/)
      const sql = yield* SqlClient.SqlClient
      assert.lengthOf(yield* sql`SELECT id FROM attention_requests WHERE kind = 'permission'`, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('tells the lead what the remote said where it refuses the tag, and what git said where the push failed otherwise', () =>
    Effect.gen(function* () {
      const { access, worktree, remote } = yield* leadWithRemote()
      // The remote turns tags down, as a protected one does.
      const hook = join(remote, 'hooks', 'pre-receive')
      writeFileSync(hook, '#!/bin/sh\necho "Tags are made by the release job" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
      tagged(worktree, 'v2.0.0')
      assert.strictEqual(yield* allowed(access, 'v2.0.0'), 'origin refused v2.0.0: pre-receive hook declined. Tell the person.')
      assert.strictEqual(git(remote, 'tag', '--list'), '')
      // The remote gone: git's own last word.
      rmSync(remote, { recursive: true, force: true })
      tagged(worktree, 'v2.0.1')
      assert.strictEqual(yield* allowed(access, 'v2.0.1'), 'Pushing v2.0.1 failed: and the repository exists.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says the remote didn’t take the person’s sign-in, where it asks for one git can’t give', () => {
    // A remote that wants a sign-in, as a host's does: git, never prompting, can't give one.
    const server = createServer((_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="tags"' })
      response.end()
    })
    return Effect.gen(function* () {
      yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)))
      const { port } = server.address() as AddressInfo
      const { access, worktree, root } = yield* leadWithRemote('none')
      git(root, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/meridian/api.git`)
      // No helper of the person's answers for it.
      git(root, 'config', 'credential.helper', '')
      tagged(worktree, 'v2.0.0')
      assert.strictEqual(
        yield* allowed(access, 'v2.0.0'),
        "origin didn't take the person's sign-in, so v2.0.0 wasn't pushed. Tell the person.",
      )
    }).pipe(Effect.ensuring(Effect.sync(() => server.close())), Effect.provide(runtime()))
  })
})
