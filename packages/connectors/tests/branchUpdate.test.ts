import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, afterAll, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { mergeInCopy } from '../src/branchCopy'
import { updateInCopy } from '../src/branchUpdate'
import { type BranchUpdate, type ChangeRequest, type Product, type Repository } from '../src/model'
import { makeFakeService } from '../src/testing'

/*
 * Bringing a branch up to date (ADR-081), on every host's fake: the same
 * clauses, whichever host it stands in for. Then the merge in a copy, which
 * GitLab and both Bitbucket editions use, run by real git on local
 * repositories: a merge commit that keeps the branch's own commits, a conflict
 * that names its files and pushes nothing, a branch that moved, a push the
 * remote refuses, and a fork.
 */

const PRODUCTS: ReadonlyArray<Product> = ['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc']

const opened = (product: Product) =>
  Effect.gen(function* () {
    const service = makeFakeService({ product })
    const repository = service.addRepository(['meridian', 'api'])
    const change = yield* service.openChange(repository, {
      title: 'Rate-limit refunds',
      body: '',
      source: 'althar/refunds',
      target: repository.defaultBranch,
      draft: false,
    })
    return { service, repository, change }
  })

const head = (service: ReturnType<typeof makeFakeService>, repository: Repository, number: number) =>
  Effect.map(service.change(repository, number), (read) => read.headSha ?? '')

for (const product of PRODUCTS) {
  describe(`${product}: bringing a branch up to date`, () => {
    it.effect('merges the target in, once, and says it has everything after', () =>
      Effect.gen(function* () {
        const { service, repository, change } = yield* opened(product)
        const before = yield* head(service, repository, change.number)
        assert.deepStrictEqual(yield* service.updateBranch(repository, change, { expectedHead: before }), { outcome: 'current' })
        service.fallBehind(change.number)
        const updated = yield* service.updateBranch(repository, change, { expectedHead: before })
        assert.strictEqual(updated.outcome, 'updated')
        // GitHub merges in the background and doesn't say the commit; the others pushed it, and do.
        if (product !== 'github') assert.isString(updated.outcome === 'updated' ? updated.head : null)
        assert.lengthOf(service.branchesUpdated, 1)
        const after = yield* head(service, repository, change.number)
        assert.notStrictEqual(after, before)
        assert.deepStrictEqual(
          yield* service.updateBranch(repository, yield* service.change(repository, change.number), { expectedHead: after }),
          {
            outcome: 'current',
          },
        )
        assert.lengthOf(service.branchesUpdated, 1)
      }),
    )

    it.effect('stops at a conflict, names the files, and changes nothing', () =>
      Effect.gen(function* () {
        const { service, repository, change } = yield* opened(product)
        const before = yield* head(service, repository, change.number)
        service.fallBehind(change.number, ['src/refunds.ts', 'package.json'])
        assert.deepStrictEqual(yield* service.updateBranch(repository, change, { expectedHead: before }), {
          outcome: 'conflict',
          files: ['src/refunds.ts', 'package.json'],
        })
        assert.lengthOf(service.branchesUpdated, 0)
        assert.strictEqual(yield* head(service, repository, change.number), before)
      }),
    )

    it.effect('leaves a branch that was pushed to since it was read, and says where it is now', () =>
      Effect.gen(function* () {
        const { service, repository, change } = yield* opened(product)
        const read = yield* head(service, repository, change.number)
        service.fallBehind(change.number)
        service.pushByHand(change.number)
        const now = yield* head(service, repository, change.number)
        assert.deepStrictEqual(yield* service.updateBranch(repository, change, { expectedHead: read }), { outcome: 'moved', head: now })
        assert.lengthOf(service.branchesUpdated, 0)
        // Read again, it goes.
        assert.strictEqual((yield* service.updateBranch(repository, change, { expectedHead: now })).outcome, 'updated')
      }),
    )

    it.effect('updates an outside author’s branch where the account may push to it, and says so where it may not', () =>
      Effect.gen(function* () {
        const { service, repository } = yield* opened(product)
        const theirs = service.addPullRequest({
          path: repository.path,
          title: 'Fix typo',
          author: 'stranger',
          member: false,
          fork: ['stranger', 'api'],
        })
        service.fallBehind(theirs.number)
        const read = yield* head(service, repository, theirs.number)
        const refused = yield* service.updateBranch(repository, theirs, { expectedHead: read })
        assert.strictEqual(refused.outcome, 'no_access')
        assert.lengthOf(service.branchesUpdated, 0)
        // Their fork allows it: the same call now goes.
        service.allowForkPush(theirs.number)
        assert.strictEqual((yield* service.updateBranch(repository, theirs, { expectedHead: read })).outcome, 'updated')
        assert.deepStrictEqual(
          service.branchesUpdated.map((one) => one.number),
          [theirs.number],
        )
      }),
    )

    it.effect('doesn’t touch the branch of a change that is merged or closed', () =>
      Effect.gen(function* () {
        const { service, repository, change } = yield* opened(product)
        const read = yield* head(service, repository, change.number)
        service.fallBehind(change.number)
        service.close(change.number)
        const failed = yield* Effect.flip(service.updateBranch(repository, change, { expectedHead: read }))
        assert.strictEqual(failed.reason, 'rejected')
        assert.include(failed.message, 'closed')
        assert.lengthOf(service.branchesUpdated, 0)
      }),
    )
  })
}

