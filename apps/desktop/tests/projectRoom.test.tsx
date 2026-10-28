import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type CodeFound, type CoordinatorSnapshot, type WatchEvent } from '@althar/contracts'
import { Room } from '@althar/ui'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { hostNameOf, partsOf, trackersOf, trackerUrlOf } from '../src/renderer/features/project/front'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { card, change, changed, connectionList, coordinatorSnapshot, fakeClient, items } from './fixtures'
import { servicesFor, useSettingsOf, withServices } from './render'

/*
 * A project's Talk room where the rest of its tests don't go: the model
 * before the coordinator's thread is read, and what it leaves alone for
 * other projects and threads; a task's card with its issue, its earlier pull
 * requests, who holds the places it waits for, and its ending changed; the
 * composer's handover and queue when Althar doesn't take what was said; and
 * what the front page makes of trackers it can't place.
 */

const session = {
  id: 'sc',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  state: 'active',
  model: null,
  account: null,
  effort: null,
  models: [],
  turnRunning: false,
  turnStartedAt: null,
  turnEndedAt: null,
  held: true,
  context: null,
  background: [],
} as const

const modelOf = (client: Client) => {
  const services = servicesFor(client)
  return renderHook(() => useProject('p1'), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

function Project({ onTask = vi.fn(), room }: { onTask?: (threadId: string) => void; room?: Room }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={onTask}
      {...(room === undefined ? {} : { room })}
    />
  )
}

describe('the Talk room’s model, before the coordinator’s thread is read', () => {
  it('says, stops, compacts and takes back nothing, and shows the thread from the first head it reads', async () => {
    // The thread's first read never comes back; a read of its head does.
    const getCoordinator = vi.fn((_projectId: string, options?: { readonly limit?: number }) =>
      options === undefined ? new Promise<CoordinatorSnapshot>(() => undefined) : Promise.resolve(coordinatorSnapshot()),
    )
    const { client, emit } = fakeClient({ getCoordinator })
    const { result } = modelOf(client)
    // What arrives for it before then changes nothing.
    act(() => emit({ _tag: 'Launches', projectId: 'p1', launches: [] } as WatchEvent))
    act(() => emit({ _tag: 'Context', threadId: 'thc', used: 10, size: 100 } as WatchEvent))
    act(() => emit(changed('task', 't1', 'th1', 'p1')))
    await act(async () => result.current.loadEarlier())
    expect(result.current.coordinator).toBeNull()
    expect(await act(async () => result.current.takeBack('i1'))).toBe(true)

    await act(async () => {
      await Promise.all([
        result.current.interrupt(),
        result.current.compact(),
        result.current.say('Hello', null),
        result.current.sayNow('Now'),
        result.current.handOver({ agentId: 'codex', model: null, effort: null }, 'Over to you'),
      ])
    })
    expect(client.interrupt).not.toHaveBeenCalled()
    expect(client.compact).not.toHaveBeenCalled()
    expect(client.send).not.toHaveBeenCalled()
    expect(client.startSession).not.toHaveBeenCalled()
    expect(client.switchAgent).not.toHaveBeenCalled()
    expect(client.getThreadItem).not.toHaveBeenCalled()
    expect(getCoordinator).toHaveBeenCalledWith('p1', { limit: 0 })
    expect(result.current.coordinator?.threadId).toBe('thc')
  })
})

describe('the Talk room’s model, once the thread is read', () => {
  const read = (overrides: Partial<CoordinatorSnapshot> = {}) => {
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot(overrides)) })
    const model = modelOf(client)
    return { client, emit, ...model }
  }

  it('compacts the coordinator’s context', async () => {
    const { client, result } = read({ session })
    await waitFor(() => expect(result.current.coordinator).not.toBeNull())
    await act(async () => result.current.compact())
    expect(client.compact).toHaveBeenCalledWith('thc')
  })

  it('leaves runs of other projects, and context said of other threads or before a session, alone', async () => {
    const launch = {
      id: 'proc_1',
      taskId: null,
      runnableId: 'rnbl_dev',
      where: 'main',
      command: 'bun run dev',
      url: null,
      startedAt: '2026-10-01T09:00:00.000Z',
      ended: null,
    }
    const { emit, result } = read()
    await waitFor(() => expect(result.current.coordinator).not.toBeNull())
    act(() => emit({ _tag: 'Launches', projectId: 'p2', launches: [launch] } as WatchEvent))
    act(() => emit({ _tag: 'Context', threadId: 'th-other', used: 10, size: 100 } as WatchEvent))
    act(() => emit({ _tag: 'Context', threadId: 'thc', used: 10, size: 100 } as WatchEvent))
    expect(result.current.coordinator?.launches).toEqual([])
    expect(result.current.coordinator?.session).toBeNull()
    act(() => emit({ _tag: 'Launches', projectId: 'p1', launches: [launch] } as WatchEvent))
    await waitFor(() => expect(result.current.coordinator?.launches).toEqual([launch]))
  })

  it('moves no coordinator that isn’t running, and starts none for a message with no agent picked', async () => {
    const { client, result } = read()
    await waitFor(() => expect(result.current.coordinator).not.toBeNull())
    await act(async () => result.current.choose({ agentId: 'codex', model: 'gpt-5.2', effort: null }))
    expect(client.switchAgent).not.toHaveBeenCalled()
    expect(client.setModel).not.toHaveBeenCalled()
    expect(await act(async () => result.current.say('Plan it', null))).toBe(true)
    expect(client.startSession).not.toHaveBeenCalled()
    expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Plan it', disposition: 'after_current' })
  })

  it('shows a dictated message as dictated while it is on its way, and takes back nothing still on its way', async () => {
    let delivered: () => void = () => undefined
    const { client, result } = read({ session })
    vi.mocked(client.send).mockImplementation(() => new Promise<void>((resolve) => (delivered = resolve)))
    await waitFor(() => expect(result.current.coordinator).not.toBeNull())
    let said: Promise<boolean> = Promise.resolve(false)
    act(() => void (said = result.current.say('Spoken words', null, { sent: [], pictures: [], files: [], attached: [], dictated: true })))
    const shown = result.current.coordinator?.items.at(-1)
    expect(shown).toMatchObject({ kind: 'user_message', content: { text: 'Spoken words' }, input: { dictated: true } })
    expect(await act(async () => result.current.takeBack(shown?.id ?? ''))).toBe(false)
    expect(client.takeBack).not.toHaveBeenCalled()
    await act(async () => {
      delivered()
      await said
    })
    expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Spoken words', disposition: 'after_current', dictated: true })
  })
})

