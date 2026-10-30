import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { repository, runtime, task, turns, until } from './support'

/*
 * A task whose worktree Althar doesn't know the commit of where it started,
 * as one kept before it recorded that: its lead's brief says the branch it
 * started from, with no commit and nothing changed since; its reviewer sees
 * the change against the commit before its head.
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

/** Forgets the commit each of the task's worktrees started from. */
const forget = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [before] = yield* sql<{ baseCommit: string; baseRef: string }>`
      SELECT base_commit, base_ref FROM workspaces WHERE task_id = ${taskId} ORDER BY rowid`
    yield* sql`UPDATE workspaces SET base_commit = NULL WHERE task_id = ${taskId}`
    return before ?? assert.fail('no worktree')
  })

describe('a task whose worktree’s starting commit isn’t known', () => {
  it.live('has its lead briefed with the branch it started from alone', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const { baseCommit, baseRef } = yield* forget(created.taskId)
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      const [first] = yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      assert.include(first?.prompt, `which started from ${baseRef}.`)
      assert.notInclude(first?.prompt, baseCommit.slice(0, 12))
      assert.notInclude(first?.prompt, 'Changed since the start:')
    }).pipe(Effect.provide(runtime())),
  )

  for (const several of [false, true])
    it.live(
      `has its reviewer see the change against the commit before its head, in ${several ? 'each repository' : 'its repository'}`,
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const projects = yield* Projects
          const plans = yield* Plans
          const instance = yield* Instance
          const project = yield* projects.open({
            envelope: yield* Runtime.envelope('project.open', {}),
            path: several ? folderOf('api', 'web') : repository(),
          })
          const created = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title: 'Retry the checkout',
            description: 'Do it. [lead:finish] [review:pass]',
            draft: true,
            ...(several ? { repositories: ['api', 'web'] } : {}),
          })
          yield* forget(created.taskId)
          const planId = yield* plans.propose({
            projectId: project.projectId as ProjectId,
            taskId: created.taskId,
            steps: [
              { key: 'implement', agentId: 'codex', model: null, skipped: false },
              { key: 'review', agentId: 'claude-code', model: null, skipped: false },
            ],
            reason: null,
            actorId: instance.personId,
            end: null,
            held: true,
          })
          yield* plans.start(planId, instance.personId)
          const [briefed] = yield* until(
            sql<{ prompt: string }>`
            SELECT d.prompt FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
            WHERE t.task_id = ${created.taskId} AND t.kind = 'step' ORDER BY d.requested_at LIMIT 1`,
            (rows) => rows.length === 1,
          )
          if (several) assert.match(briefed?.prompt ?? '', /\n- api: .+, `git diff HEAD~1`/)
          else assert.include(briefed?.prompt, 'See the change with `git diff HEAD~1` there')
        }).pipe(Effect.provide(runtime())),
    )
})