// ---- The merge in a copy, by real git ---------------------------------------

const roots: Array<string> = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const run = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Dev',
      GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Dev',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
    },
  }).trim()

/** A bare repository with a `main`, and a `refunds` branch of its own, behind main by one commit. */
const hosting = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-update-test-'))
  roots.push(root)
  const bare = join(root, 'origin.git')
  const work = join(root, 'work')
  mkdirSync(work)
  run(root, 'init', '--quiet', '--bare', '--initial-branch=main', bare)
  run(work, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(work, 'limiter.ts'), 'export const limit = 1\n')
  writeFileSync(join(work, 'README.md'), 'readme\n')
  run(work, 'add', '.')
  run(work, 'commit', '--quiet', '-m', 'first')
  run(work, 'switch', '--quiet', '-c', 'refunds')
  writeFileSync(join(work, 'refunds.ts'), 'export const refund = 1\n')
  run(work, 'add', '.')
  run(work, 'commit', '--quiet', '-m', 'refunds')
  run(work, 'switch', '--quiet', 'main')
  writeFileSync(join(work, 'README.md'), 'readme, newer\n')
  run(work, 'commit', '--quiet', '-am', 'main moves on')
  run(work, 'push', '--quiet', bare, 'main', 'refunds')
  const tip = (branch: string, at = bare) => run(at, 'rev-parse', `refs/heads/${branch}`)
  return { root, bare, work, tip }
}

const target = (url: string) => ({ url, header: null })