describe('a task’s card in the Talk room', () => {
  const talking = async (...cards: ReadonlyArray<ReturnType<typeof card>>) => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: cards.map((one, i) => items.card(one, `c${i}`)) })),
    })
    withServices(<Project />, client)
    return client
  }

  it('names the issue it came from, and its pull request after those of its earlier rounds', async () => {
    await talking(
      card({
        phase: 'running',
        step: 'implement',
        issue: { product: 'linear', key: 'MER-231', title: 'Retries', url: 'https://linear.app/acme/issue/MER-231' },
        change: change({ number: 14 }),
        earlier: [change({ number: 7 }), change({ number: 9 })],
      }),
    )
    expect(await screen.findByText('MER-231')).toBeTruthy()
    expect(screen.getByText('PR #14, after PR #7 and PR #9')).toBeTruthy()
  })

  it('says why work its lead couldn’t finish needs you', async () => {
    const why = 'The lead couldn’t resolve the conflict with main, in README.md.'
    await talking(card({ phase: 'ready', handedBack: why, plan: null }))
    expect(await screen.findByText(why)).toBeTruthy()
  })

  it('names who holds the places it waits for, and stops what one left running', async () => {
    const holders = [
      {
        taskId: 't9',
        title: 'Run the suite',
        threadId: 'th9',
        kept: true,
        running: [{ id: 'bg1', command: 'bun test --watch', url: null, startedAt: '2026-10-01T09:00:00.000Z', ended: null }],
      },
    ]
    const client = await talking(card({ phase: 'running', step: 'implement', queued: { busy: 4, atOnce: 4, holders } }))
    expect(await screen.findByRole('button', { name: /^Keeping a place/ })).toBeTruthy()
    expect(screen.queryByText(/^Held by/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Keeping a place/ }))
    const list = within(await screen.findByRole('dialog', { name: 'Keeping a place' }))
    await userEvent.click(list.getByRole('button', { name: 'Stop bun test --watch' }))
    await waitFor(() => expect(client.stopBackground).toHaveBeenCalledWith('th9', 'bg1'))
  })

  it('names who holds the places once, under the newest of several waiting tasks', async () => {
    const holders = [
      {
        taskId: 't9',
        title: 'Start the dev server',
        threadId: 'th9',
        kept: true,
        running: [{ id: 'bg1', command: 'bun dev', url: null, startedAt: '2026-10-01T09:00:00.000Z', ended: null }],
      },
    ]
    const waiting = (n: number) =>
      card({
        taskId: `w${n}`,
        threadId: `thw${n}`,
        slug: `waits-${n}`,
        phase: 'running',
        step: 'implement',
        queued: { busy: 4, atOnce: 4, holders },
      })
    const client = await talking(waiting(1), waiting(2), waiting(3))
    expect(await screen.findAllByText('Waiting: 4 of 4 agents busy on this Mac')).toHaveLength(3)
    const pills = screen.getAllByRole('button', { name: /^Keeping a place/ })
    expect(pills).toHaveLength(1)
    // It sits under the lowest card.
    const last = screen.getAllByText('Waiting: 4 of 4 agents busy on this Mac').at(-1)!
    expect(last.compareDocumentPosition(pills[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(pills[0]!)
    const list = within(await screen.findByRole('dialog', { name: 'Keeping a place' }))
    await userEvent.click(list.getByRole('button', { name: 'Stop bun dev' }))
    await waitFor(() => expect(client.stopBackground).toHaveBeenCalledWith('th9', 'bg1'))
  })

  it('shows its card alone when nobody holds a place', async () => {
    await talking(card({ phase: 'running', step: 'implement', queued: { busy: 4, atOnce: 4, holders: [] } }))
    expect(await screen.findByText('Waiting: 4 of 4 agents busy on this Mac')).toBeTruthy()
    expect(screen.queryByText(/^Held by/)).toBeNull()
  })

  it.each([
    ['none', /Push the branch only/, /Open a draft PR/, 'draft'],
    ['draft', /Open a draft PR/, /Open a PR for review/, 'ready'],
  ] as const)('changes a plan that ends in %s to end as the person picks', async (end, shown, picked, to) => {
    const client = await talking(card({ plan: { ...card().plan!, end } }))
    await userEvent.click(await screen.findByRole('button', { name: shown }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: picked }))
    await waitFor(() => expect(client.changePlan).toHaveBeenLastCalledWith('pln1', expect.any(Array), to))
  })

  it('shows the plan as the runtime has it once its copy comes back changed', async () => {
    const plan = card().plan!
    const kept = items.card(card({ plan }), 'c0')
    const { client, emit } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [kept] })),
      // The runtime kept the review after all, and gave it to Claude Code: its copy of the card has the plan so.
      getThreadItem: vi.fn(async () =>
        items.card(
          card({
            plan: { ...plan, steps: plan.steps.map((step) => (step.key === 'review' ? { ...step, agentId: 'claude-code' } : step)) },
          }),
          'c0',
        ),
      ),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(client.changePlan).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Add back' })).toBeTruthy()
    // Its copy shows once it is read again.
    act(() => emit(changed('thread_item', 'c0', 'thc')))
    await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledWith('thc', 'c0'))
    expect(await screen.findByRole('button', { name: 'Skip' }, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^gpt-5\.2-codex/ })).toBeNull()
  })
})

