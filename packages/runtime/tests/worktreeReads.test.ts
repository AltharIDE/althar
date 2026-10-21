import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { changedFiles, fileDiff } from '../src/diffs'
import { NotFound } from '../src/errors'
import { evidenceForReview } from '../src/evidence'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, task } from './support'

/*
 * What is read of a task's worktree for others, at turns the neighbouring
 * tests don't take: a repository nested in it, which git wouldn't add as a
 * file; a log the lead handed without the command that printed it; and a
 * screenshot from the worktree of a task's second repository.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

describe('the files a task changed', () => {
  it.effect('leave out a repository nested in the worktree, as git wouldn’t add it as a file', () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), 'althar-diffs-'))
      git(root, 'init', '-q', '-b', 'main')
      writeFileSync(join(root, 'README.md'), '# Meridian\n')
      git(root, 'add', '.')
      git(root, 'commit', '-q', '-m', 'Start')
      const base = git(root, 'rev-parse', 'HEAD')
      writeFileSync(join(root, 'retry.ts'), 'export const retry = 3\n')
      const nested = join(root, 'vendor', 'lib')
      mkdirSync(nested, { recursive: true })
      git(nested, 'init', '-q', '-b', 'main')
      writeFileSync(join(nested, 'lib.ts'), 'export const lib = 1\n')
      git(nested, 'add', '.')
      git(nested, 'commit', '-q', '-m', 'Start')
      assert.deepStrictEqual(
        (yield* changedFiles(root, base)).map((file) => file.path),
        ['retry.ts'],
      )
      assert.instanceOf(yield* Effect.flip(fileDiff(root, base, 'vendor/lib/')), NotFound)
    }),
  )
})

describe('the evidence a reviewer reads', () => {
  it.live('writes out a log handed without its command as it is, with nothing said to have run', () =>
    Effect.gen(function* () {
      const { project, task: made } = yield* task('Show a retry')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: made.threadId,
        sessionId: 'none',
        taskId: made.taskId,
      }
      assert.strictEqual(
        yield* callTool(lead, 'finish_step', {
          built: 'A retry.',
          summary: 'Did it.',
          evidence: [{ kind: 'log', caption: 'Console', text: 'Retried twice, then sent.' }],
        }),
        'Althar has your summary.',
      )
      const folder = join(mkdtempSync(join(tmpdir(), 'althar-review-evidence-')), 'evidence')
      assert.strictEqual(
        yield* evidenceForReview(made.threadId, folder),
        [
          "The lead's evidence, each picture and output where you can read it:",
          `- log: Console: ${join(folder, '1-log.txt')}`,
          '',
          "It lists nothing it couldn't show.",
        ].join('\n'),
      )
      assert.strictEqual(readFileSync(join(folder, '1-log.txt'), 'utf8'), 'Retried twice, then sent.')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a screenshot a lead hands in a task of two repositories', () => {
  it.live('is kept as the second worktree’s, where it was saved', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'althar-folder-')))
      for (const name of ['api', 'web']) {
        mkdirSync(join(folder, name))
        git(join(folder, name), 'init', '-q', '-b', 'main')
        writeFileSync(join(folder, name, 'README.md'), `# ${name}\n`)
        git(join(folder, name), 'add', '.')
        git(join(folder, name), 'commit', '-q', '-m', 'Start')
      }
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: folder })
      const made = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Share the retry',
        repositories: ['api', 'web'],
      })
      const worktrees = yield* sql<{ name: string; path: string }>`
        SELECT b.display_name AS name, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.task_id = ${made.taskId}`
      const web = worktrees.find((one) => one.name === 'web')?.path ?? ''
      writeFileSync(join(web, 'after.png'), Buffer.from(SCREENSHOT_PNG, 'base64'))
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: made.threadId,
        sessionId: 'none',
        taskId: made.taskId,
      }
      assert.strictEqual(
        yield* callTool(lead, 'finish_step', {
          built: 'A retry in both.',
          summary: 'Did it.',
          evidence: [{ kind: 'screenshot', caption: 'The web page, after', path: join(web, 'after.png') }],
        }),
        'Althar has your summary.',
      )
      const [item] = yield* sql<{ content: string }>`
        SELECT content FROM thread_items WHERE thread_id = ${made.threadId} AND kind = 'step_result' ORDER BY sequence DESC LIMIT 1`
      const [shot] = (JSON.parse(item?.content ?? '{}') as { evidence?: ReadonlyArray<Record<string, unknown>> }).evidence ?? []
      assert.deepInclude(shot, { kind: 'screenshot', worktree: web, path: 'after.png' })
    }).pipe(Effect.provide(runtime())),
  )
})
