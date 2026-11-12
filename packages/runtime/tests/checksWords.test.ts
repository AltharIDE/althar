import type { Check } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'

import { thisDevice } from '../src/device'
import {
  baseChecksForLead,
  checksOf,
  filesLine,
  fromAlthar,
  gaveUpLine,
  failingOnBase,
  leftQueueForLead,
  leftQueueNote,
  leftQueueNoteForLead,
  leftQueueUnclaimed,
  passingOnBase,
  nameInLine,
  outsidersLine,
  queuedNote,
  queueMainLine,
  queueOwnFailures,
  signed,
  spentLine,
  stoppedLine,
  unsettledLine,
  unsigned,
} from '../src/pullRequestWords'

/*
 * What Althar says of a pull request's checks and its merge queue, on the
 * card and to the lead, in each of the ways it can stand.
 */

const check = (name: string, state: Check['state'], summary: string | null = null): Check => ({
  id: name,
  name,
  state,
  url: null,
  summary,
})

describe('why failing checks are the person’s, as the card says', () => {
  it('names the one that fails, counts several, and says “checks” where none is named', () => {
    assert.strictEqual(unsettledLine(['test']), 'test still fails, and the lead stopped. Tell it what to do.')
    assert.strictEqual(unsettledLine(['test', 'lint'], 'gone'), "2 checks still fail, and the lead's agent stopped. Tell it what to do.")
    assert.strictEqual(spentLine([], 3), 'Checks still fail after 3 fixes.')
  })

  it('says how they left Althar’s hands: run too long, unreadable, the lead interrupted or stopped', () => {
    assert.strictEqual(
      stoppedLine(['test'], 'stuck'),
      'test still fails, and the checks ran too long for Althar to see through. Tell it what to do.',
    )
    assert.strictEqual(
      stoppedLine(['test', 'lint'], 'unreadable'),
      "2 checks still fail, and Althar can't read the checks to see them through. Tell it what to do.",
    )
    assert.strictEqual(stoppedLine([], 'interrupted'), 'Checks still fail, and you interrupted the lead. Tell it what to do.')
    assert.strictEqual(stoppedLine(['test'], 'stopped'), 'test still fails, and you stopped the lead. Tell it what to do.')
  })

  it('says why Althar gave up on checks none of which failed', () => {
    assert.strictEqual(gaveUpLine('stuck'), 'The checks ran too long for Althar to see them through. Tell the lead what to do.')
    assert.strictEqual(gaveUpLine('unreadable'), 'Althar can’t read the checks to see them through. Tell the lead what to do.')
  })
})

describe('the default branch’s checks, as the lead reads them', () => {
  it('says none have run, and that this says nothing of the branch', () => {
    assert.strictEqual(
      baseChecksForLead(checksOf('abcdef1234', []), 'main', []),
      "The checks on main's latest commit, abcdef1: none have run. Some repositories run their checks on pull requests only, so this says nothing of whether main is broken.",
    )
  })

  it('lists each with what it said of itself, where it said, then the logs', () => {
    const sum = checksOf('abcdef1234', [check('test', 'failed', '2 failed'), check('lint', 'passed'), check('docs', 'running')])
    assert.strictEqual(
      baseChecksForLead(sum, 'main', ['FAIL limit.test.ts']),
      [
        "The checks on main's latest commit, abcdef1: 1 passed, 1 failed, 1 running.",
        '- test: failed (2 failed)\n- lint: passed\n- docs: running',
        'FAIL limit.test.ts',
      ].join('\n\n'),
    )
  })
})

