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

describe('a merge says each place the merge line can read it at', () => {
  const read = (stands: string, over: Partial<ErrandRecord> = {}, card: CardChange | null = change()) =>
    errandCardLines([merge({ stands, ...over })], card)
  const other = { target: 'https://github.com/AltharIDE/althar/pull/801' }

  it('its own pull request goes unnamed', () => {
    assert.deepStrictEqual(read('queued'), ['In the merge queue'])
    assert.deepStrictEqual(read('update'), ['Bringing its branch up to date'])
    assert.deepStrictEqual(read('automerge'), ['Auto-merges once checks pass'])
    assert.deepStrictEqual(read('merge'), ['Merging'])
    assert.deepStrictEqual(read('auto'), ['Merging'])
    assert.deepStrictEqual(read('enqueue'), ['Going into the merge queue'])
    assert.deepStrictEqual(read('empty'), ['No commits to merge'])
    assert.deepStrictEqual(read('red'), ['Merges once checks pass'])
  })

  it('another pull request is named short', () => {
    assert.deepStrictEqual(read('queued', other), ['In the merge queue: #801'])
    assert.deepStrictEqual(read('stuck', other), ['Can’t bring #801’s branch up to date'])
    assert.deepStrictEqual(read('update', other), ['Bringing #801’s branch up to date'])
    assert.deepStrictEqual(read('enqueue', other), ['Going into the merge queue: #801'])
    assert.deepStrictEqual(read('empty', other), ['No commits to merge #801'])
  })

  it('a merge train is said as one', () => {
    const train = { waits: [{ kind: 'merge_train', target: 'group/app main' }] }
    assert.deepStrictEqual(read('enqueue', train), ['Going into the merge train'])
    assert.deepStrictEqual(errandCardLines([merge(train)], change({ checks: { outcome: 'none' } })), ['Going into the merge train'])
    // Another pull request's checks are not the card's: it waits on them.
    const named = { ...train, ...other }
    assert.deepStrictEqual(errandCardLines([merge(named)], change({ checks: { outcome: 'passed' } })), ['Merges #801 once checks pass'])
  })

  it('an unread stand falls back to the pull request, with no checks at all', () => {
    assert.deepStrictEqual(read('wait', {}, change({ checks: null })), ['Merges once checks pass'])
    assert.deepStrictEqual(errandCardLines([merge({ stands: null, waits: [] })], change({ checks: { outcome: 'none' } })), ['Merges next'])
  })

  it('a held merge of another pull request names it, and keeps its number', () => {
    assert.deepStrictEqual(read('queued', { ...other, paused: true }), ['Merge #801 on hold'])
    const held = merge({ ...other, paused: true, reason: '#801 went back to a draft.' })
    assert.deepStrictEqual(errandCardLines([held], change()), ['On hold: #801 went back to a draft'])
    // A reason with nothing plain left says only that it is held.
    assert.deepStrictEqual(errandCardLines([merge({ paused: true, reason: 'https://example.com/x' })], change()), ['Merge on hold'])
  })
})

describe('another tool says its waits in Althar’s words', () => {
  const tool = (kinds: ReadonlyArray<string>, name = 'publish_release'): ErrandRecord => ({
    tool: name,
    target: 'https://github.com/AltharIDE/althar/pull/801',
    paused: false,
    waits: kinds.map((kind) => ({ kind, target: 'o/r main' })),
  })

  it('names each known wait, and each once', () => {
    assert.deepStrictEqual(errandCardLines([tool(['review', 'approval'])], null), ['Publish release #801 waits for a review'])
    assert.deepStrictEqual(errandCardLines([tool(['merge_queue'])], null), ['Publish release #801 waits for the merge queue'])
    assert.deepStrictEqual(errandCardLines([tool(['merge_train'])], null), ['Publish release #801 waits for the merge train'])
    assert.deepStrictEqual(errandCardLines([tool(['merge_line', 'merge_in_flight'])], null), [
      'Publish release #801 waits for its turn to merge',
    ])
    assert.deepStrictEqual(errandCardLines([tool(['checks', 'review'], 'tag')], null), ['Tag #801 waits for checks and a review'])
  })

  it('with no waits it goes next, and an MCP tool reads as its own name', () => {
    assert.deepStrictEqual(errandCardLines([tool([], 'mcp__github__create_release')], null), ['Create release #801 next'])
    // A wait with nothing plain in it says nothing.
    assert.deepStrictEqual(errandCardLines([tool(['https://example.com/x'])], null), ['Publish release #801 next'])
  })
})

describe('free text at its edges', () => {
  it('cuts a word longer than the line where it must, and says nothing for dots alone', () => {
    assert.strictEqual(oneLine('a supercalifragilisticexpialidocious-word', 10), 'a supercal…')
    assert.strictEqual(plainText('...'), '')
  })

  it('keeps a word that only looks like a hash', () => {
    assert.strictEqual(plainText('fixed deadbeef cafe'), 'Fixed deadbeef cafe')
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
