import type { Check } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'

import { thisDevice } from '../src/device'
import {
  baseChecksForLead,
  checksOf,
  filesLine,
  fromAlthar,
  gaveUpLine,
  leftQueueNote,
  nameInLine,
  outsidersLine,
  queuedNote,
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