describe('the merge queue, in the task’s thread', () => {
  it('says the branch it queues for where it is known', () => {
    assert.strictEqual(queuedNote('PR #1', 'main'), 'PR #1 is in the merge queue for main.')
    assert.strictEqual(queuedNote('PR #1', undefined), 'PR #1 is in the merge queue.')
  })

  it('says why the queue took it out, where its host says', () => {
    assert.strictEqual(leftQueueNote('PR #1', 'removed'), 'Someone took PR #1 out of the merge queue.')
    assert.strictEqual(leftQueueNote('PR #1', 'checks'), 'The merge queue took PR #1 out: its checks failed.')
    assert.strictEqual(leftQueueNote('PR #1', 'conflict'), "The merge queue took PR #1 out: it conflicts with what's ahead of it.")
    assert.strictEqual(leftQueueNote('PR #1', undefined), 'The merge queue took PR #1 out.')
  })

  it('says, on a sendback for failing checks, which merge-group jobs failed, their logs, and the default branch on the same jobs', () => {
    const detail = {
      queueSha: 'abcdef1234567890',
      failing: ['test'],
      logs: ['The end of test\u2019s log:\n```\nFAIL\n```'],
      main: 'Passes on main.',
    }
    const said = leftQueueForLead('PR #1', 'checks', detail)
    assert.include(said, 'The merge queue took PR #1 out: its checks failed.')
    assert.include(said, 'Failed on the queue build (abcdef1): test.')
    assert.include(said, 'FAIL')
    assert.include(said, 'Passes on main.')
    assert.include(said, 'read_checks (queue: true)')
    assert.include(said, 'read_check_log (queue: true)')
    // A sendback whose build its host doesn't name, and one for another reason, say alone.
    assert.strictEqual(leftQueueForLead('PR #1', 'checks', null), leftQueueNote('PR #1', 'checks'))
    assert.strictEqual(leftQueueForLead('PR #1', 'checks'), leftQueueNote('PR #1', 'checks'))
    assert.strictEqual(leftQueueForLead('PR #1', 'removed', detail), leftQueueNote('PR #1', 'removed'))
    assert.include(
      leftQueueForLead('PR #1', 'checks', { queueSha: null, failing: [], logs: [], main: null }),
      'Which merge-group jobs failed is not named here.',
    )
  })

  it('compares the queue\u2019s failures with the default branch: only what it reports counts', () => {
    const base = (...rows: Array<[string, 'passed' | 'failed' | 'running']>) => rows.map(([name, state]) => ({ name, state }))
    assert.strictEqual(
      queueMainLine('main', ['test'], base(['test', 'failed'])),
      'The same jobs also fail on main: test. Their failure causes may differ.',
    )
    assert.strictEqual(queueMainLine('main', ['test'], base(['test', 'passed'])), 'test passes on main.')
    assert.strictEqual(
      queueMainLine('main', ['test'], base()),
      'No checks have run on main, so this says nothing of whether main is broken.',
    )
    assert.strictEqual(
      queueMainLine('main', ['a', 'b'], base(['b', 'failed'], ['a', 'passed'])),
      'The same jobs also fail on main: b. Their failure causes may differ. a passes on main.',
    )
    assert.strictEqual(
      queueMainLine('main', ['a', 'b'], base(['b', 'failed'])),
      "The same jobs also fail on main: b. Their failure causes may differ. main hasn't reported on a yet.",
    )
    assert.strictEqual(queueMainLine('main', ['a'], base(['a', 'running'])), "main hasn't reported on a yet.")
    assert.strictEqual(queueMainLine('main', ['a'], base(['a', 'passed'], ['a', 'running'])), "main hasn't reported on a yet.")
    assert.strictEqual(queueMainLine('main', ['a'], base(['b', 'failed'])), "main hasn't reported on a yet.")
  })
})

