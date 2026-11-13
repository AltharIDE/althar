import { assert, describe, it } from '@effect/vitest'

import { answersOf, followUpBody, followUpWords } from '../src/followUpWords'

const finding = {
  severity: 'major',
  file: 'src/usage.ts',
  line: 12,
  claim: 'Task timing is summed into every snapshot. It doubles the totals.',
}

describe('what a follow-up pull request says of itself', () => {
  it('is named by the lead’s words, else its fix’s commit, else its finding', () => {
    const commits = [{ subject: 'Stop summing task timing into every snapshot', body: '' }]
    assert.strictEqual(followUpWords({ written: 'Count timing once', commits, findings: [finding] }, [], null, 50), 'Count timing once')
    assert.strictEqual(followUpWords({ commits, findings: [finding] }, [], null, 60), 'Stop summing task timing into every snapshot')
    assert.strictEqual(followUpWords({ commits: [], findings: [finding] }, [], null, 60), 'Task timing is summed into every snapshot')
    assert.isNull(followUpWords({ commits: [], findings: [] }, [], null, 60))
  })

  it('cuts a long one at a word, and drops a prefix it would repeat', () => {
    const long = followUpWords(
      { written: 'After #763: Stop summing task timing into every snapshot taken', commits: [], findings: [] },
      [],
      null,
      30,
    )
    assert.strictEqual(long, 'Stop summing task timing…')
  })

  it('describes itself from its finding and commits where its lead wrote nothing', () => {
    const body = followUpBody({
      follows: '#763',
      findings: [finding],
      commits: [{ subject: 'Stop summing task timing into every snapshot', body: 'Each snapshot added the whole again.' }],
    })
    assert.include(body, 'The review after #763 merged found a problem in it')
    assert.include(body, '- Task timing is summed into every snapshot. It doubles the totals. (`src/usage.ts:12`)')
    assert.include(body, '- Stop summing task timing into every snapshot: Each snapshot added the whole again.')
    assert.include(followUpBody({ follows: '#763', findings: [], commits: [] }), 'Follows #763, which merged')
    // After one closed, it says so: the earlier one didn't merge.
    assert.include(followUpBody({ follows: '#763', state: 'closed', findings: [], commits: [] }), 'which was closed without merging')
    assert.notInclude(followUpBody({ follows: '#763', state: 'closed', findings: [], commits: [] }), 'which merged')
  })

  it('reads the findings a review kept, and none from what it can’t read', () => {
    assert.lengthOf(answersOf(JSON.stringify([finding])), 1)
    assert.lengthOf(answersOf('not json'), 0)
    assert.lengthOf(answersOf(null), 0)
  })
})
