import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
const leadWithRemote = () =>
  Effect.gen(function* () {
    const root = repository()
    const remote = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(root, 'remote', 'add', 'origin', remote)
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
    return { access, worktree: worktree?.path ?? '', remote }
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
