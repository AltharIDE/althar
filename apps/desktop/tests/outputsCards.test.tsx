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

  it('says what repositories beside the rest’s pull request are, what changed in each, and puts pushing them before merging here', async () => {
    const remote = { name: 'origin', branch: 'althar/fix', pushed: false, ahead: 2, newPullRequest: null }
    const here = [
      { repository: 'engine', name: 'engine', branch: 'main', head: 'abc111', commits: 2, host: null, remote },
      { repository: 'infra', name: 'infra', branch: 'main', head: 'def222', commits: 1, host: null, remote: { ...remote, ahead: 1 } },
    ]
    const files = [
      { ...FILE, path: 'engine/src/cdn.ts', add: 9, del: 3 },
      { ...FILE, path: 'engine/src/assets.ts', add: 2, del: 0 },
      { ...FILE, path: 'web/src/checkout.ts' },
    ]
    const { onMergeHere, onPushBranch } = show(
      task(
        { files, commits: 4, here, changes: [pr('web', 7)] },
        { host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } },
      ),
    )
    const card = within(screen.getByText('engine and infra: on its branch, no pull request').closest('article')!)
    // Each repository with what changed in it: its files, else its commits.
    expect(within(card.getByText('engine').closest('li')!).getByText('2 files')).toBeTruthy()
    expect(within(card.getByText('infra').closest('li')!).getByText('1 commit')).toBeTruthy()
    expect(card.getByText('3 commits not pushed')).toBeTruthy()
    expect(card.getByText('No code host for engine and infra: origin isn’t on a host Althar can open a pull request on.')).toBeTruthy()
    // The rest goes through review: pushing them comes first, merging here after, saying what it skips.
    const names = card.getAllByRole('button', { name: /^(Push to origin|Merge engine)/ }).map((button) => button.textContent)
    expect(names).toEqual(['Push to origin', 'Merge engine and infra into main on this Mac'])
    expect(card.getByText('Merging on this Mac doesn’t push, and skips review on a pull request.')).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Push to origin' }))
    expect(onPushBranch).toHaveBeenCalled()
    await userEvent.click(card.getByRole('button', { name: 'Merge engine and infra into main on this Mac' }))
    expect(onMergeHere).toHaveBeenCalled()
  })

  it('opens a pull request for repositories beside the rest’s from their own card, where Althar can, before merging them here', async () => {
    const github = { name: 'GitHub', connected: true }
    const here = [
      { repository: 'engine', name: 'engine', branch: 'main', head: 'abc111', commits: 2, host: github },
      { repository: 'infra', name: 'infra', branch: 'main', head: 'def222', commits: 0, host: null },
    ]
    const { onOpenChange } = show(
      task(
        { files: [], commits: 3, here, changes: [pr('web', 7)], unshipped: { commits: 2, add: 4, del: 1 } },
        { host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } },
      ),
    )
    const card = within(screen.getByText('engine and infra: on its branch, no pull request').closest('article')!)
    expect(within(card.getByText('engine').closest('li')!).getByText('2 commits')).toBeTruthy()
    // A count of none says nothing: no line rather than one that may not hold.
    expect(card.queryByText(/Nothing to merge|0 commits/)).toBeNull()
    // Only for the one on the connected host, by name; the other says why it has none.
    expect(card.getByText('No code host for infra: no remote Althar can open a pull request on.')).toBeTruthy()
    // Only on their card: the pull request's own doesn't offer it again.
    expect(screen.getAllByRole('button', { name: /draft pull request/ })).toHaveLength(1)
    const names = card.getAllByRole('button', { name: /^(Open|Merge)/ }).map((button) => button.textContent)
    expect(names).toEqual(['Open a draft pull request for engine', 'Merge engine and infra into main on this Mac'])
    await userEvent.click(card.getByRole('button', { name: 'Open a draft pull request for engine' }))
    expect(onOpenChange).toHaveBeenCalled()
  })

  it('leaves opening a new pull request to the merged one’s card, where its later commits would go with these', async () => {
    const remote = { name: 'origin', branch: 'althar/fix', pushed: false, ahead: 2, newPullRequest: null }
    const here = [{ repository: 'engine', name: 'engine', branch: 'main', head: 'abc111', commits: 2, host: null, remote }]
    show(
      task(
        {
          files: [],
          commits: 4,
          here,
          changes: [pr('web', 7, { state: 'merged' }), pr('api', 8)],
          unshipped: { commits: 2, add: 4, del: 1 },
        },
        { host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } },
      ),
    )
    const card = within(screen.getByText('engine: on its branch, no pull request').closest('article')!)
    // The press opens web's next pull request, not one for engine: it stays with the pull requests, under its own words.
    expect(card.queryByRole('button', { name: /pull request/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open a new draft pull request' })).toBeTruthy()
    // engine is on no host Althar knows: pushing it comes first, merging here after.
    const names = card.getAllByRole('button', { name: /^(Push|Merge)/ }).map((button) => button.textContent)
    expect(names).toEqual(['Push to origin', 'Merge engine into main on this Mac'])
    expect(card.getByText('No code host for engine: origin isn’t on a host Althar can open a pull request on.')).toBeTruthy()
  })

  it('says nothing of a host for repositories beside the rest’s pull request while their work waits for Ship', async () => {
    const github = { name: 'GitHub', connected: true }
    const here = [{ repository: 'engine', name: 'engine', branch: 'main', head: 'abc111', commits: 2, host: github }]
    show(
      task(
        {
          files: [],
          commits: 3,
          here,
          changes: [pr('web', 7)],
          unshipped: { commits: 2, add: 4, del: 1 },
          held: { since: '2026-11-09T10:00:00.000Z', commits: 2 },
        },
        { host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true } },
      ),
    )
    const card = within(screen.getByText('engine: on its branch, no pull request').closest('article')!)
    expect(card.queryByText(/No code host/)).toBeNull()
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
