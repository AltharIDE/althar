import { assert, describe, it } from '@effect/vitest'

import { type CardChange, type ErrandRecord, errandCardLines, LINE_MOST, oneLine, plainText } from '../src/errandWords'

const URL = 'https://github.com/AltharIDE/althar/pull/773'
/** The merge the person asked for on a board card that showed its raw record. */
const merge = (over: Partial<ErrandRecord> = {}): ErrandRecord => ({
  tool: 'merge_pull_request',
  target: URL,
  paused: false,
  waits: [
    { kind: 'merge_queue', target: 'AltharIDE/althar main' },
    { kind: 'checks', target: '9b50d2c41e0f' },
  ],
  ...over,
})
const change = (over: Partial<CardChange> = {}): CardChange => ({
  url: URL,
  short: '#773',
  state: 'open',
  checks: { outcome: 'running' },
  ...over,
})

describe('the card says an errand from what Althar knows', () => {
  it('a merge waiting on its running checks says it merges then, never the address, the repository or the branch', () => {
    const [line] = errandCardLines([merge()], change())
    assert.strictEqual(line, 'Merges once checks pass')
  })

  it('a merge in the merge queue, or train, says so', () => {
    assert.deepStrictEqual(errandCardLines([merge()], change({ queued: true })), ['In the merge queue'])
    // Its steps done, the card's word says it is in the merge queue: the line would only say it again.
    assert.deepStrictEqual(errandCardLines([merge()], change({ queued: true }), { queueShown: true }), [])
    const train = merge({ waits: [{ kind: 'merge_train', target: 'group/app main' }] })
    assert.deepStrictEqual(errandCardLines([train], change({ queued: true })), ['In the merge train'])
  })

  it('green and not queued yet, it is going in; in Althar’s own line, it waits its turn', () => {
    assert.deepStrictEqual(errandCardLines([merge()], change({ checks: { outcome: 'passed' } })), ['Going into the merge queue'])
    const line = merge({
      waits: [
        { kind: 'merge_line', target: 'o/r main' },
        { kind: 'checks', target: 'abc1234' },
      ],
    })
    assert.deepStrictEqual(errandCardLines([line], change({ checks: { outcome: 'passed' } })), ['Merges next'])
    assert.deepStrictEqual(errandCardLines([{ ...line, stands: 'behind' }], change({ checks: { outcome: 'passed' } })), [
      'Waiting its turn to merge',
    ])
  })

  it('a merge now says what it waits on as the line last read it, not the wait it was kept with', () => {
    const now = merge({ waits: [{ kind: 'merge_in_flight', target: 'o/r main' }] })
    // Kept, and not read yet: nothing says another merge is ahead of it.
    assert.deepStrictEqual(errandCardLines([now], change()), ['Merges once checks pass'])
    assert.deepStrictEqual(errandCardLines([{ ...now, stands: 'ahead' }], change()), ['Merges after the merge ahead'])
    // The merge ahead landed; its own checks run now.
    assert.deepStrictEqual(errandCardLines([{ ...now, stands: 'checks' }], change()), ['Merges once checks pass'])
    assert.deepStrictEqual(errandCardLines([{ ...now, stands: 'merging' }], change({ checks: { outcome: 'passed' } })), ['Merging'])
    assert.deepStrictEqual(errandCardLines([{ ...now, stands: 'settle' }], change()), [])
  })

  it('a conflicting merge says it waits on the conflict, not on checks', () => {
    assert.deepStrictEqual(errandCardLines([merge({ stands: 'conflict' })], change({ checks: { outcome: 'passed' } })), [
      'Merges once its conflict is settled',
    ])
    // Not read by the line yet, the pull request's own conflict says it.
    assert.deepStrictEqual(errandCardLines([merge()], change({ conflicts: true })), ['Merges once its conflict is settled'])
    assert.deepStrictEqual(errandCardLines([merge({ stands: 'stuck' })], change()), ['Can’t bring its branch up to date'])
  })

  it('a held merge says why, in a few plain words', () => {
    assert.deepStrictEqual(errandCardLines([merge({ paused: true })], change()), ['Merge on hold'])
    const objection = merge({ paused: true, reason: 'octocat asked for changes on #773 after the person asked.' })
    assert.deepStrictEqual(errandCardLines([objection], change()), ['On hold: octocat asked for changes on it after…'])
    const draft = merge({ paused: true, reason: '#773 went back to a draft after the person asked.' })
    assert.deepStrictEqual(errandCardLines([draft], change()), ['On hold: it went back to a draft after you asked'])
    const left = merge({ paused: true, reason: 'Taken out of the merge line with leave_queue: it goes back in on the person’s word.' })
    assert.deepStrictEqual(errandCardLines([left], change()), ['On hold: taken out of the merge line'])
    const url = merge({ paused: true, reason: `Wait for ${URL} to be reviewed` })
    assert.deepStrictEqual(errandCardLines([url], change()), ['On hold: wait for it to be reviewed'])
  })

  it('says nothing for a pull request that merged or closed, where the chip says it all', () => {
    assert.deepStrictEqual(errandCardLines([merge()], change({ state: 'merged' })), [])
  })

  it('names another pull request short, and says the same line once', () => {
    const other = merge({ target: 'https://github.com/AltharIDE/althar/pull/801' })
    assert.deepStrictEqual(errandCardLines([other, other], change()), ['Merges #801 once checks pass'])
    const mr = merge({ target: 'https://gitlab.com/group/app/-/merge_requests/12' })
    assert.deepStrictEqual(errandCardLines([mr], null), ['Merges !12 once checks pass'])
  })

  it('another tool reads as its name and its waits in words', () => {
    const release: ErrandRecord = {
      tool: 'publish_release',
      target: 'https://github.com/AltharIDE/althar/releases/tag/v0.9.0',
      paused: false,
      waits: [{ kind: 'checks', target: 'AltharIDE/althar main' }],
    }
    assert.deepStrictEqual(errandCardLines([release], change()), ['Publish release once checks pass'])
    const waiting = { ...release, waits: [{ kind: 'release_approval', target: 'https://github.com/o/r/actions/runs/1' }] }
    assert.deepStrictEqual(errandCardLines([waiting], null), ['Publish release waits for release approval'])
    assert.deepStrictEqual(errandCardLines([{ ...release, paused: true }], null), ['Publish release on hold'])
  })
})

describe('free text is made plain for a card', () => {
  it('turns a pull request’s address into its number and drops the repository, branch and commit', () => {
    assert.strictEqual(
      plainText(`Waiting for ${URL}: merge_queue AltharIDE/althar main, checks 9b50d2c41e0f`),
      'Waiting for #773: merge queue, checks',
    )
  })

  it('drops an address with no short form, and keeps a file’s path', () => {
    assert.strictEqual(plainText('See https://example.com/docs for the steps'), 'See for the steps')
    assert.strictEqual(plainText('fixing src/board.ts tests'), 'Fixing src/board.ts tests')
  })

  it('keeps to one line, cut between words', () => {
    const long = 'Waiting for the review of the pull request that changes how the board draws its cards'
    const cut = plainText(long)
    assert.isAtMost(cut.length, LINE_MOST + 1)
    assert.isTrue(cut.endsWith('…'))
    assert.isTrue(long.startsWith(cut.slice(0, -1)), 'cut at a word’s end')
    assert.match(long.slice(cut.length - 1), /^ /)
    assert.strictEqual(oneLine('short\nline'), 'short line')
  })

  it('says nothing where nothing plain is left', () => {
    assert.strictEqual(plainText('https://example.com/x'), '')
  })
})
