import type { ChangeSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { change, items, snapshot } from '../../tests/fixtures'

/*
 * One task, as the runtime would give it, in each state its unpushed commits
 * can be in: the person and its lead went back and forth after its review,
 * and the lead committed three more times without pushing.
 */

export type PushStage = 'none' | 'ahead' | 'pushing' | 'pushed' | 'blocked'

export const stages: ReadonlyArray<{ readonly key: PushStage; readonly n: number; readonly name: string }> = [
  { key: 'none', n: 1, name: 'Nothing to push' },
  { key: 'ahead', n: 2, name: '3 commits to push' },
  { key: 'pushing', n: 3, name: 'Pushing' },
  { key: 'pushed', n: 4, name: 'Pushed, the count gone at once' },
  { key: 'blocked', n: 5, name: 'Can’t push: the branch was rewritten' },
]

export const URL = 'https://github.com/meridian/api/pull/214'
export const WHERE = 'PR #214'

/** The three commits not on the pull request yet, oldest first. */
export const commits = [
  { sha: '7c41e0a', subject: 'Back off exponentially between retries' },
  { sha: '2f9d3b1', subject: 'Cap the wait at Retry-After when the host sends it' },
  { sha: 'b08a6e4', subject: 'Test a 429 with a date in Retry-After' },
]

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/** Items at a time of their own, minutes ago. */
const at = (m: number, item: ThreadItem): ThreadItem => ({ ...item, createdAt: minutesAgo(m) })

const thread = (stage: PushStage): ThreadItem[] => {
  const asked = stage !== 'none'
  return [
    at(48, items.tool({ title: 'Edit src/charges/retry.ts', toolKind: 'edit' })),
    at(47, items.step({ step: 'implement', summary: 'Added a retry to charges, with a test for a 429.' })),
    at(40, items.step({ step: 'review', verdict: 'pass', summary: 'Looks right.', agentId: 'codex' })),
    at(22, items.you('Can it back off exponentially instead of a flat second? And respect Retry-After when GitHub sends a date.')),
    at(21, items.tool({ title: 'Edit src/charges/retry.ts', toolKind: 'edit' })),
    at(19, items.tool({ title: 'bun test charges', toolKind: 'execute', command: 'bun test charges', exit: 0 })),
    at(
      18,
      items.says(
        'Done. The wait now doubles from 250 ms, and a `Retry-After` header caps it, as seconds or as a date. I added a test for the date form. Committed as three commits on the branch.',
      ),
    ),
    ...(asked
      ? [
          at(
            stage === 'pushed' ? 1 : 18,
            items.push({
              url: URL,
              where: WHERE,
              head: 'b08a6e4c11',
              commits,
              count: 3,
              state: stage === 'pushed' ? 'pushed' : 'open',
              blocked: stage === 'blocked' ? 'rewritten' : null,
              moved: false,
              settledAt: stage === 'pushed' ? minutesAgo(0) : null,
            }),
          ),
        ]
      : []),
  ]
}

const pr = (stage: PushStage): ChangeSummary =>
  change({
    number: 214,
    url: URL,
    title: 'Retry charges the host rate-limits',
    draft: false,
    head: stage === 'pushed' || stage === 'none' ? 'b08a6e4c11' : '91ac2d7e55',
    localHead: 'b08a6e4c11',
    unpushed: stage === 'ahead' || stage === 'pushing' ? 3 : 0,
    diverged: stage === 'blocked' ? { kind: 'rewritten', local: 3, onPullRequest: 2 } : null,
    additions: 86,
    deletions: 14,
    changedFiles: 3,
    checks: {
      outcome: 'passed',
      passed: 3,
      failed: 0,
      running: 0,
      total: 3,
      failing: [],
      list: [
        { name: 'test', state: 'passed', summary: null },
        { name: 'lint', state: 'passed', summary: null },
        { name: 'typecheck', state: 'passed', summary: null },
      ],
    },
  })

export const snapshotAt = (stage: PushStage): ThreadSnapshot => {
  const base = snapshot()
  return snapshot({
    task: {
      ...base.task,
      title: 'Retry charges the host rate-limits',
      slug: 'retry-charges',
      branch: 'althar/retry-charges',
      phase: 'ready',
      request: 'Retry a charge when the host rate-limits us, instead of failing it.',
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      lead: { agentId: 'claude-code', model: 'opus', account: null },
      startedAt: minutesAgo(52),
      changes: [pr(stage)],
      files: [
        { path: 'src/charges/retry.ts', from: null, status: 'added', add: 58, del: 0, binary: false, uncommitted: false },
        { path: 'src/charges/charge.ts', from: null, status: 'modified', add: 9, del: 14, binary: false, uncommitted: false },
        { path: 'src/charges/retry.test.ts', from: null, status: 'added', add: 19, del: 0, binary: false, uncommitted: false },
      ],
      commits: 7,
      actions: ['stop', 'abandon'],
    },
    items: thread(stage),
  })
}

/** How many commits aren't on the pull request in a stage; the blocked ones can't go. */
export const unpushedAt = (stage: PushStage) => (stage === 'ahead' || stage === 'pushing' ? 3 : 0)
