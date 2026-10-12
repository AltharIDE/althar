import type { ChangeSummary, ChecksSummary } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { finishedBy, listWords, type PullRequestFacts, sectionWords } from '../src/pullRequestStanding'

const connected = { name: 'GitHub', connected: true }
const checks = (more: Partial<ChecksSummary> = {}): ChecksSummary => ({
  outcome: 'passed',
  passed: 2,
  failed: 0,
  running: 0,
  total: 2,
  failing: [],
  list: [],
  ...more,
})
const change = (more: Partial<ChangeSummary> = {}): ChangeSummary => ({
  product: 'github',
  number: 113,
  title: 'Add a retry',
  url: 'https://github.com/acme/app/pull/113',
  state: 'open',
  draft: true,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'acme/app',
  slug: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  checks: checks(),
  head: 'abc',
  listening: true,
  localHead: 'abc',
  unpushed: 0,
  ...more,
})
const facts = (changes: ReadonlyArray<ChangeSummary>, more: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  changes: changes.map((one) => ({ change: one, seenAt: '2026-10-01T10:00:00Z' })),
  merged: [],
  host: connected,
  ...more,
})

describe('how a task’s pull request is told to the coordinator', () => {
  it('says a draft with passing checks and unpushed commits in a few words', () => {
    assert.strictEqual(listWords(facts([change({ unpushed: 2 })])), 'PR #113 draft, checks passing, 2 unpushed')
  })

  it('says a pull request ready for review, and its failing and pending checks', () => {
    assert.strictEqual(listWords(facts([change({ number: 110, draft: false, checks: null })])), 'PR #110 ready for review')
    assert.strictEqual(
      listWords(facts([change({ draft: false, checks: checks({ outcome: 'failed', failed: 1, passed: 1, failing: ['lint'] }) })])),
      'PR #113 ready for review, checks failing',
    )
    assert.strictEqual(
      listWords(facts([change({ checks: checks({ outcome: 'running', running: 1, passed: 1 }) })])),
      'PR #113 draft, checks pending',
    )
  })

  it('says a merged or closed pull request plainly, and the task finished', () => {
    const merged = facts([change({ number: 106, state: 'merged', draft: false, unpushed: 3 })])
    const closed = facts([change({ number: 108, state: 'closed' })])
    assert.strictEqual(listWords(merged), 'PR #106 merged')
    assert.strictEqual(listWords(closed), 'PR #108 closed')
    assert.strictEqual(finishedBy(merged), 'merged')
    assert.strictEqual(finishedBy(closed), 'closed')
  })

  it('is not finished while any of its pull requests is open, or when it has none', () => {
    assert.strictEqual(finishedBy(facts([change({ state: 'merged' }), change({ number: 114 })])), null)
    assert.strictEqual(finishedBy(facts([])), null)
  })

  it('says a task merged here with no pull request, and the commits the remote lacks', () => {
    const merged = { changes: [], merged: [{ name: 'app', branch: 'main', remote: 'origin/main', ahead: 2 }], host: null }
    assert.strictEqual(listWords(merged), 'merged locally into main, no pull request; 2 commits not on origin/main yet')
    assert.strictEqual(finishedBy(merged), 'merged')
  })

  it('says nothing for a task with no pull request', () => {
    assert.strictEqual(listWords(facts([])), '')
    assert.strictEqual(sectionWords(facts([])), '')
  })

  it('names each repository’s pull request in a task of several', () => {
    assert.strictEqual(
      listWords(facts([change({ slug: 'api', number: 7, state: 'merged' }), change({ slug: 'web', number: 9, unpushed: 1 })])),
      'api: PR #7 merged; web: PR #9 draft, checks passing, 1 unpushed',
    )
  })

  it('says when the host is not connected or nothing watches the pull request, rather than guessing', () => {
    assert.strictEqual(
      listWords(facts([change()], { host: { name: 'GitHub', connected: false } })),
      'PR #113 draft, checks passing, as last seen (GitHub is not connected)',
    )
    assert.strictEqual(listWords(facts([change({ listening: false })])), 'PR #113 draft, checks passing, as last seen (not being watched)')
    // A finished one doesn't change again.
    assert.strictEqual(listWords(facts([change({ state: 'merged' })], { host: { name: 'GitHub', connected: false } })), 'PR #113 merged')
  })

  it('reads one task’s section: URL, checks, unpushed commits and what is not known', () => {
    const section = sectionWords(
      facts([change({ draft: false, unpushed: 1, checks: checks({ outcome: 'failed', failed: 1, passed: 1, failing: ['lint'] }) })]),
    )
    assert.match(section, /^Pull request:\nPR #113 ready for review, checks failing, 1 unpushed: Add a retry/)
    assert.match(section, /URL: https:\/\/github\.com\/acme\/app\/pull\/113/)
    assert.match(section, /Checks: failing \(lint\); 1 of 2 passed\./)
    assert.match(section, /1 commit on the task's branch is not on the pull request yet/)
    assert.match(section, /Conflicts with the base: not known/)
  })

  it('reads checks pending, none and never fetched', () => {
    assert.match(
      sectionWords(facts([change({ checks: checks({ outcome: 'running', running: 1, passed: 1 }) })])),
      /Checks: pending \(1 of 2 still running/,
    )
    assert.match(sectionWords(facts([change({ checks: checks({ outcome: 'none', total: 0, passed: 0 }) })])), /Checks: none reported\./)
    assert.match(sectionWords(facts([change({ checks: null })])), /Checks: not fetched yet\./)
  })

  it('reads a merged or closed task as finished, with when it was last updated', () => {
    assert.match(sectionWords(facts([change({ state: 'merged' })])), /Merged; last updated 2026-10-01T10:00:00Z\. The task is finished/)
    assert.match(sectionWords(facts([change({ state: 'closed' })])), /Closed without merging; last updated 2026-10-01T10:00:00Z\./)
  })

  it('says a stale open pull request may be out of date', () => {
    assert.match(
      sectionWords(facts([change()], { host: { name: 'GitHub', connected: false } })),
      /Possibly out of date: GitHub is not connected, so this is as last seen\./,
    )
  })
})
