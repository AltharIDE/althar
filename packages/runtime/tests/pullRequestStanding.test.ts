import type { ChangeSummary, ChecksSummary } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { finishedBy, listWords, type PullRequestFacts, sectionWords } from '../src/pullRequestStanding'

const connected = { name: 'GitHub', connected: true }
const offline = { name: 'GitHub', connected: false }
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
  diverged: null,
  ...more,
})
const facts = (
  changes: ReadonlyArray<ChangeSummary>,
  more: Partial<PullRequestFacts> & { host?: { name: string; connected: boolean } | null } = {},
): PullRequestFacts => {
  const { host = connected, ...rest } = more
  return { changes: changes.map((one) => ({ change: one, seenAt: '2026-10-01T10:00:00Z', host })), merged: [], unmerged: 0, ...rest }
}

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

  it('says a merged pull request plainly and its task finished, and a closed one as last seen', () => {
    const merged = facts([change({ number: 106, state: 'merged', draft: false, unpushed: 3 })])
    const closed = facts([change({ number: 108, state: 'closed', listening: false })])
    assert.strictEqual(listWords(merged), 'PR #106 merged')
    assert.strictEqual(listWords(closed), 'PR #108 closed, as last seen (not watched since it closed)')
    assert.strictEqual(finishedBy(merged), 'merged')
    assert.strictEqual(finishedBy(closed), null)
  })

  it('is not finished while any of its pull requests is open, or when it has none', () => {
    assert.strictEqual(finishedBy(facts([change({ state: 'merged' }), change({ number: 114 })])), null)
    assert.strictEqual(finishedBy(facts([])), null)
  })

  it('says a task merged here with no pull request, and the commits the remote lacks', () => {
    const merged: PullRequestFacts = {
      changes: [],
      merged: [{ name: 'app', branch: 'main', remote: 'origin/main', ahead: 2 }],
      unmerged: 0,
    }
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
      listWords(facts([change()], { host: offline })),
      'PR #113 draft, checks passing, as last seen (GitHub is not connected)',
    )
    assert.strictEqual(listWords(facts([change({ listening: false })])), 'PR #113 draft, checks passing, as last seen (not being watched)')
    // A finished one doesn't change again.
    assert.strictEqual(listWords(facts([change({ state: 'merged' })], { host: offline })), 'PR #113 merged')
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

  it('says a branch that parted from its pull request, rewritten here or moved on there, and what the person can do', () => {
    const rewritten = facts([change({ diverged: { kind: 'rewritten', local: 5, onPullRequest: 4 } })])
    assert.strictEqual(listWords(rewritten), 'PR #113 draft, checks passing, diverged from PR')
    assert.match(
      sectionWords(rewritten),
      /The task's branch was rewritten since it was pushed: 5 commits in place of 4 commits on the pull request, so it takes no plain push\. The person replaces its commits from the task's outputs, or has the lead merge instead\./,
    )
    const moved = facts([change({ diverged: { kind: 'moved', local: 0, onPullRequest: null } })])
    assert.strictEqual(listWords(moved), 'PR #113 draft, checks passing, diverged from PR')
    assert.match(sectionWords(moved), /The pull request has commits pushed from elsewhere that the task's branch doesn't/)
    // A finished one has nothing to push.
    assert.strictEqual(
      listWords(facts([change({ state: 'merged', diverged: { kind: 'moved', local: 0, onPullRequest: null } })])),
      'PR #113 merged',
    )
  })

  it('names failing checks from the list where the host named none, and says what still runs', () => {
    const failed = checks({
      outcome: 'failed',
      failed: 1,
      passed: 0,
      running: 1,
      list: [
        { name: 'e2e', state: 'failed', summary: null },
        { name: 'unit', state: 'running', summary: null },
      ],
    })
    assert.match(sectionWords(facts([change({ checks: failed })])), /Checks: failing \(e2e\); 0 of 2 passed, 1 pending\./)
    assert.match(
      sectionWords(facts([change({ checks: checks({ outcome: 'failed', failed: 1, passed: 1 }) })])),
      /Checks: failing; 1 of 2 passed\./,
    )
  })

  it('reads a task of several: each pull request by its repository, one merged here, and the repositories left', () => {
    const several: PullRequestFacts = {
      changes: [
        { change: change({ repository: 'acme/api', number: 7, state: 'merged', title: '', url: '' }), seenAt: null, host: connected },
        { change: change({ repository: '', number: 9, unpushed: 2 }), seenAt: null, host: null },
      ],
      merged: [{ name: 'docs', branch: 'main', remote: 'origin/main', ahead: 0 }],
      unmerged: 2,
    }
    assert.strictEqual(
      listWords(several),
      'acme/api: PR #7 merged; PR #9 draft, checks passing, 2 unpushed, as last seen (its host is not known); docs: merged locally into main, no pull request; 2 repositories with work not merged or in a pull request yet',
    )
    assert.strictEqual(
      sectionWords(several),
      [
        'Pull requests:\nacme/api: PR #7 merged\nMerged.',
        [
          'PR #9 draft, checks passing, 2 unpushed, as last seen (its host is not known): Add a retry',
          'URL: https://github.com/acme/app/pull/113',
          'Checks: passing (2 of 2).',
          "2 commits on the task's branch are not on the pull request yet; the person pushes them.",
          'Conflicts with the base: not known (Althar does not ask the host).',
          'Possibly out of date: its host is not known, so this is as last seen.',
        ].join('\n'),
        'docs: merged locally into main, no pull request',
        '2 repositories with work not merged or in a pull request yet: the task is not done.',
      ].join('\n\n'),
    )
  })

  it('reads checks pending, none and never fetched', () => {
    assert.match(
      sectionWords(facts([change({ checks: checks({ outcome: 'running', running: 1, passed: 1 }) })])),
      /Checks: pending \(1 of 2 still running/,
    )
    assert.match(sectionWords(facts([change({ checks: checks({ outcome: 'none', total: 0, passed: 0 }) })])), /Checks: none reported\./)
    assert.match(sectionWords(facts([change({ checks: null })])), /Checks: not fetched yet\./)
  })

  it('reads a merged task as finished and a closed one as possibly reopened, with when it was last updated', () => {
    assert.match(sectionWords(facts([change({ state: 'merged' })])), /Merged; last updated 2026-10-01T10:00:00Z\./)
    assert.match(sectionWords(facts([change({ state: 'merged' })])), /The task is finished \(merged\)/)
    const closed = sectionWords(facts([change({ state: 'closed', listening: false })]))
    assert.match(closed, /Closed without merging; last updated 2026-10-01T10:00:00Z\. .*may have been reopened since\./)
    assert.notMatch(closed, /The task is finished/)
  })

  it('does not call a closed pull request finished where it may have been reopened unseen', () => {
    const unseen = facts([change({ state: 'closed', listening: false })], { host: offline })
    assert.strictEqual(listWords(unseen), 'PR #113 closed, as last seen (GitHub is not connected)')
    // Connected, it is no fresher: Althar stopped asking when it saw it closed, so a reopening wouldn't show.
    const connectedClosed = facts([change({ state: 'closed', listening: false })])
    assert.strictEqual(listWords(connectedClosed), 'PR #113 closed, as last seen (not watched since it closed)')
    assert.strictEqual(finishedBy(connectedClosed), null)
    assert.notMatch(sectionWords(connectedClosed), /The task is finished/)
    assert.strictEqual(finishedBy(unseen), null)
    assert.notMatch(sectionWords(unseen), /The task is finished/)
    assert.strictEqual(finishedBy(facts([change({ state: 'closed' })], { host: null })), null)
  })

  it('does not call a task finished while a repository holds work in no pull request', () => {
    const mixed = facts([change({ slug: 'api', number: 7, state: 'merged' })], { unmerged: 1 })
    assert.strictEqual(finishedBy(mixed), null)
    assert.strictEqual(listWords(mixed), 'PR #7 merged; 1 repository with work not merged or in a pull request yet')
    const section = sectionWords(mixed)
    assert.match(section, /1 repository with work not merged or in a pull request yet: the task is not done\./)
    assert.notMatch(section, /The task is finished/)
  })

  it('judges each pull request by its own host', () => {
    const both: PullRequestFacts = {
      changes: [
        { change: change({ slug: 'web', number: 9 }), seenAt: null, host: connected },
        { change: change({ slug: 'api', number: 7, product: 'gitlab' }), seenAt: null, host: { name: 'GitLab', connected: false } },
      ],
      merged: [],
      unmerged: 0,
    }
    assert.strictEqual(
      listWords(both),
      'web: PR #9 draft, checks passing; api: PR #7 draft, checks passing, as last seen (GitLab is not connected)',
    )
  })

  it('says a task’s latest pull request first, the earlier ones of its rounds of work after it, and commits in none (ADR-034)', () => {
    const merged = change({ number: 142, state: 'merged', draft: false })
    const next = change({ number: 150 })
    const both = facts([merged, next])
    assert.strictEqual(listWords(both), 'PR #150 draft, checks passing; earlier PR #142 merged')
    assert.strictEqual(finishedBy(both), null)
    const section = sectionWords(both)
    assert.match(section, /^Pull requests, the latest first:\nPR #150 draft/)
    assert.match(section, /Earlier: PR #142 merged: Add a retry/)
    // Merged, with a commit after it in none yet: not finished, and the person opens a new pull request for it.
    const after = facts([merged], { unshipped: 1 })
    assert.strictEqual(listWords(after), 'PR #142 merged; 1 commit after its last pull request, in none yet')
    assert.strictEqual(finishedBy(after), null)
    assert.match(
      sectionWords(after),
      /1 commit on the task's branch is after its last pull request, which merged or closed, and in none yet: the person opens a new pull request for it from the task\./,
    )
    assert.notMatch(sectionWords(after), /The task is finished/)
  })

  it('says a stale open pull request may be out of date', () => {
    assert.match(
      sectionWords(facts([change()], { host: offline })),
      /Possibly out of date: GitHub is not connected, so this is as last seen\./,
    )
  })
})
