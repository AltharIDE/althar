import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { changedFiles, fileDiff } from '../src/diffs'
import { NotFound } from '../src/errors'
import { evidenceForReview } from '../src/evidence'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, runtime, task } from './support'

/*
 * What is read of a task's worktree for others, at turns the neighbouring
 * tests don't take: a repository nested in it, which git wouldn't add as a
 * file, and a log the lead handed without the command that printed it.
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
