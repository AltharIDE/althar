import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { holdupOf, type Checkout } from '../src/checkouts'
import { remoteBranches } from '../src/git'

/** The edges of working toward a branch other than the default (ADR-093) that its larger tests don't reach. */

const on = (branch: string | null, head = 'abcdef0123'): Checkout => ({ branch, head, uncommitted: [], midway: null })

describe('a checkout a task is to take', () => {
  it('is the person’s own on any branch but the default and those a task’s work goes into', () => {
    assert.isNull(holdupOf(on('main'), 'main', 'abc'))
    assert.deepStrictEqual(holdupOf(on('release/0.8.0'), 'main', 'abc'), { kind: 'branch', branch: 'release/0.8.0' })
    assert.isNull(holdupOf(on('release/0.8.0'), 'main', 'abc', ['release/0.8.0']))
    assert.deepStrictEqual(holdupOf(on('release/0.7.0'), 'main', 'abc', ['release/0.8.0']), { kind: 'branch', branch: 'release/0.7.0' })
    // Detached: free at the commit tasks start from, the person's elsewhere, even where a branch is named in `also`.
    assert.isNull(holdupOf(on(null, 'abc'), 'main', 'abc', ['release/0.8.0']))
    assert.deepStrictEqual(holdupOf(on(null, 'abcdef0123'), 'main', 'other', ['release/0.8.0']), { kind: 'branch', branch: 'abcdef0' })
  })
})

describe('a remote’s branches', () => {
  it.effect('are just the first where git can’t say', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* remoteBranches('/nonexistent/althar/repository', 'origin', 'main'), ['main'])
    }),
  )
})
