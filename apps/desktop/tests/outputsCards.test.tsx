import { cleanup, screen, within } from '@testing-library/react'
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

const show = (
  snap: ThreadSnapshot,
  props: { error?: string | null; merging?: string | null; mergeRefused?: string | null; doing?: string | null; pending?: boolean } = {},
) => {
  const handlers = {
    onAccept: vi.fn(),
    onMergeHere: vi.fn(),
    onOpenChange: vi.fn(),
    onPush: vi.fn(),
    onMarkReady: vi.fn(),
    onMarkAllReady: vi.fn(),
    onOpenFile: vi.fn(),
    onPushBranch: vi.fn(),
    onConnect: vi.fn(),
    onReplace: vi.fn(),
    onBringIn: vi.fn(),
    onShip: vi.fn(),
    onMergeWaiting: vi.fn(),
  }
  withServices(
    <Outputs
      snapshot={snap}
      pending={props.pending ?? false}
      doing={props.doing ?? null}
      error={props.error ?? null}
      merging={props.merging ?? null}
      mergeRefused={props.mergeRefused ?? null}
      {...handlers}
    />,
    fakeClient().client,
  )
  return handlers
}

describe('what a task changed, card by card', () => {
  it('offers Review and merge, or Merge now, beside Ship where commits wait for it', async () => {
    const changes = [pr('api', 1, { localHead: 'def456', unpushed: 2 })]
    const { onMergeWaiting, onShip } = show(task({ changes, held: { since: '2026-11-10T09:00:00.000Z', commits: 2 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Ship 2 commits' }))
    expect(onShip).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Review and merge' }))
    expect(onMergeWaiting).toHaveBeenLastCalledWith('review')
    await userEvent.click(screen.getByRole('button', { name: 'Other ways to merge' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge now' }))
    expect(onMergeWaiting).toHaveBeenLastCalledWith('now')
  })

  it('accepts every pull request still open in a task of several, at the head each showed, and not one merged already', async () => {
    const changes = [
      pr('api', 1),
      pr('web', 2, { head: null }),
      // Its checks not heard of yet: the others' still show.
      pr('docs', 3, { checks: null }),
      pr('infra', 4, { state: 'merged' }),
    ]
    const { onAccept } = show(task({ changes }))
    // Each its own checks; infra's merged, the rest named.
    expect(screen.getByRole('button', { name: 'api’s checks: 1 check passed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'web’s checks: 1 check passed' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^docs’s checks/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Accept and merge api, web and docs' }))
    expect(onAccept).toHaveBeenCalledWith([
      { head: 'abc123', url: 'https://github.com/meridian/api/pull/1' },
      // One whose head Althar never saw goes as none, for the host to refuse.
      { head: '', url: 'https://github.com/meridian/web/pull/2' },
      { head: 'abc123', url: 'https://github.com/meridian/docs/pull/3' },
    ])
  })

  it('shows several repositories as one track, in the order they merge, each with where it stands', () => {
    const failing = {
      outcome: 'failed' as const,
      passed: 1,
      failed: 1,
      running: 0,
      total: 2,
      failing: ['e2e:chat'],
      list: [
        { name: 'lint', state: 'passed' as const, summary: null },
        { name: 'e2e:chat', state: 'failed' as const, summary: null },
      ],
    }
    const changes = [
      pr('engine', 52, {
        product: 'gitlab',
        prefix: '!',
        url: 'https://gitlab.com/fnt/engine/-/merge_requests/52',
        repository: 'fnt/engine',
      }),
      pr('frontend', 27, {
        product: 'gitlab',
        prefix: '!',
        url: 'https://gitlab.com/fnt/frontend/-/merge_requests/27',
        repository: 'fnt/frontend',
        draft: true,
        checks: failing,
      }),
      pr('sdk', 14, { conflicts: true, target: 'develop' }),
    ]
    const files = [
      { ...FILE, path: 'engine/schema.graphql' },
      { ...FILE, path: 'frontend/app/chat/page.tsx' },
    ]
    show(task({ changes, files }))
    const [engine, frontend, sdk] = within(screen.getByRole('list', { name: 'In the order they merge' })).getAllByRole('listitem')
    // Each by its own host's words, a link to it.
    expect(within(engine as HTMLElement).getByRole('link', { name: 'Open engine !52 on GitLab' })).toBeTruthy()
    expect(within(sdk as HTMLElement).getByRole('link', { name: 'Open sdk #14 on GitHub' })).toBeTruthy()
    expect(engine?.textContent).not.toMatch(/Draft/)
    expect(frontend?.textContent).toMatch(/Draft/)
    expect(frontend?.textContent).toMatch(/e2e:chat failed/)
    expect(sdk?.textContent).toMatch(/Conflicts with develop/)
    // Its files under each repository, by their paths in it.
    expect(within(screen.getByRole('region', { name: 'frontend' })).getByText('page.tsx')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark frontend ready for review' })).toBeTruthy()
  })

  it('marks every draft ready at one press, or one of them from its menu', async () => {
    const changes = [pr('api', 1, { draft: true }), pr('web', 2, { draft: true }), pr('docs', 3)]
    const { onMarkAllReady, onMarkReady } = show(task({ phase: 'waiting', changes }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark 2 drafts ready for review' }))
    expect(onMarkAllReady).toHaveBeenCalledWith(['https://github.com/meridian/api/pull/1', 'https://github.com/meridian/web/pull/2'])
    await userEvent.click(screen.getByRole('button', { name: 'Each on its own' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark web ready for review' }))
    expect(onMarkReady).toHaveBeenCalledWith('https://github.com/meridian/web/pull/2')
  })

  it('says both where every one left is a draft, and holds the others while it works', () => {
    const changes = [pr('api', 1, { draft: true }), pr('web', 2, { draft: true })]
    show(task({ phase: 'waiting', changes }), { pending: true, doing: 'ready-all' })
    expect(screen.getByRole('button', { name: 'Mark both ready for review' }).getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: 'Each on its own' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('merges the first alone from its menu, the one the others build on', async () => {
    const { onAccept } = show(task({ changes: [pr('engine', 52), pr('frontend', 27)] }))
    await userEvent.click(screen.getByRole('button', { name: 'Each on its own' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge engine only' }))
    expect(onAccept).toHaveBeenCalledWith([{ head: 'abc123', url: 'https://github.com/meridian/engine/pull/52' }])
  })

  it('shows which merges now and which waits, and why the host refused one, on its own repository', () => {
    const changes = [pr('engine', 52), pr('frontend', 27)]
    show(task({ changes }), { pending: true, doing: 'accept', merging: 'https://github.com/meridian/engine/pull/52' })
    let [engine, frontend] = within(screen.getByRole('list', { name: 'In the order they merge' })).getAllByRole('listitem')
    expect(engine?.textContent).toMatch(/Merging into main/)
    expect(frontend?.textContent).toMatch(/Merges after engine/)
    cleanup()

    const merged = [pr('engine', 52, { state: 'merged' }), pr('frontend', 27)]
    show(task({ changes: merged }), {
      error: 'GitLab refused: main moved on.',
      mergeRefused: 'https://github.com/meridian/frontend/pull/27',
    })
    ;[engine, frontend] = within(screen.getByRole('list', { name: 'In the order they merge' })).getAllByRole('listitem')
    expect(engine?.textContent).toMatch(/Merged into main/)
    expect(frontend?.textContent).toMatch(/Not merged: GitLab refused: main moved on\./)
    expect(screen.queryByRole('alert')).toBeNull()
    // What's left, by name.
    expect(screen.getByRole('button', { name: 'Accept and merge frontend' })).toBeTruthy()
  })

  it('says one in its merge queue is there, and offers no merge while it is', () => {
    show(task({ changes: [pr('engine', 52, { queued: true }), pr('frontend', 27)] }))
    expect(screen.getByText('In the merge queue')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Accept and merge/ })).toBeNull()
  })

  it('offers Accept and merge on a stopped task whose pull request is ready as it is, and not on one stopped without', async () => {
    const stopped = { phase: 'stopped' as const, stopped: { by: 'althar' as const, at: null } }
    const { onAccept } = show(task({ ...stopped, mergeable: true, changes: [pr('api', 1)] }))
    await userEvent.click(screen.getByRole('button', { name: 'Accept and merge' }))
    expect(onAccept).toHaveBeenCalledWith([{ head: 'abc123', url: 'https://github.com/meridian/api/pull/1' }])
    cleanup()
    show(task({ ...stopped, changes: [pr('api', 1, { conflicts: true })] }))
    expect(screen.queryByRole('button', { name: 'Accept and merge' })).toBeNull()
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
    // The plan's model, named as people read it until the agent lists it ("GPT 5.2"), then as the agent does ("gpt-5.2").
    expect(screen.getByText('Changes asked by').closest('p')?.textContent).toMatch(/gpt[-\s]5\.2/i)
  })

  it('shows its review on its branch where it has no pull request yet', async () => {
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    show(task({ files: [FILE], commits: 1, here }, { items: [items.step({ step: 'review', verdict: 'pass', agentId: 'codex' })] }))
    expect(await screen.findByText(/Reviewed by/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge into main on this Mac' })).toBeTruthy()
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