describe('the Talk room’s composer when Althar doesn’t take what was said', () => {
  it('keeps the agent picked to take over, with the words back in the composer', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ session: { ...session, turnRunning: true }, items: [items.tool({ status: 'in_progress' })] }),
      ),
      switchAgent: vi.fn(async () => {
        throw new ApiError({ reason: 'NoAccount', message: 'No signed-in account is available.' })
      }),
    })
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the coordinator' })
    await userEvent.click(await screen.findByRole('button', { name: 'Coordinator: Claude Code default Medium' }))
    await userEvent.click(screen.getByRole('radio', { name: /gpt-5\.2-codex, via Codex/ }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(composer, 'Plan it{Enter}')
    await waitFor(() => expect(client.switchAgent).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe('Plan it'))
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Code default when you send\./)).toBeTruthy()
  })

  it('leaves a queued message where it is when the coordinator already has it, and sends one dictated as dictated again', async () => {
    const spoken = items.you('Rename the flag', { state: 'queued', interrupting: false, dictated: true })
    const taken = items.you('Ship it', { state: 'queued', interrupting: false })
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ session: { ...session, turnRunning: true }, items: [spoken, taken, items.tool({ status: 'in_progress' })] }),
      ),
      takeBack: vi.fn(async (itemId: string) => {
        if (itemId === taken.id) throw new ApiError({ reason: 'AlreadyDelivered', message: 'The agent already has that message.' })
      }),
    })
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the coordinator' })
    const queue = screen.getByRole('region', { name: '2 queued; the coordinator reads them in order' })
    const [first, second] = within(queue).getAllByRole('button', { name: 'Edit' })
    await userEvent.click(second as HTMLElement)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('already has that message'))
    expect((composer as HTMLTextAreaElement).value).toBe('')
    await userEvent.click(first as HTMLElement)
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe('Rename the flag'))
    await userEvent.type(composer, '{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Rename the flag', disposition: 'after_current', dictated: true }),
    )
  })

  it('sends a queued message to the coordinator now, a dictated one as dictated, out of the queue', async () => {
    const spoken = items.you('Rename the flag', { state: 'queued', interrupting: false, dictated: true })
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ session: { ...session, turnRunning: true }, items: [spoken, items.tool({ status: 'in_progress' })] }),
      ),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Send now' }))
    expect(client.takeBack).toHaveBeenCalledWith(spoken.id)
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({
        threadId: 'thc',
        body: 'Rename the flag',
        disposition: 'interrupt_and_continue',
        dictated: true,
      }),
    )
  })
})