describe('The merge in a copy', () => {
  it.effect('merges the target into the branch as a merge commit, keeps the branch’s own commits, and pushes it plainly', () =>
    Effect.gen(function* () {
      const { bare, tip } = hosting()
      const before = tip('refunds')
      const main = tip('main')
      const merged = yield* mergeInCopy({
        into: { target: target(bare), branch: 'refunds', head: before },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.strictEqual(merged.outcome, 'updated')
      const after = tip('refunds')
      assert.deepStrictEqual(merged, { outcome: 'updated', head: after })
      // A merge of the two, not a rebase: the branch's old head and the target's are both its parents, and main stays where it was.
      assert.deepStrictEqual(run(bare, 'rev-list', '--parents', '-n', '1', after).split(' ').slice(1).sort(), [before, main].sort())
      assert.strictEqual(tip('main'), main)
      assert.strictEqual(run(bare, 'show', `${after}:README.md`), 'readme, newer')
      assert.strictEqual(run(bare, 'show', `${after}:refunds.ts`), 'export const refund = 1')
      // Asked again with the head it has now, there is nothing to merge.
      assert.deepStrictEqual(
        yield* mergeInCopy({
          into: { target: target(bare), branch: 'refunds', head: after },
          from: { target: target(bare), branch: 'main' },
          push: true,
        }),
        { outcome: 'current' },
      )
    }),
  )

  it.effect('names the files that conflict, settles none, and pushes nothing', () =>
    Effect.gen(function* () {
      const { bare, work, tip } = hosting()
      run(work, 'switch', '--quiet', 'refunds')
      writeFileSync(join(work, 'README.md'), 'readme, refunds\n')
      writeFileSync(join(work, 'limiter.ts'), 'export const limit = 2\n')
      run(work, 'commit', '--quiet', '-am', 'edit the readme')
      run(work, 'switch', '--quiet', 'main')
      writeFileSync(join(work, 'limiter.ts'), 'export const limit = 3\n')
      run(work, 'commit', '--quiet', '-am', 'limit three')
      run(work, 'push', '--quiet', bare, 'main', 'refunds')
      const before = tip('refunds')
      const merged = yield* mergeInCopy({
        into: { target: target(bare), branch: 'refunds', head: before },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.deepStrictEqual(merged, { outcome: 'conflict', files: ['README.md', 'limiter.ts'] })
      assert.strictEqual(tip('refunds'), before)
    }),
  )

  it.effect('leaves a branch that is not at the head it was read at, and pushes nothing', () =>
    Effect.gen(function* () {
      const { bare, work, tip } = hosting()
      const read = tip('refunds')
      run(work, 'switch', '--quiet', 'refunds')
      writeFileSync(join(work, 'more.ts'), 'x\n')
      run(work, 'add', '.')
      run(work, 'commit', '--quiet', '-m', 'someone pushes')
      run(work, 'push', '--quiet', bare, 'refunds')
      const now = tip('refunds')
      const merged = yield* mergeInCopy({
        into: { target: target(bare), branch: 'refunds', head: read },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.deepStrictEqual(merged, { outcome: 'moved', head: now })
      assert.strictEqual(tip('refunds'), now)
    }),
  )

  it.effect('without push, finds the result and leaves the remote as it is', () =>
    Effect.gen(function* () {
      const { bare, tip } = hosting()
      const before = tip('refunds')
      const merged = yield* mergeInCopy({
        into: { target: target(bare), branch: 'refunds', head: before },
        from: { target: target(bare), branch: 'main' },
        push: false,
      })
      assert.strictEqual(merged.outcome, 'updated')
      assert.strictEqual(tip('refunds'), before)
    }),
  )

  it.effect('says in git’s words when the remote refuses the push, and leaves the branch', () =>
    Effect.gen(function* () {
      const { bare, tip } = hosting()
      // A protected branch, or a fork that doesn't allow it, refuses in a hook as a server would.
      const hook = join(bare, 'hooks', 'pre-receive')
      writeFileSync(hook, '#!/bin/sh\necho "remote: protected branch refunds" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
      const before = tip('refunds')
      const merged = yield* mergeInCopy({
        into: { target: target(bare), branch: 'refunds', head: before },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.strictEqual(merged.outcome, 'refused')
      assert.include(merged.outcome === 'refused' ? merged.message : '', 'protected branch')
      assert.strictEqual(tip('refunds'), before)
    }),
  )

  it.effect('brings a fork’s branch up to date from the repository it goes into, and touches only the fork', () =>
    Effect.gen(function* () {
      const { root, bare, tip } = hosting()
      const fork = join(root, 'fork.git')
      run(root, 'clone', '--quiet', '--bare', bare, fork)
      // Main moves again upstream, after the fork was made.
      const work = join(root, 'upstream')
      run(root, 'clone', '--quiet', bare, work)
      writeFileSync(join(work, 'upstream.ts'), 'u\n')
      run(work, 'add', '.')
      run(work, 'commit', '--quiet', '-m', 'upstream moves')
      run(work, 'push', '--quiet', 'origin', 'main')
      const before = tip('refunds', fork)
      const merged = yield* mergeInCopy({
        into: { target: target(fork), branch: 'refunds', head: before },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.strictEqual(merged.outcome, 'updated')
      assert.strictEqual(run(fork, 'show', `${tip('refunds', fork)}:upstream.ts`), 'u')
      assert.strictEqual(tip('refunds', bare), before)
    }),
  )

  it.effect('says a branch it can’t read in its own words, without pushing', () =>
    Effect.gen(function* () {
      const { root, bare, tip } = hosting()
      const merged = yield* mergeInCopy({
        into: { target: target(join(root, 'gone.git')), branch: 'refunds', head: tip('refunds') },
        from: { target: target(bare), branch: 'main' },
        push: true,
      })
      assert.strictEqual(merged.outcome, 'refused')
    }),
  )
})

// ---- What every copy host does around the merge ------------------------------

const REPOSITORY: Repository = {
  id: '1',
  path: ['meridian', 'api'],
  defaultBranch: 'main',
  webUrl: 'https://example.com/meridian/api',
  canPush: true,
  merges: ['merge'],
}

const CHANGE: ChangeRequest = {
  id: '1',
  number: 12,
  title: 'Refunds',
  body: '',
  url: 'https://example.com/meridian/api/pulls/12',
  state: 'open',
  draft: false,
  source: 'refunds',
  target: 'main',
  headSha: 'abc',
  author: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  updatedAt: '2026-11-01T00:00:00Z',
  headRepository: null,
}

describe('Updating a branch on a host with no call for it', () => {
  const around = (change: Partial<ChangeRequest>, merge: Parameters<typeof updateInCopy>[0]['merge']) =>
    updateInCopy({
      product: 'gitlab',
      words: { noun: 'merge request', short: 'MR', prefix: '!' },
      repository: REPOSITORY,
      change: CHANGE,
      expectedHead: 'abc',
      read: Effect.succeed({ ...CHANGE, ...change }),
      fork: (path) => Effect.succeed({ ...REPOSITORY, path }),
      pushTarget: (repository) => Effect.succeed({ url: `https://example.com/${repository.path.join('/')}.git`, header: null }),
      ...(merge === undefined ? {} : { merge }),
    })

  const never: NonNullable<Parameters<typeof updateInCopy>[0]['merge']> = () => Effect.die('merged')

  it.effect('merges at the head it read, into the repository’s own branch, from the target', () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = []
      const done = yield* around({}, (merge) => {
        seen.push([merge.into.target.url, merge.into.branch, merge.into.head, merge.from.target.url, merge.from.branch, merge.push])
        return Effect.succeed({ outcome: 'updated', head: 'def' })
      })
      assert.deepStrictEqual(done, { outcome: 'updated', head: 'def' } satisfies BranchUpdate)
      assert.deepStrictEqual(seen, [
        ['https://example.com/meridian/api.git', 'refunds', 'abc', 'https://example.com/meridian/api.git', 'main', true],
      ])
    }),
  )

  it.effect('pushes a fork’s branch to the fork, and says no_access when its host refuses', () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const refused = yield* around({ headRepository: ['stranger', 'api'] }, (merge) => {
        seen.push(merge.into.target.url)
        return Effect.succeed({ outcome: 'refused', message: 'remote: You are not allowed to push to this branch' })
      })
      assert.deepStrictEqual(seen, ['https://example.com/stranger/api.git'])
      assert.deepStrictEqual(refused, { outcome: 'no_access', reason: 'remote: You are not allowed to push to this branch' })
    }),
  )

  it.effect('fails on the repository’s own branch the host refuses, in its words, rather than blaming an author', () =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(around({}, () => Effect.succeed({ outcome: 'refused', message: 'remote: protected branch' })))
      assert.strictEqual(failed.reason, 'rejected')
      assert.include(failed.message, 'protected branch')
    }),
  )

  it.effect('does not merge a branch that moved, a fork that is gone, or a change that is not open', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* around({ headSha: 'xyz' }, never), { outcome: 'moved', head: 'xyz' })
      assert.strictEqual((yield* around({ headRepository: [] }, never)).outcome, 'no_access')
      assert.strictEqual((yield* Effect.flip(around({ state: 'merged' }, never))).reason, 'rejected')
    }),
  )
})
