import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { keepSent } from '../src/sentImages'
import { Sessions } from '../src/Sessions'
import { runtime, task, turns, until } from './support'

/*
 * A thread handed to another agent, or to a fresh session of its own, where
 * sessions.test.ts and handover.test.ts don't go: a task of several
 * repositories, a worktree with much left uncommitted, images sent with the
 * switch, and a lead's handover that Althar leaves be.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A folder holding a repository for each name. */
const folderOf = (...names: ReadonlyArray<string>) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
  for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path)
    git(path, 'init', '-q', '-b', 'main')
    writeFileSync(join(path, 'README.md'), `# ${name}\n`)
    git(path, 'add', '.')
    git(path, 'commit', '-q', '-m', 'Start')
  }
  return folder
}

/** The first turn of the thread's latest session: what its agent was told. */
const toldLast = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [told] = yield* until(
      sql<{ prompt: string | null }>`
        SELECT d.prompt FROM turn_deliveries d
        WHERE d.provider_session_id = (SELECT id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1)
        ORDER BY d.requested_at, d.rowid LIMIT 1`,
      (rows) => rows.length === 1 && rows[0]?.prompt != null,
    )
    return told?.prompt ?? ''
  })

const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId}`
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

const settled = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.length >= count && rows.every((row) => !['pending', 'delivered'].includes(row.state)))

describe('an agent taking a thread over', () => {
  it.live('in a task of several repositories, is told it carries on in the same worktrees', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sessions = yield* Sessions
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folderOf('api', 'web') })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Share the retry',
        repositories: ['api', 'web'],
      })
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* settled(created.threadId, 1)
      yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'claude-code' })
      assert.include(yield* toldLast(created.threadId), 'You are taking over a task from Fake codex, in the same worktrees.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is told what is left uncommitted, cut short where it runs long', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task('Many files')
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
      for (let n = 0; n < 150; n += 1)
        writeFileSync(join(worktree?.path ?? '', `a-rather-long-name-for-a-scratch-file-${String(n).padStart(3, '0')}.txt`), `${n}\n`)
      yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'codex' })
      const told = yield* toldLast(created.threadId)
      const uncommitted = told.slice(told.indexOf('Not yet committed:\n'))
      assert.match(uncommitted, /^Not yet committed:\n\?\? a-rather-long-name-for-a-scratch-file-000\.txt\n[\s\S]*\n…/)
      assert.notInclude(uncommitted, 'scratch-file-149.txt')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('gets the images the person sent with the switch, with their words, in its first turn', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { project, task: created } = yield* task('With a picture')
      const images = yield* keepSent(project.projectId as ProjectId, [{ data: SCREENSHOT_PNG, name: 'home.png' }])
      const body = 'Match this screen.'
      yield* sessions.switchAgent({
        threadId: created.threadId,
        agentId: 'codex',
        message: { envelope: yield* Runtime.envelope('thread.send', { body }), body, images },
      })
      const sql = yield* SqlClient.SqlClient
      const [sent] = yield* until(
        sql<{ n: number }>`
          SELECT count(*) AS n FROM user_input_images ii JOIN user_inputs u ON u.id = ii.user_input_id WHERE u.thread_id = ${created.threadId}`,
        (rows) => (rows[0]?.n ?? 0) === 1,
      )
      assert.strictEqual(sent?.n, 1)
      const [first] = yield* until(turns(created.threadId), (rows) => rows[0]?.prompt != null)
      assert.isTrue(first?.prompt?.endsWith(body))
    }).pipe(Effect.provide(runtime())),
  )
})

describe("a lead's context filling up", () => {
  it.live('leaves a lead whose brief would fill a fresh session as far to compact by itself', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Small window')
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* settled(created.threadId, 1)
      // Nearly full, of a window so small that no brief would fit in a fresh one.
      yield* say(created.threadId, 'Look around. [context:85/1000]')
      yield* settled(created.threadId, 2)
      yield* say(created.threadId, 'And again.')
      yield* settled(created.threadId, 3)
      assert.lengthOf(yield* sessionsOn(created.threadId), 1)
    }).pipe(Effect.provide(runtime())),
  )
})
