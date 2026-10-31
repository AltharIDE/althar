import type { ChangeSummary, ChecksSummary } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { BETWEEN_AGENTS_MS, betweenAgents, byItself } from '../src/needsYou'

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

  it('is nothing of the sort once its checks are done, or it merged', () => {
    assert.isNull(byItself(change()))
    assert.isNull(byItself(change({ state: 'merged', checks: running })))
    assert.isNull(byItself(null))
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