describe('a run over the coordinator’s composer', () => {
  it('opens where it answers in the person’s browser', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const launch = {
      id: 'proc_1',
      taskId: null,
      runnableId: 'rnbl_dev',
      where: 'main',
      command: 'npm run dev',
      url: 'http://localhost:5199/',
      startedAt: '2026-10-10T09:00:00.000Z',
      ended: null,
    }
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ launches: [launch] })) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Running/ }))
    const list = within(await screen.findByRole('dialog', { name: 'Running' }))
    await userEvent.click(list.getByRole('button', { name: 'Open localhost:5199' }))
    expect(open).toHaveBeenCalledWith('http://localhost:5199/', '_blank')
    open.mockRestore()
  })
})

describe('the conversation beside the board', () => {
  it('is as wide as the person left it, or as it starts where what was kept is too narrow', async () => {
    window.localStorage.setItem('althar.both', '400')
    const { client } = fakeClient()
    const kept = withServices(<Project room={Room.Both} />, client)
    expect((await screen.findByRole('separator', { name: 'Width of the conversation' })).getAttribute('aria-valuenow')).toBe('400')
    kept.unmount()
    window.localStorage.setItem('althar.both', '200')
    withServices(<Project room={Room.Both} />, client)
    expect((await screen.findByRole('separator', { name: 'Width of the conversation' })).getAttribute('aria-valuenow')).not.toBe('200')
  })

  /** The window `width` wide, the coordinator naming a file; its peek with no Open beside, and the name pressed: the panel's edge. */
  const openBeside = async (width: number) => {
    window.localStorage.removeItem('althar.both')
    window.localStorage.setItem('althar.bench', '420')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const retry: CodeFound = {
      kind: 'file',
      name: 'src/retry.ts:2',
      path: 'src/retry.ts',
      line: 2,
      byName: false,
      bytes: 40,
      lines: 3,
      content: 'text',
      changed: null,
      since: null,
    }
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.says('The retry is in `src/retry.ts:2`.')] })),
      findCode: vi.fn(async (_threadId: string, messages: ReadonlyArray<unknown>) => ({
        place: { kind: 'default' as const, repositories: [{ slug: 'meridian', name: 'meridian', branch: 'main' }] },
        messages: messages.map(() => ({ found: [retry] })),
      })),
      readCode: vi.fn(async (_threadId: string, path: string) => ({
        path,
        text: 'export function retry() {\n  return 3\n}\n',
        from: 1,
        total: 3,
        cut: false,
      })),
    })
    withServices(<Project room={Room.Both} />, client)
    const name = await screen.findByRole('button', { name: 'Open src/retry.ts:2' })
    await userEvent.hover(name)
    const peek = await screen.findByRole('dialog', { name: 'src/retry.ts:2' })
    await waitFor(() => expect(peek.textContent).toContain('return 3'))
    expect(within(peek).queryByRole('button', { name: 'Open beside' })).toBeNull()
    await userEvent.click(name)
    const panel = await screen.findByRole('complementary', { name: 'retry.ts' })
    await waitFor(() => expect(panel.textContent).toContain('return 3'))
    return within(panel.closest('[data-workbench]') as HTMLElement).getByRole('separator', { name: 'Width of the panel' })
  }

  it('opens a file the coordinator names over the board, against the conversation, as wide as it was left', async () => {
    try {
      const edge = await openBeside(1600)
      expect(edge.getAttribute('aria-valuenow')).toBe('420')
      // Dragged no wider than leaves a lane of the board beside it.
      expect(edge.getAttribute('aria-valuemax')).toBe(String(1600 - 560 - 240))
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    }
  })

  it('in a small window, opens it over the whole board to the window’s edge, not in the middle with a sliver of board beside it', async () => {
    const edge = await openBeside(1024)
    // The conversation as wide as leaves the board its room; the file, all the rest.
    expect(edge.getAttribute('aria-valuenow')).toBe(String(1024 - 544))
    expect(edge.getAttribute('aria-valuemax')).toBe(String(1024 - 544))
  })
})

