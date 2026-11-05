import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Fetches, type Wanted } from '../src/Fetches'
import { repository, runtime } from './support'

/*
 * Fetching a branch, a tag or a pull request into a repository (ADR-066)
 * where its remote is a folder on this computer, on no code host: what it
 * fetches, and why it won't, in words.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: 'pipe' })
    .toString()
    .trim()

/** A repository whose origin is a bare copy of it with a branch and a tag of its own. */
const withOrigin = () => {
  const working = repository()
  const bare = mkdtempSync(join(tmpdir(), 'althar-origin-'))
  git(working, 'clone', '-q', '--bare', working, bare)
  git(working, 'remote', 'add', 'origin', bare)
  git(bare, 'branch', 'retry-refunds')
  git(bare, 'tag', 'v1.0')
  return { working, bare }
}

const refusal = (working: string, wanted: Wanted) =>
  Effect.flatMap(Fetches, (fetches) =>
    Effect.map(Effect.flip(fetches.fetch(working, wanted)), (error) => (error as { readonly message: string }).message),
  )

describe('fetching from a remote on no code host', () => {
  it.live('fetches a branch and a tag it has', () =>
    Effect.gen(function* () {
      const { working } = withOrigin()
      const fetches = yield* Fetches
      const branch = yield* fetches.fetch(working, { kind: 'branch', name: 'retry-refunds' })
      assert.include(JSON.stringify(branch), 'refs/remotes/origin/retry-refunds')
      const tag = yield* fetches.fetch(working, { kind: 'tag', name: 'v1.0' })
      assert.include(JSON.stringify(tag), 'refs/tags/v1.0')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('won’t fetch what isn’t a name, or isn’t there, and says what is like it', () =>
    Effect.gen(function* () {
      const { working } = withOrigin()
      for (const [wanted, said] of [
        [{ kind: 'branch', name: '' }, "That isn't a branch's name."],
        [{ kind: 'branch', name: '--all' }, "“--all” isn't a branch's name."],
        [{ kind: 'branch', name: 'refs/heads/x' }, "“refs/heads/x” isn't a branch's name."],
        [{ kind: 'tag', name: 'a..b' }, "“a..b” isn't a tag's name."],
        [{ kind: 'branch', name: 'retry-refund' }, 'origin has no branch called retry-refund. Branches like it: retry-refunds.'],
        [{ kind: 'branch', name: 'zzz-nothing' }, 'origin has no branch called zzz-nothing.'],
        [
          { kind: 'tag', name: 'v9' },
          "Althar couldn't fetch the tag v9 from origin: it has no such tag, a tag of that name here differs, or it couldn't be reached.",
        ],
        [{ kind: 'pull_request', which: 'the one about refunds' }, 'Give the pull request’s number, as #12, or its link.'],
        [{ kind: 'pull_request', which: 'https://example.com/a/b/issues/3' }, 'That link isn’t to a pull request.'],
      ] as const)
        assert.strictEqual(yield* refusal(working, wanted), said, JSON.stringify(wanted))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('won’t fetch a pull request’s link to another repository, nor one from a remote it can’t place', () =>
    Effect.gen(function* () {
      const { working } = withOrigin()
      assert.strictEqual(
        yield* refusal(working, { kind: 'pull_request', which: 'https://github.com/meridian/api/pull/3' }),
        "That link is to github.com, and origin isn't on a code host Althar can tell. Give the pull request's number.",
      )
      const hosted = repository()
      git(hosted, 'remote', 'add', 'origin', 'https://github.com/meridian/web.git')
      assert.strictEqual(
        yield* refusal(hosted, { kind: 'pull_request', which: 'https://github.com/meridian/api/pull/3' }),
        'That pull request is on github.com/meridian/api, not github.com/meridian/web.',
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says where there is no remote to fetch from, or it can’t be reached', () =>
    Effect.gen(function* () {
      const alone = repository()
      assert.strictEqual(yield* refusal(alone, { kind: 'branch', name: 'main' }), 'The repository has no remote to fetch from.')
      assert.strictEqual(yield* refusal(alone, { kind: 'tag', name: 'v1.0' }), 'The repository has no remote called origin to fetch from.')
      assert.strictEqual(
        yield* refusal(alone, { kind: 'pull_request', which: '#3' }),
        'The repository has no remote called origin to fetch from.',
      )
      const gone = repository()
      git(gone, 'remote', 'add', 'origin', join(tmpdir(), 'althar-no-such-remote'))
      assert.match(yield* refusal(gone, { kind: 'branch', name: 'main' }), /^Althar couldn't reach origin \(.*\) to fetch main: /)
      assert.match(
        yield* refusal(gone, { kind: 'pull_request', which: '#3' }),
        /^Althar couldn't reach origin \(.*\) to fetch PR #3: this computer may be offline, or git here has no sign-in for it\./,
      )
    }).pipe(Effect.provide(runtime())),
  )
})
