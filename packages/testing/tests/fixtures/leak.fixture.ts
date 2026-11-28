// Run by tests/gitIsolation.test.ts, with its working folder and temporary folder inside a task's worktree: what a
// test of Althar's does when the repository it made for itself isn't one (its `git init` failed).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { identify, isolateGit, setConfig } from '../../src/git.ts'

isolateGit()

// Given a folder, the root of a task's worktree, the helper is called there: it shares the main repository's config.
const given = process.argv[2]
const folder = given ?? mkdtempSync(join(tmpdir(), 'althar-repo-'))
if (given === undefined) mkdirSync(join(folder, 'nested'))
const outcome: Record<string, string> = {}
const tried = (name: string, run: () => void) => {
  try {
    run()
    outcome[name] = 'wrote'
  } catch (error) {
    outcome[name] = error instanceof Error ? (error.message.split('\n')[0] ?? 'failed') : 'failed'
  }
}

tried('identify', () => identify(folder, 'T', 't@t.test'))
tried('setConfig', () => setConfig(given ?? join(folder, 'nested'), 'user.name', 'T'))
// The test's own git, as it ran before there was a helper: with the ceiling set, it finds no repository to write to.
if (given === undefined) tried('plain', () => execFileSync('git', ['config', 'user.name', 'T'], { cwd: folder, stdio: 'ignore' }))
process.stdout.write(`${JSON.stringify(outcome)}\n`)
