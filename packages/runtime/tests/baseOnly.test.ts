import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { onlyBase, ownCommits } from '../src/baseOnly'

/*
 * Commits that only bring a task's base branch in are none of its work
 * (baseOnly.ts): a merge of main that settled no conflict, whatever it
 * brought, measured by the task's change against its base. A merge that
 * settled a conflict, or a commit of the task's own, is its work.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })
    .toString()
    .trim()

const lines = (count: number, at?: { readonly line: number; readonly text: string }) =>
  `${Array.from({ length: count }, (_, index) => (at?.line === index + 1 ? at.text : `line ${index + 1}`)).join('\n')}\n`

/** Writes a file and commits it. */
const commit = (cwd: string, file: string, text: string, message: string) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

/** A repository whose main has a file of 40 lines, and a task's branch off it that changes its third line: what its pull request has. */
const repository = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'althar-base-only-'))
  git(cwd, 'init', '-q', '-b', 'main')
  commit(cwd, 'retry.ts', lines(40), 'Start')
  git(cwd, 'switch', '-q', '-c', 'task')
  const opened = commit(cwd, 'retry.ts', lines(40, { line: 3, text: 'retry twice' }), 'Retry twice')
  return { cwd, opened }
}

/** Main moves on while the task's pull request waits: other work, elsewhere, as merged pull requests bring it. */
const mainMovesOn = (cwd: string, also?: { readonly line: number; readonly text: string }) => {
  git(cwd, 'switch', '-q', 'main')
  commit(cwd, 'usage.ts', 'usage\n', 'Usage card (#763)')
  commit(cwd, 'retry.ts', lines(40, { line: 30, text: 'log it' }), 'Log retries (#767)')
  if (also !== undefined)
    commit(cwd, 'retry.ts', readFileSync(join(cwd, 'retry.ts'), 'utf8').replace('line 3\n', `${also.text}\n`), 'Clash')
  git(cwd, 'switch', '-q', 'task')
}

/** Merges main into the task's branch; where it conflicts, keeps both sides, as a lead settling it would. */
const mergeMain = (cwd: string) => {
  try {
    git(cwd, 'merge', '-q', '--no-edit', 'main')
  } catch {
    const text = readFileSync(join(cwd, 'retry.ts'), 'utf8')
    writeFileSync(join(cwd, 'retry.ts'), text.replace(/^(<<<<<<<|=======|>>>>>>>).*\n/gm, ''))
    git(cwd, 'add', '-A')
    git(cwd, 'commit', '-q', '--no-edit')
  }
  return git(cwd, 'rev-parse', 'HEAD')
}

describe('commits that only bring the base branch in', () => {
  it.effect('a merge of main that settled no conflict is none of the task’s work, though it brings several commits', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      mainMovesOn(cwd)
      const merged = mergeMain(cwd)
      assert.strictEqual(git(cwd, 'rev-list', '--count', `${opened}..${merged}`), '3')
      assert.isTrue(yield* onlyBase(cwd, opened, merged, ['main']))
      assert.deepStrictEqual(yield* ownCommits(cwd, opened, merged, ['main']), [])
    }),
  )

  it.effect('a merge that settled a conflict is the task’s work: the merge is its own commit', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      mainMovesOn(cwd, { line: 3, text: 'retry once' })
      const merged = mergeMain(cwd)
      assert.isFalse(yield* onlyBase(cwd, opened, merged, ['main']))
      assert.deepStrictEqual(yield* ownCommits(cwd, opened, merged, ['main']), [merged])
    }),
  )

  it.effect('a commit of the task’s own after a merge of main is its work, and only it', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      mainMovesOn(cwd)
      mergeMain(cwd)
      const tweak = commit(cwd, 'retry.ts', lines(40, { line: 3, text: 'retry three times' }).replace('line 30\n', 'log it\n'), 'Thrice')
      assert.isFalse(yield* onlyBase(cwd, opened, tweak, ['main']))
      assert.deepStrictEqual(yield* ownCommits(cwd, opened, tweak, ['main']), [tweak])
    }),
  )

  it.effect('a commit of the task’s own with no merge is its work, as before', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      const tweak = commit(cwd, 'notes.md', 'twice\n', 'Notes')
      assert.isFalse(yield* onlyBase(cwd, opened, tweak, ['main']))
      assert.deepStrictEqual(yield* ownCommits(cwd, opened, tweak, ['main']), [tweak])
    }),
  )

  it.effect('with no ref of the base git knows, nothing says it is the base’s: it is the task’s work', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      mainMovesOn(cwd)
      const merged = mergeMain(cwd)
      assert.isFalse(yield* onlyBase(cwd, opened, merged, ['refs/heads/gone', 'origin/nowhere']))
      assert.isFalse(yield* onlyBase(cwd, opened, merged, []))
    }),
  )

  it.effect('reads the freshest of the base’s refs: one behind what was merged doesn’t make the merge the task’s', () =>
    Effect.gen(function* () {
      const { cwd, opened } = repository()
      const before = git(cwd, 'rev-parse', 'main')
      mainMovesOn(cwd)
      git(cwd, 'branch', 'stale', before)
      const merged = mergeMain(cwd)
      assert.isTrue(yield* onlyBase(cwd, opened, merged, ['stale', 'main']))
    }),
  )
})
