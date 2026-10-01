import type { Comment, Review } from '@charrette/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Duration } from 'effect'

import {
  answerHint,
  bodyOf,
  checksForLead,
  checksLine,
  checksOf,
  commentForLead,
  commentLine,
  filesLine,
  fromCharrette,
  nameOf,
  outsidersLine,
  reviewForLead,
  reviewLine,
  signed,
  standing,
  unsigned,
} from '../src/pullRequestWords'
import { listenDue } from '../src/Changes'
import { changeOf, itemOf, stuckOf } from '../src/Queries'

const dana = { id: 'u2', login: 'dana', name: 'Dana', bot: false }
const comment = (more: Partial<Comment> = {}): Comment => ({
  id: '1',
  author: dana,
  member: true,
  body: 'Seconds or a date?\nPartners care.',
  at: '2026-10-01T10:00:00Z',
  url: null,
  threadId: null,
  path: null,
  line: null,
  ...more,
})
const review = (more: Partial<Review> = {}): Review => ({
  id: '2',
  author: dana,
  member: true,
  verdict: 'changes_requested',
  body: 'Name it better.',
  at: '2026-10-01T10:01:00Z',
  url: null,
  ...more,
})

describe('what Charrette writes about a pull request', () => {
  it('sums up its checks', () => {
    const check = (name: string, state: 'queued' | 'running' | 'passed' | 'failed' | 'skipped') => ({
      id: name,
      name,
      state,
      url: null,
      summary: null,
    })
    assert.strictEqual(checksOf('a', []).outcome, 'none')
    assert.strictEqual(checksOf('a', [check('test', 'queued'), check('lint', 'passed')]).outcome, 'running')
    assert.deepStrictEqual(checksOf('a', [check('test', 'failed'), check('lint', 'passed'), check('docs', 'skipped')]), {
      sha: 'a',
      outcome: 'failed',
      passed: 1,
      failed: 1,
      running: 0,
      total: 3,
      failing: ['test'],
      list: [
        { name: 'test', state: 'failed', summary: null },
        { name: 'lint', state: 'passed', summary: null },
        { name: 'docs', state: 'skipped', summary: null },
      ],
    })
    assert.strictEqual(checksOf('a', [check('lint', 'passed')]).outcome, 'passed')
    assert.strictEqual(checksLine(checksOf('a', [])), 'No checks have run.')
    assert.strictEqual(checksLine(checksOf('a', [check('lint', 'passed')])), 'Checks: 1 passed, 0 failed, 0 running.')
    assert.strictEqual(
      checksLine(checksOf('a', [check('test', 'failed'), check('e2e', 'running')])),
      'Checks: 0 passed, 1 failed, 1 running (failed: test).',
    )
  })

  it('names it in its host’s words, and says how it stands', () => {
    assert.strictEqual(nameOf({ number: 4, words: { short: 'MR', prefix: '!' } }), 'MR !4')
    assert.strictEqual(standing({ state: 'open', draft: true }), 'draft')
    assert.strictEqual(standing({ state: 'open', draft: false }), 'open')
    assert.strictEqual(standing({ state: 'merged', draft: false }), 'merged')
  })

  it('describes it from what the steps reported', () => {
    assert.strictEqual(bodyOf({ lead: null, review: null, findings: [], issue: null }), '<sub>Opened by Charrette.</sub>')
    assert.strictEqual(
      bodyOf({ lead: '', review: { rounds: 0, verdict: null }, findings: [], issue: { key: '#12', url: 'u', sameHost: true } }),
      'Issue: #12\n\n<sub>Opened by Charrette.</sub>',
    )
    assert.strictEqual(
      bodyOf({
        lead: 'Retried the call.',
        review: { rounds: 2, verdict: 'changes_requested' },
        findings: [
          { severity: 'major', file: 'src/a.ts', line: 3, claim: 'Never stops.', state: 'fixed', response: null },
          { severity: 'nit', file: 'README.md', line: null, claim: 'Typo.', state: 'set_aside', response: 'Intended.' },
          { severity: 'minor', file: null, line: null, claim: 'Name.', state: 'open', response: null },
          { severity: 'minor', file: null, line: null, claim: 'Odd.', state: 'set_aside', response: null },
        ],
        issue: { key: 'MER-231', url: 'https://linear.app/m/issue/MER-231', sameHost: false },
      }),
      [
        'Retried the call.',
        '### Review\n\nReviewed in 2 rounds.',
        '- Fixed: major `src/a.ts:3`: Never stops.\n- Set aside: nit `README.md`: Typo. (Intended.)\n- Open: minor: Name.\n- Set aside: minor: Odd.',
        'Issue: [MER-231](https://linear.app/m/issue/MER-231)',
        '<sub>Opened by Charrette.</sub>',
      ].join('\n\n'),
    )
    assert.include(
      bodyOf({ lead: null, review: { rounds: 1, verdict: 'pass' }, findings: [], issue: null }),
      'Passed after one round of review.',
    )
  })

  it('lists what people said, with where and in which thread', () => {
    assert.strictEqual(commentLine(comment()), '- dana:\n> Seconds or a date?\n> Partners care.')
    assert.strictEqual(
      commentLine(comment({ path: 'src/limit.ts', line: 14, threadId: '40', author: { ...dana, login: 'ci', bot: true } })),
      '- ci on src/limit.ts:14 (thread 40) [bot]:\n> Seconds or a date?\n> Partners care.',
    )
    assert.strictEqual(commentLine(comment({ path: 'README.md' })), '- dana on README.md:\n> Seconds or a date?\n> Partners care.')
    assert.strictEqual(reviewLine(review()), '- dana reviewed: changes requested\n> Name it better.')
    assert.strictEqual(reviewLine(review({ verdict: 'approved', body: '' })), '- dana reviewed: approved')
    assert.strictEqual(reviewLine(review({ verdict: 'commented' })), '- dana reviewed: commented\n> Name it better.')
  })

  it('signs a reply as from Charrette, knows its signature, and reads it back without', () => {
    const reply = signed('Seconds.\n', 'Claude Code')
    assert.strictEqual(reply, 'Seconds.\n\n<sub>From Charrette, by Claude Code.</sub>')
    assert.strictEqual(signed('Seconds.', null), 'Seconds.\n\n<sub>From Charrette.</sub>')
    assert.isTrue(fromCharrette(reply))
    assert.isFalse(fromCharrette('Seconds. <sub>From Charrette</sub> said someone, mid-line\nand more'))
    assert.strictEqual(unsigned(reply), 'Seconds.')
    assert.strictEqual(unsigned('Seconds.'), 'Seconds.')
    assert.strictEqual(
      commentLine(comment({ body: reply, author: { ...dana, login: 'you' } }), 'you, through Charrette'),
      '- you, through Charrette:\n> Seconds.',
    )
    assert.strictEqual(
      outsidersLine(1),
      "One comment from people who can't write to the repository is left out. On a public repository anyone can comment; the person reads them and passes on what matters.",
    )
    assert.match(outsidersLine(3), /^3 comments from people who can't write to the repository are left out\./)
  })

  it('names files, the first few of them and how many more', () => {
    assert.strictEqual(filesLine(['a.ts']), '`a.ts`')
    assert.strictEqual(filesLine(['a', 'b', 'c', 'd'], 2), '`a`, `b` and 2 more')
  })

  it('asks a busy pull request every turn, and a quiet one every few', () => {
    const every = Duration.seconds(30)
    const minute = 60_000
    assert.isTrue(listenDue({ now: 0, polledAt: undefined, newsAt: 0, every }))
    // Something happened in the last ten minutes: every turn.
    assert.isTrue(listenDue({ now: 9 * minute, polledAt: 9 * minute - 30_000, newsAt: 0, every }))
    assert.isTrue(listenDue({ now: 9 * minute, polledAt: 9 * minute - 20_000, newsAt: 0, every }))
    assert.isFalse(listenDue({ now: 9 * minute, polledAt: 9 * minute - 10_000, newsAt: 0, every }))
    // Quiet for ten minutes: every five.
    assert.isFalse(listenDue({ now: 20 * minute, polledAt: 19 * minute, newsAt: 0, every }))
    assert.isTrue(listenDue({ now: 20 * minute, polledAt: 15 * minute, newsAt: 0, every }))
  })

  it('tells the lead what was said and what failed, and how to answer', () => {
    assert.strictEqual(
      commentForLead(comment({ path: 'a.ts', line: 1, threadId: '9' }), 'PR #1'),
      'dana commented on PR #1 on a.ts:1 (thread 9):\n> Seconds or a date?\n> Partners care.',
    )
    assert.strictEqual(commentForLead(comment(), 'PR #1'), 'dana commented on PR #1:\n> Seconds or a date?\n> Partners care.')
    assert.strictEqual(reviewForLead(review(), 'PR #1'), 'dana reviewed PR #1: changes requested.\n> Name it better.')
    assert.strictEqual(reviewForLead(review({ verdict: 'commented', body: '' }), 'PR #1'), 'dana reviewed PR #1: commented.')
    const failed = { sha: 'a', outcome: 'failed' as const, passed: 0, failed: 1, running: 0, total: 1, failing: ['test'], list: [] }
    assert.match(checksForLead(failed, 'PR #1', ['log']), /^Checks failed on PR #1: test\.\n\nlog\n\nFix what broke/)
    assert.include(answerHint, 'reply_on_pull_request')
  })
})

describe('what screens read of a pull request and what arrived', () => {
  const snapshot = {
    number: 12,
    title: 'Add a retry',
    url: 'https://github.com/m/a/pull/12',
    state: 'open',
    draft: true,
    headSha: 'abc',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    repository: ['meridian', 'api'],
    words: { noun: 'pull request', short: 'PR', prefix: '#' },
    checks: {
      sha: 'abc',
      outcome: 'failed',
      passed: 1,
      failed: 1,
      running: 0,
      total: 2,
      failing: ['test', 7],
      list: [
        { name: 'test', state: 'failed', summary: '2 failed' },
        { name: 'lint', state: 'passed', summary: null },
      ],
    },
  }

  it('reads a pull request as last seen, and makes do with less', () => {
    assert.deepStrictEqual(changeOf(snapshot, 'github', true), {
      product: 'github',
      number: 12,
      title: 'Add a retry',
      url: 'https://github.com/m/a/pull/12',
      state: 'open',
      draft: true,
      noun: 'pull request',
      short: 'PR',
      prefix: '#',
      repository: 'meridian/api',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      checks: {
        outcome: 'failed',
        passed: 1,
        failed: 1,
        running: 0,
        total: 2,
        failing: ['test'],
        list: [
          { name: 'test', state: 'failed', summary: '2 failed' },
          { name: 'lint', state: 'passed', summary: null },
        ],
      },
      head: 'abc',
      listening: true,
    })
    const bare = changeOf({ number: 1, state: 'merged', checks: { outcome: 'odd', failing: 'x' } }, 'gitlab', false)
    assert.deepInclude(bare, { noun: 'pull request', short: 'PR', prefix: '#', repository: '', additions: null, draft: false })
    assert.deepStrictEqual(bare?.checks, { outcome: 'none', passed: 0, failed: 0, running: 0, total: 0, failing: [], list: [] })
    assert.isNull(changeOf({ ...snapshot, state: 'gone' }, 'github', false))
    assert.isNull(changeOf({ ...snapshot, number: 'x' }, 'github', false))
    assert.isNull(changeOf(snapshot, 'gitea', false))
    assert.isNull(changeOf(null, 'github', false))
    assert.strictEqual(changeOf({ ...snapshot, checks: null }, 'github', false)?.checks, null)
  })

  const row = (kind: string, content: unknown) => ({
    id: 'i1',
    sequence: 1,
    kind,
    content: JSON.stringify(content),
    agentId: null,
    inputState: null,
    disposition: null,
    decision: null,
    createdAt: '2026-10-01T10:00:00.000Z',
  })

  it('reads what arrived from outside, and leaves out what it can’t place', () => {
    assert.deepStrictEqual(
      itemOf(
        row('arrival', { source: 'github', kind: 'comment', from: 'dana', where: 'PR #12', text: 'Hi', path: 'a.ts', line: 3, url: 'u' }),
      )?.content,
      {
        source: 'github',
        kind: 'comment',
        from: 'dana',
        where: 'PR #12',
        text: 'Hi',
        verdict: null,
        path: 'a.ts',
        line: 3,
        passed: null,
        failed: null,
        failing: [],
        url: 'u',
        outsider: false,
      },
    )
    assert.deepInclude(
      itemOf(row('arrival', { source: 'github', kind: 'comment', from: 'mallory', where: 'PR #12', text: 'Hi', outsider: true }))?.content,
      { outsider: true },
    )
    const checks = itemOf(row('arrival', { source: 'gitlab', kind: 'checks', where: 'MR !4', passed: 2, failed: 1, failing: ['test', 1] }))
    assert.deepInclude(checks?.content, { from: null, text: null, passed: 2, failed: 1, failing: ['test'], url: null })
    for (const verdict of ['approved', 'changes_requested', 'commented'] as const)
      assert.deepInclude(itemOf(row('arrival', { source: 'github', kind: 'review', where: 'PR #1', verdict }))?.content, { verdict })
    assert.isUndefined(itemOf(row('arrival', { source: 'gitea', kind: 'comment' })))
    assert.isUndefined(itemOf(row('arrival', { source: 'github', kind: 'shouted' })))
  })

  it('reads a message’s unfurled links, and a publish step’s pull request', () => {
    const link = {
      kind: 'issue',
      product: 'linear',
      key: 'MER-1',
      title: 't',
      url: 'u',
      status: { name: 'Todo', category: 'todo' },
      priority: null,
      container: null,
    }
    const said = itemOf(row('user_message', { text: 'See', links: [link] }))
    assert.strictEqual(said?.kind === 'user_message' && said.content.links[0]?.key, 'MER-1')
    const odd = itemOf(row('user_message', { text: 'See', links: [{ kind: 'video' }] }))
    assert.deepStrictEqual(odd?.kind === 'user_message' && odd.content.links, [])
    const published = itemOf(
      row('step_result', { step: 'publish', summary: 'Opened draft pull request #12.', change: { ...snapshot, product: 'github' } }),
    )
    assert.strictEqual(published?.kind === 'step_result' && published.content.change?.number, 12)
  })

  it('reads a call for a publish step that couldn’t reach its host', () => {
    assert.deepInclude(stuckOf({ step: 'publish', why: 'not_connected', detail: 'Connect GitHub' }), {
      step: 'publish',
      why: 'not_connected',
    })
  })
})
