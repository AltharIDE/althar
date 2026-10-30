import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChangedFile, ChangeSummary, ThreadSnapshot } from '@althar/contracts'

import { Outputs } from '../src/renderer/features/task/Outputs'
import { change, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task's outputs on their own: what it changed, card by card, as a task of
 * several repositories, one reviewed, one merged here and one that went back
 * to work after its pull requests show them.
 */

const FILE: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }

const task = (overrides: Partial<ThreadSnapshot['task']>, rest: Partial<ThreadSnapshot> = {}) =>
  snapshot({ session: null, ...rest, task: { ...snapshot().task, phase: 'ready', ...overrides } })

/** A pull request in a repository of the task's, open and ready unless told otherwise, with its checks passed. */
const pr = (repository: string, number: number, overrides: Partial<ChangeSummary> = {}): ChangeSummary =>
  change({
    repository: `meridian/${repository}`,
    slug: repository,
    number,
    url: `https://github.com/meridian/${repository}/pull/${number}`,
    draft: false,
    checks: {
      outcome: 'passed',
      passed: 1,
      failed: 0,
      running: 0,
      total: 1,
      failing: [],
      list: [{ name: 'test', state: 'passed', summary: null }],
    },
    ...overrides,
  })

const show = (snap: ThreadSnapshot, props: { error?: string | null } = {}) => {
  const handlers = {
    onAccept: vi.fn(),
    onMergeHere: vi.fn(),
    onOpenChange: vi.fn(),
    onPush: vi.fn(),
    onMarkReady: vi.fn(),
    onOpenFile: vi.fn(),
    onPushBranch: vi.fn(),
    onConnect: vi.fn(),
    onReplace: vi.fn(),
    onBringIn: vi.fn(),
  }
  withServices(<Outputs snapshot={snap} pending={false} error={props.error ?? null} {...handlers} />, fakeClient().client)
  return handlers
}

describe('what a task changed, card by card', () => {
  it('accepts every pull request still open in a task of several, at the head each showed, and not one merged already', async () => {
    const changes = [
      pr('api', 1),
      pr('web', 2, { head: null }),
      // Its checks not heard of yet: the others' still show.
      pr('docs', 3, { checks: null }),
      pr('infra', 4, { state: 'merged' }),
    ]
    const { onAccept } = show(task({ changes }))
    expect(screen.getByText('3 checks passed')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Accept and merge all 3' }))
    expect(onAccept).toHaveBeenCalledWith([
      { head: 'abc123', url: 'https://github.com/meridian/api/pull/1' },
      // One whose head Althar never saw goes as none, for the host to refuse.
      { head: '', url: 'https://github.com/meridian/web/pull/2' },
      { head: 'abc123', url: 'https://github.com/meridian/docs/pull/3' },
    ])
  })

  it('says who asked for changes on its last review, on the model its plan gave them', async () => {
    const reviewed = task(
      {
        changes: [pr('api', 1)],
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: 'gpt-5.2', skipped: false },
        ],
      },
      {
        items: [
          items.step({ step: 'review', verdict: 'pass', agentId: 'claude-code' }),
          items.step({ step: 'review', verdict: 'changes_requested', agentId: 'codex' }),
        ],
      },
    )
    show(reviewed)
    expect(await screen.findByText(/Changes asked by/)).toBeTruthy()
    expect(screen.getByText('Changes asked by').closest('p')?.textContent).toMatch(/gpt-5\.2/)
  })

  it('shows its review on its branch where it has no pull request yet', async () => {
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    show(task({ files: [FILE], commits: 1, here }, { items: [items.step({ step: 'review', verdict: 'pass', agentId: 'codex' })] }))
    expect(await screen.findByText(/Reviewed by/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge into main' })).toBeTruthy()
  })

  it('says a merge here with no remote has nowhere to push to, with its review and what went wrong', async () => {
    const merged = [{ repository: 'meridian', name: 'meridian', branch: 'main', remote: null, ahead: 0 }]
    show(
      task(
        { phase: 'settled', files: [FILE], commits: 1, merged },
        { items: [items.step({ step: 'review', verdict: 'pass', agentId: 'codex' })] },
      ),
      { error: 'The worktree is gone.' },
    )
    expect(await screen.findByText('Into main on this Mac. It has no remote to push to.')).toBeTruthy()
    expect(screen.getByText(/Reviewed by/)).toBeTruthy()
    expect(screen.getByText('The worktree is gone.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Push/ })).toBeNull()
  })

  it('names whose pull request parted from its branch, in a task of several', async () => {
    const changes = [pr('api', 1, { localHead: 'def456', diverged: { kind: 'moved', local: 0, onPullRequest: 2 } }), pr('web', 2)]
    const { onBringIn } = show(task({ changes }))
    expect(await screen.findByText(/^Api’s pull request has 2 commits pushed from elsewhere/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Bring in api’s pull request’s commits' }))
    expect(onBringIn).toHaveBeenCalledWith('https://github.com/meridian/api/pull/1')
  })

  it('names the earlier pull requests of each repository, and counts commits in none yet across them', async () => {
    const changes = [
      pr('api', 7, { state: 'merged' }),
      pr('api', 9, { state: 'merged' }),
      pr('web', 3, { state: 'merged' }),
      pr('docs', 5, { state: 'closed' }),
    ]
    const { onOpenChange } = show(task({ changes, unshipped: { commits: 2, add: 10, del: 2 } }))
    expect(await screen.findByText(/^Before this: api PR #7, merged on GitHub\./)).toBeTruthy()
    // In a task of several, they may be in a repository with no pull request yet: after none.
    expect(screen.getByText('2 commits aren’t in a pull request yet.')).toBeTruthy()
    expect(screen.getByText('PR #5 was closed on GitHub.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open a new draft pull request' }))
    expect(onOpenChange).toHaveBeenCalled()
  })
})
