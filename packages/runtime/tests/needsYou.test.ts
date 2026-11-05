import type { ChangeSummary, ChecksSummary } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { BETWEEN_AGENTS_MS, betweenAgents, byItself, isMergeable } from '../src/needsYou'

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
  draft: false,
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
  diverged: null,
  ...more,
})
const running = checks({ outcome: 'running', passed: 1, running: 1 })

describe('a ready change that goes on by itself (DEV-173)', () => {
  it('is pushing while its commits go up on their own, whatever is behind them', () => {
    assert.strictEqual(byItself(change({ unpushed: 2, pushing: { held: null } })), 'pushing')
    assert.strictEqual(byItself(change({ unpushed: 2, pushing: { held: null }, conflicts: true, checks: running })), 'pushing')
  })

  it("is the person's where its commits are theirs to push, or Althar held them", () => {
    assert.isNull(byItself(change({ unpushed: 2 })))
    assert.isNull(byItself(change({ unpushed: 2, pushing: { held: 'The lead asked you to push these.' } })))
  })

  it('has its checks running, with nothing before them', () => {
    assert.strictEqual(byItself(change({ checks: running })), 'checks_running')
    // A cancelled check Althar ran again, before its host shows it running.
    const again = checks({ outcome: 'running', list: [{ name: 'test', state: 'cancelled', summary: null }] })
    assert.strictEqual(byItself(change({ checks: again })), 'checks_running')
  })

  it("is the person's where a conflict, a failure or a parted branch comes before the checks running", () => {
    assert.isNull(byItself(change({ checks: running, conflicts: true })))
    assert.isNull(byItself(change({ checks: checks({ outcome: 'failed', failed: 1, running: 1, failing: ['test'] }) })))
    assert.isNull(byItself(change({ checks: running, diverged: { kind: 'rewritten', local: 1, onPullRequest: 1 } })))
  })

  it('is still on its way while the rest run, some failed already, where failures go to its lead', () => {
    const some = checks({ outcome: 'running', failed: 1, running: 1, failing: ['test'] })
    assert.strictEqual(byItself(change({ checks: some }), { failuresGo: true }), 'checks_running')
    // Its lead's tries spent, or nothing to tell, they are the person's; and all done, failed, they are its lead's to fix.
    assert.isNull(byItself(change({ checks: some }), { failuresGo: false }))
    assert.isNull(byItself(change({ checks: checks({ outcome: 'failed', failed: 1, failing: ['test'] }) }), { failuresGo: true }))
    assert.isNull(byItself(change({ checks: some, conflicts: true }), { failuresGo: true }))
  })

  it('is nothing of the sort once its checks are done, or it merged', () => {
    assert.isNull(byItself(change()))
    assert.isNull(byItself(change({ state: 'merged', checks: running })))
    assert.isNull(byItself(null))
  })
})

describe('a pull request that can be merged as it stands', () => {
  it('is open, not a draft, with no conflict, nothing to push and every check passed', () => {
    assert.isTrue(isMergeable(change()))
  })

  it('is not so with a check failing or running, a conflict, a draft, commits to push, a parted branch or no checks read', () => {
    assert.isFalse(isMergeable(change({ checks: checks({ outcome: 'failed', failed: 1, failing: ['test'] }) })))
    assert.isFalse(isMergeable(change({ checks: running })))
    assert.isFalse(isMergeable(change({ checks: null })))
    assert.isFalse(isMergeable(change({ conflicts: true })))
    assert.isFalse(isMergeable(change({ draft: true })))
    assert.isFalse(isMergeable(change({ unpushed: 1 })))
    assert.isFalse(isMergeable(change({ diverged: { kind: 'rewritten', local: 1, onPullRequest: 1 } })))
    assert.isFalse(isMergeable(change({ state: 'merged' })))
    assert.isFalse(isMergeable(null))
  })
})

describe('a task between agents (DEV-173)', () => {
  const ended = '2026-10-31T10:00:00.000Z'
  const at = Date.parse(ended)

  it('is between agents for a moment after its last went, then stopped', () => {
    assert.isTrue(betweenAgents(ended, at + 1_000))
    assert.isFalse(betweenAgents(ended, at + BETWEEN_AGENTS_MS))
  })

  it('is never so where no agent has worked on it', () => {
    assert.isFalse(betweenAgents(null, at))
  })
})
