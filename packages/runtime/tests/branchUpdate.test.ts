import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChangeRequest } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { mergeTargetIn } from '../src/branchUpdate'

/*
 * Althar's own merge of a pull request's target into its branch, where the
 * host has no call for it: made in the project's repository here, pushed
 * plainly to its remote, a bare repository standing in for the host.
 */

const run = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'You',
      GIT_AUTHOR_EMAIL: 'you@meridian.dev',
      GIT_COMMITTER_NAME: 'You',
      GIT_COMMITTER_EMAIL: 'you@meridian.dev',
    },
  }).trim()

const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text)
  run(cwd, 'add', file)
  run(cwd, 'commit', '-q', '-m', `Change ${file}`)
  return run(cwd, 'rev-parse', 'HEAD')
}

/** A remote with main and a pull request's branch, `feature`, and the project's clone of it here; main moves on after. */
const repositories = (clash = false) => {
  const top = mkdtempSync(join(tmpdir(), 'althar-branch-update-'))
  const remote = join(top, 'remote.git')
  const here = join(top, 'here')
  const elsewhere = join(top, 'elsewhere')
  run(top, 'init', '-q', '--bare', '-b', 'main', remote)
  run(top, 'clone', '-q', remote, elsewhere)
  commit(elsewhere, 'README.md', 'Meridian\n')
  run(elsewhere, 'push', '-q', 'origin', 'HEAD:main')
  run(elsewhere, 'switch', '-q', '-c', 'feature')
  const head = commit(elsewhere, clash ? 'README.md' : 'retry.ts', 'export const retries = 3\n')
  run(elsewhere, 'push', '-q', 'origin', 'feature')
  run(elsewhere, 'switch', '-q', 'main')
  const tip = commit(elsewhere, clash ? 'README.md' : 'refunds.ts', 'export const refunds = true\n')
  run(elsewhere, 'push', '-q', 'origin', 'main')
  run(top, 'clone', '-q', remote, here)
  return { remote, here, head, tip, target: { url: remote, header: null } }
}

const change = (headSha: string, overrides: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: '7',
  number: 7,
  title: 'Retry refunds',
  body: '',
  url: 'https://gitlab.com/meridian/api/-/merge_requests/7',
  state: 'open',
  draft: false,
  source: 'feature',
  target: 'main',
  headSha,
  author: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  updatedAt: '2026-11-03T00:00:00.000Z',
  headRepository: null,
  ...overrides,
})

describe('Althar’s own merge of the target into a pull request’s branch', () => {
  it.effect('merges the target in at the head read, pushes it plainly, and leaves nothing behind here', () =>
    Effect.gen(function* () {
      const { remote, here, head, tip, target } = repositories()
      const done = yield* mergeTargetIn(here, target, change(head))
      assert.strictEqual(done.kind, 'pushed')
      const made = done.kind === 'pushed' ? done.head : ''
      assert.strictEqual(run(remote, 'rev-parse', 'refs/heads/feature'), made)
      assert.strictEqual(run(remote, 'rev-parse', `${made}^1`), head)
      assert.strictEqual(run(remote, 'rev-parse', `${made}^2`), tip)
      assert.strictEqual(run(here, 'for-each-ref', 'refs/althar'), '')
      // Up to date now, it is left as it is; at a head it no longer has, nothing is pushed.
      assert.strictEqual((yield* mergeTargetIn(here, target, change(made))).kind, 'current')
      assert.strictEqual((yield* mergeTargetIn(here, target, change(head))).kind, 'moved')
      assert.strictEqual(run(remote, 'rev-parse', 'refs/heads/feature'), made)
    }),
  )

  it.effect('says which files conflict, and pushes nothing', () =>
    Effect.gen(function* () {
      const { remote, here, head, target } = repositories(true)
      assert.deepStrictEqual(yield* mergeTargetIn(here, target, change(head)), { kind: 'conflicts', files: ['README.md'] })
      assert.strictEqual(run(remote, 'rev-parse', 'refs/heads/feature'), head)
    }),
  )

  it.effect('a push the host refuses is said with its reason, not read as the branch having moved', () =>
    Effect.gen(function* () {
      const { remote, here, head, target } = repositories()
      const hook = join(remote, 'hooks', 'pre-receive')
      writeFileSync(hook, '#!/bin/sh\necho "feature is protected: merges only" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
      const done = yield* mergeTargetIn(here, target, change(head))
      assert.strictEqual(done.kind, 'cannot')
      assert.match(done.kind === 'cannot' ? done.reason : '', /^the host refused the push: feature is protected/)
      assert.notStrictEqual(done.kind === 'cannot' ? done.passing : undefined, true)
      assert.strictEqual(run(remote, 'rev-parse', 'refs/heads/feature'), head)
    }),
  )

  it.effect('never touches a fork’s branch, or one it can’t fetch', () =>
    Effect.gen(function* () {
      const { here, head, target } = repositories()
      assert.deepStrictEqual(yield* mergeTargetIn(here, target, change(head, { headRepository: ['someone', 'api'] })), {
        kind: 'cannot',
        reason: 'its branch is on a fork',
      })
      assert.strictEqual((yield* mergeTargetIn(here, { url: join(here, 'nowhere.git'), header: null }, change(head))).kind, 'cannot')
    }),
  )
})