describe('what the front page makes of trackers', () => {
  const issueTask = (key: string, url: string, product: 'linear' | 'jira_dc' = 'linear') => ({
    ...card(),
    state: 'done' as const,
    phase: 'settled' as const,
    createdAt: '2026-10-01T09:00:00.000Z',
    settledAt: '2026-10-01T09:00:00.000Z',
    changed: null,
    here: [],
    issue: { product, key, title: 't', url },
  })

  it('has no host for no address, and a space only where an issue’s link gives one', () => {
    expect(hostNameOf(null)).toBeNull()
    expect(trackerUrlOf('linear', 'MER', 'https://linear.app/')).toBeNull()
    expect(trackerUrlOf('jira_dc', 'OPS', 'https://jira.northwind.io/browse/OPS-12')).toBe('https://jira.northwind.io/browse/OPS')
    expect(trackerUrlOf('trello', 'ABC', 'https://trello.com/c/xyz/12-card')).toBe('https://trello.com')
  })

  it('counts a tracker whose issue’s link isn’t an address, and lists it with no host and nothing to open', () => {
    const list = { ...connectionList, products: [...connectionList.products] }
    const trackers = trackersOf([issueTask('MER-1', 'not an address'), issueTask('MER-2', 'not an address')], list)
    expect(trackers).toEqual([{ product: 'linear', at: null, key: 'MER', url: null, connections: [] }])
    const parts = partsOf({ repositories: [], names: [], host: null, trackers, open: vi.fn() })
    expect(parts).toEqual([expect.objectContaining({ id: 'tracker:linear::MER' })])
    expect(parts[0]).not.toHaveProperty('onOpen')
  })
})
