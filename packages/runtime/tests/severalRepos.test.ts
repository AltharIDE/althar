import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { type TaskEnd } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, until } from './support'

/*
 * A task of several repositories through its steps, where repositories.test.ts
 * doesn't go: a lead that leaves work uncommitted in more than one, and a
 * round of work after the plan that changes one of them, reviewed by what
 * changed in each.
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

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

/** A task changing both repositories, planned as given and started at once: its ids, and each worktree by repository. */
const across = (description: string, review: boolean, end: TaskEnd | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const plans = yield* Plans
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folderOf('api', 'web') })
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: opened.projectId,
      title: 'Share the retry',
      description,
      draft: true,
      repositories: ['api', 'web'],
    })
    const planId = yield* plans.propose({
      projectId: opened.projectId as ProjectId,
      taskId: created.taskId,
      steps: [
        { key: 'implement', agentId: 'codex', model: null, skipped: false },
        ...(review ? [{ key: 'review' as const, agentId: 'claude-code', model: null, skipped: false }] : []),
      ],
      reason: null,
      actorId: actor,
      end,
    })
    yield* plans.start(planId, actor)
    const rows = yield* sql<{ name: string; path: string }>`
      SELECT b.display_name AS name, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${created.taskId}`
    return {
      projectId: opened.projectId,
      ...created,
      worktree: Object.fromEntries(rows.map((row) => [row.name, row.path])) as Readonly<Record<string, string>>,
    }
  })

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

describe('a task of several repositories', () => {
  it.live('asks its lead to commit what it left uncommitted, naming each file by its repository', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* across('Work on it. [lead:wait]', false, 'draft')
      const [lead] = yield* until(
        sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} AND state = 'active'`,
        (rows) => rows.length === 1,
      )
      writeFileSync(join(task.worktree.api ?? '', 'retry.ts'), 'export const retry = 3\n')
      writeFileSync(join(task.worktree.web ?? '', 'retry.tsx'), 'export const Retry = () => null\n')
      const access: ToolAccess = {
        role: 'lead',
        projectId: task.projectId,
        threadId: task.threadId,
        sessionId: lead?.id ?? '',
        taskId: task.taskId,
      }
      assert.strictEqual(
        yield* callTool(access, 'finish_step', { summary: 'Shared the retry.', built: 'A shared retry.' }),
        "These aren't committed: `api/retry.ts`, `web/retry.tsx`. Althar pushes commits only, so commit what belongs to the task, delete the rest (scratch files, logs), and call finish_step again.",
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('reviews a round of work after its plan by what changed in each repository since', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const task = yield* across('Do it. [lead:finish] [review:pass]', true, null)
      yield* until(runsOf(task.taskId), (rows) => rows[0]?.state === 'succeeded', Duration.seconds(30))
      const heads = Object.fromEntries(
        Object.entries(task.worktree).map(([name, path]) => [name, git(path, 'rev-parse', 'HEAD').toString().trim().slice(0, 12)]),
      )
      // The person asks for more; while its lead works on it, it changes the web app only.
      const body = 'Add the docs. [lead:slowly] [lead:finish]'
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: task.threadId, body })
      yield* until(runsOf(task.taskId), (rows) => rows[1]?.state === 'running')
      writeFileSync(join(task.worktree.web ?? '', 'docs.md'), '# Retry\n')
      const [told] = yield* until(
        sql<{ body: string }>`
          SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
          WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND i.body LIKE 'More to review%'`,
        (rows) => rows.length === 1,
        Duration.seconds(30),
      )
      assert.include(told?.body, `Review what changed since, \n- api: \`git diff ${heads.api}\`\n- web: \`git diff ${heads.web}\`.`)
    }).pipe(Effect.provide(withQueries())),
  )
})