describe('what Althar signs and leaves out', () => {
  it('counts comments left out from people outside the repository', () => {
    assert.match(outsidersLine(1), /^One comment from people who can't write to the repository is left out\./)
    assert.match(outsidersLine(3), /^3 comments from people who can't write to the repository are left out\./)
  })

  it('writes an automation’s name small after “Althar’s”, unless its first word is in capitals', () => {
    assert.strictEqual(nameInLine('Morning review'), 'morning review')
    assert.strictEqual(nameInLine('CI watch'), 'CI watch')
    assert.strictEqual(nameInLine('nightly'), 'nightly')
  })

  it('signs a reply with who wrote it and the automation it ran in, and reads it back without', () => {
    const plain = signed('Done.\n', null)
    assert.strictEqual(plain, 'Done.\n\n<sub>From Althar.</sub>')
    const full = signed('Done.', 'Claude Code', 'Morning review')
    assert.strictEqual(full, 'Done.\n\n<sub>From Althar’s morning review, by Claude Code.</sub>')
    assert.isTrue(fromAlthar(full))
    assert.strictEqual(unsigned(full), 'Done.')
    // As Althar signed while it was called Charrette.
    assert.isTrue(fromAlthar('Done.\n\n<sub>From Charrette, by Codex.</sub>'))
    assert.isFalse(fromAlthar(''))
    assert.strictEqual(unsigned('Mine.'), 'Mine.')
  })

  it('names the first few files and counts the rest', () => {
    assert.strictEqual(filesLine(['a.ts', 'b.ts']), '`a.ts`, `b.ts`')
    assert.strictEqual(filesLine(['a.ts', 'b.ts', 'c.ts'], 2), '`a.ts`, `b.ts` and 1 more')
  })
})

describe('this computer, in the words the runtime writes', () => {
  it('is a Mac, a PC, or a computer', () => {
    assert.deepStrictEqual(
      (['darwin', 'win32', 'linux'] as const).map((platform) => thisDevice(platform)),
      ['this Mac', 'this PC', 'this computer'],
    )
  })
})

describe('a merge queue send-back, and whose it is', () => {
  const detail = (
    failing: ReadonlyArray<string>,
    onBaseToo: ReadonlyArray<string> = [],
    passedOnBase = failing.filter((job) => !onBaseToo.includes(job)),
  ) => ({ queueSha: 'group-sha', failing, logs: [], main: null, onBaseToo, passedOnBase })

  it('names the pull request only by a job its build failed that the default branch passes', () => {
    assert.deepStrictEqual(queueOwnFailures('checks', detail(['test', 'lint'], ['lint'])), ['test'])
    assert.deepStrictEqual(queueOwnFailures('other', detail(['test'])), ['test'])
    // Every job it failed fails on the default branch too, none could be read, or the host said nothing of its build.
    assert.deepStrictEqual(queueOwnFailures('checks', detail(['test'], ['test'])), [])
    assert.deepStrictEqual(queueOwnFailures('checks', detail([])), [])
    assert.deepStrictEqual(queueOwnFailures('other', null), [])
    // The default branch hasn't reported the job, still runs it, or couldn't be read: nothing says it passes there.
    assert.deepStrictEqual(queueOwnFailures('checks', detail(['test'], [], [])), [])
    assert.deepStrictEqual(queueOwnFailures('checks', { queueSha: null, failing: ['test'], logs: [], main: null }), [])
    // Someone took it out, or it conflicts: no job is why.
    assert.deepStrictEqual(queueOwnFailures('removed', detail(['test'])), [])
    assert.deepStrictEqual(queueOwnFailures('conflict', detail(['test'])), [])
  })

  it('reads which failing jobs fail and which pass on the default branch, by what its latest commit reports', () => {
    const base = [
      check('test', 'failed'),
      check('lint', 'passed'),
      check('e2e', 'running'),
      check('types', 'passed'),
      check('types', 'running'),
    ]
    assert.deepStrictEqual(failingOnBase(['test', 'lint', 'e2e', 'types', 'docs'], base), ['test'])
    // A job still running there, run again and not done, or not reported at all, doesn't pass.
    assert.deepStrictEqual(passingOnBase(['test', 'lint', 'e2e', 'types', 'docs'], base), ['lint'])
  })

  it('tells the person why nothing names it, and its lead, for its next turn, to change nothing for it', () => {
    assert.strictEqual(
      leftQueueUnclaimed('PR #4', 'other', null),
      'Nothing names PR #4 as why it was taken out: the host gave no specific reason, and its build names no job that failed. Its lead wasn’t asked to change anything. Put it back in the queue when you want, or ask its lead to look.',
    )
    assert.include(
      leftQueueUnclaimed('PR #4', 'checks', detail(['test'], ['test'])),
      'as why it was taken out: test fails on the default branch too.',
    )
    assert.include(
      leftQueueUnclaimed('PR #4', 'checks', detail(['test', 'e2e'], ['test'], [])),
      'test fails on the default branch too, and the default branch hasn’t reported e2e passing, so Althar can’t tell it from a failure of its own.',
    )
    const note = leftQueueNoteForLead('PR #4', 'checks', detail(['test'], ['test']))
    assert.include(note, 'The merge queue took PR #4 out: its checks failed.')
    assert.include(note, 'change nothing for it unless they ask')
  })
})
