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
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * What a lead's finish_step is told back about the descriptions it gives a
 * task that ends in a pull request, where severalRepos.test.ts and
 * changes.test.ts don't go: one that names no repository in a task of
 * several, and one with nothing in it; and a summary with nothing in it,
 * which its reviewer isn't told.
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

/**
 * A task in these of the project's repositories, ending in a draft pull
 * request, whose lead works until it is stopped; once its step runs, a
 * commit in each of its worktrees, as its lead would have made, and the
 * lead's access to Althar's tools.
 */
const working = (projectId: string, repositories: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'Share the retry',
      description: 'Work on it. [lead:wait]',
      draft: true,
      repositories,
    })
    const planId = yield* plans.propose({
      projectId: projectId as ProjectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: 'draft',
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    const [session] = yield* until(
      sql<{ id: string }>`
        SELECT s.id FROM provider_sessions s JOIN node_attempts a ON a.provider_session_id = s.id
        WHERE s.thread_id = ${created.threadId} AND a.state = 'running'`,
      (rows) => rows.length === 1,
    )
    const worktrees = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${created.taskId}`
    for (const worktree of worktrees) {
      writeFileSync(join(worktree.path, 'retry.ts'), 'export const retry = 1\n')
      git(worktree.path, 'add', 'retry.ts')
      git(worktree.path, 'commit', '-q', '-m', 'Retry once')
    }
    const access: ToolAccess = { role: 'lead', projectId, threadId: created.threadId, sessionId: session?.id ?? '', taskId: created.taskId }
    return { ...created, access }
  })

describe('the descriptions a lead gives as it finishes a task that ends in a pull request', () => {
  it.live('are refused where one names no repository in a task of several, and asked for again where one says nothing', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folderOf('api', 'web') })
      const both = yield* working(opened.projectId, ['api', 'web'])
      assert.strictEqual(
        yield* callTool(both.access, 'finish_step', {
          summary: 'Shared the retry.',
          built: 'Both retry once.',
          descriptions: [{ text: 'Both retry once.' }],
        }),
        'Say which repository each description is for: api, web.',
      )

      // In a task of one repository, a description needn't name it; one with nothing in it is no description.
      const one = yield* working(opened.projectId, ['api'])
      const asked = yield* callTool(one.access, 'finish_step', {
        summary: 'Shared the retry.',
        built: 'The API retries once.',
        descriptions: [{ text: '   ' }],
      })
      assert.match(asked, /^Write the description of the task's pull request/)
      const sql = yield* SqlClient.SqlClient
      const [step] = yield* sql<{ state: string }>`
        SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
        JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${one.taskId}`
      assert.strictEqual(step?.state, 'running')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a lead that finishes with nothing in its summary', () => {
  it.live('has its review start all the same, its reviewer told nothing of what the lead says', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: opened.projectId,
        title: 'Retry the checkout',
        description: 'Work on it. [lead:wait]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: opened.projectId as ProjectId,
        taskId: created.taskId,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: false },
        ],
        reason: null,
        actorId: instance.personId,
        end: null,
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      const [session] = yield* until(
        sql<{ id: string }>`
          SELECT s.id FROM provider_sessions s JOIN node_attempts a ON a.provider_session_id = s.id
          WHERE s.thread_id = ${created.threadId} AND a.state = 'running'`,
        (rows) => rows.length === 1,
      )
      const access: ToolAccess = {
        role: 'lead',
        projectId: opened.projectId,
        threadId: created.threadId,
        sessionId: session?.id ?? '',
        taskId: created.taskId,
      }
      assert.strictEqual(
        yield* callTool(access, 'finish_step', { summary: '', built: 'Checkout retries once.' }),
        'Althar has your summary. A review starts now; wait for its findings.',
      )
      const [briefed] = yield* until(
        sql<{ prompt: string }>`
          SELECT d.prompt FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
          WHERE t.task_id = ${created.taskId} AND t.kind = 'step' ORDER BY d.requested_at LIMIT 1`,
        (rows) => rows.length === 1,
      )
      assert.include(briefed?.prompt, "You are reviewing another agent's change")
      assert.notInclude(briefed?.prompt, 'The lead says:')
    }).pipe(Effect.provide(runtime())),
  )
})
