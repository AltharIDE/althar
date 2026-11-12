import { assert, describe, it } from '@effect/vitest'

import { timingsFrom } from '../src/turnTimes'

/*
 * Where a turn's commits went, as its timings keep them (a task is a
 * conversation plus parts, "Where a turn's time goes"): in a task of several
 * changes, each change the turn committed to, by name, with how many commits;
 * anything else kept there, from another version or written by hand, is left
 * out rather than shown wrong.
 */

describe('where a turn’s commits went', () => {
  it('reads each change it committed to by name, with its commits counted whole', () => {
    const kept = JSON.stringify({
      place: 0,
      session: 0,
      starting: 'start',
      work: 900,
      tools: 100,
      changes: [
        { name: 'api', commits: 2 },
        { name: 'docs', commits: 1.6 },
      ],
    })
    assert.deepStrictEqual(timingsFrom(kept)?.changes, [
      { name: 'api', commits: 2 },
      { name: 'docs', commits: 2 },
    ])
  })

  it('leaves out what isn’t a change: no name, no commits, or not an entry at all', () => {
    const kept = JSON.stringify({
      work: 900,
      changes: [
        'api',
        null,
        7,
        { name: 3, commits: 1 },
        { name: 'web', commits: 0 },
        { name: 'ui', commits: -2 },
        { name: 'api', commits: 1 },
      ],
    })
    assert.deepStrictEqual(timingsFrom(kept), {
      place: 0,
      session: 0,
      starting: null,
      work: 900,
      tools: 0,
      changes: [{ name: 'api', commits: 1 }],
    })
  })

  it('says a turn of a task of several changes committed to none, where none was counted', () => {
    assert.deepStrictEqual(timingsFrom('{"work":5,"changes":[]}')?.changes, [])
    // Where no list was kept, the turn wasn't in a task of several changes, and says nothing of them.
    assert.isUndefined(timingsFrom('{"work":5,"changes":{"api":2}}')?.changes)
  })
})
