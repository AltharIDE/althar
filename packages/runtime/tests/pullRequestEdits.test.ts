import { assert, describe, it } from '@effect/vitest'

import { detailsOf, type ReviewRecord, sealOf, unreviewedNote } from '../src/pullRequestReview'
import { bodyOf, describedAs, framedOf, sameDescription, titleWords, withDescribed } from '../src/pullRequestWords'

/*
 * A pull request's title and description given anew after it opened: the
 * words a lead gives its title, without an agent's credit or what the
 * project's naming puts in front; and its description's own part replaced,
 * with what Althar put around it (the review's seal, note and fold, the
 * issue, its credit) where it was.
 */

const RECORD = {
  reviewer: 'GPT-6.1 Sol',
  lead: 'Claude Opus 5.5',
  passes: 2,
  sha: '2f67c42a0b1c2d3e4f5061728394a5b6c7d8e9f0',
  date: '2026-10-31',
  changed: [{ what: 'The orrery keeps its place on a narrow screen.', commits: [] }],
  kept: [],
} satisfies ReviewRecord

const issue = { key: 'MER-231', url: 'https://linear.app/meridian/issue/MER-231', sameHost: false }

describe('a pull request’s description given anew', () => {
  it('replaces the lead’s part, and keeps the seal, the note, the fold, the issue and the credit where they were', () => {
    const review = { seal: sealOf('wax', RECORD), details: detailsOf(RECORD), note: unreviewedNote(2) }
    const opened = bodyOf({ lead: null, issue, written: 'Four looks, A to D.\n\nOne of them stays.', review })
    const framed = framedOf(opened)
    assert.strictEqual(framed.described, 'Four looks, A to D.\n\nOne of them stays.')
    assert.lengthOf(framed.head, 2)
    assert.lengthOf(framed.tail, 3)
    assert.strictEqual(
      withDescribed(opened, 'The homepage opens on the orrery.'),
      bodyOf({ lead: null, issue, written: 'The homepage opens on the orrery.', review }),
    )
    // As a host gives it back, with its own line ends.
    assert.strictEqual(
      withDescribed(opened.replace(/\n/g, '\r\n'), 'The homepage opens on the orrery.'),
      bodyOf({ lead: null, issue, written: 'The homepage opens on the orrery.', review }),
    )
  })

  it('keeps an automation’s credit and a part-of line, and replaces one Althar didn’t write whole', () => {
    const opened = bodyOf({ lead: 'Did it.', issue: { ...issue, partOf: true }, automation: 'Nightly tidy' })
    assert.strictEqual(
      withDescribed(opened, 'Tidied.'),
      bodyOf({ lead: 'Tidied.', issue: { ...issue, partOf: true }, automation: 'Nightly tidy' }),
    )
    assert.strictEqual(withDescribed('Someone’s own words.\n\nAnd more.', 'New words.'), 'New words.')
    assert.strictEqual(withDescribed('', 'New words.'), 'New words.')
  })

  it('fills the template’s boxes unticked where it keeps the template, and leaves other words as written', () => {
    const template = '## Summary\n\n## Checklist\n\n- [ ] Tests\n'
    assert.strictEqual(
      describedAs('## Summary\n\nIt does.\n\n## Checklist\n\n- [x] Tests\n', template),
      '## Summary\n\nIt does.\n\n## Checklist\n\n- [ ] Tests',
    )
    assert.strictEqual(describedAs('  Just this.  ', template), 'Just this.')
    assert.strictEqual(describedAs('Just this.', null), 'Just this.')
  })

  it('reads two descriptions the same whatever their line ends and the space around them', () => {
    assert.isTrue(sameDescription('A\r\n\r\nB\n', 'A\n\nB'))
    assert.isFalse(sameDescription('A', 'B'))
  })
})

describe('the words given for a pull request’s title', () => {
  it('are one line, without an agent’s credit, or the key and “After” the naming puts in front', () => {
    assert.strictEqual(titleWords('The homepage opens on the orrery', [], null), 'The homepage opens on the orrery')
    assert.strictEqual(
      titleWords('The homepage opens\non the orrery\n\nCo-Authored-By: Claude <noreply@anthropic.com>', [], null),
      'The homepage opens on the orrery',
    )
    assert.strictEqual(titleWords('🤖 Generated with [Claude Code](https://claude.com/claude-code)', [], null), '')
    assert.strictEqual(titleWords('MER-231: Retry twice', [], 'MER-231'), 'Retry twice')
    assert.strictEqual(titleWords('[mer-231] Retry twice', [], 'MER-231'), 'Retry twice')
    assert.strictEqual(titleWords('After #12: MER-231 - Retry twice', [], 'MER-231'), 'Retry twice')
    assert.strictEqual(titleWords('#7: Retry twice', [], '#7'), 'Retry twice')
    // A key the task hasn't, or words that only start like one, stay.
    assert.strictEqual(titleWords('MER-231: Retry twice', [], null), 'MER-231: Retry twice')
    assert.strictEqual(titleWords('MER-2310 grows', [], 'MER-231'), 'MER-2310 grows')
  })
})
