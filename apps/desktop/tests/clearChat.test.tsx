import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ConversationView, CoordinatorSnapshot, ThreadItem } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { continued } from '../src/renderer/data/reads'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { changed, coordinatorSnapshot, fakeClient, items, streamed } from './fixtures'
import { servicesFor, useSettingsOf, withServices } from './render'

/*
 * Clearing the coordinator's chat from the project's conversation: /clear
 * asks the question on clearing the view; the
 * context ring's foot asks it on forgetting; the line where a cleared view
 * begins reads the earlier conversation or takes the clear back; and what the
 * runtime rewrote under the thread is read whole again, here and in every
 * other window.
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
  context: { used: 40_000, size: 200_000 },
  background: [],
} as const

const whole: ConversationView = { cleared: false, earlierOpen: false, from: null, clearable: true, forgettable: true, version: 1 }

const talk = (view: Partial<ConversationView> = {}, overrides: Partial<CoordinatorSnapshot> = {}) =>
  coordinatorSnapshot({
    view: { ...whole, ...view },
    items: [items.you('Where were we?'), items.says('On the retry.')],
    ...overrides,
  })

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
    />
  )
}

const modelOf = (client: ReturnType<typeof fakeClient>['client']) => {
  const services = servicesFor(client)
  return renderHook(() => useProject('p1'), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('/clear in the composer', () => {
  it('asks the same question on clearing the view, and is not said to the coordinator', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator something/ })
    await userEvent.type(composer, '/clear{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(
      within(dialog)
        .getByRole('radio', { name: /Clear only the view/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect((composer as HTMLTextAreaElement).value).toBe('')
    expect(client.send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(client.clearView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(composer)
  })

  it('clears only the view once that is pressed', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project />, client)
    await userEvent.type(await screen.findByRole('textbox', { name: /Tell the coordinator something/ }), '/clear{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(client.clearView).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear the view' }))
    await waitFor(() => expect(client.clearView).toHaveBeenCalledExactlyOnceWith('thc'))
    expect(client.forgetConversation).not.toHaveBeenCalled()
  })

  it('forgets nothing until the red button is pressed', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator something/ })
    await userEvent.type(composer, '/clear{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    await userEvent.click(within(dialog).getByRole('radio', { name: /Forget the conversation too/ }))
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Escape}')
    expect(client.forgetConversation).not.toHaveBeenCalled()
    await userEvent.type(composer, '/clear{Enter}')
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: /Forget the conversation too/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear and forget' }))
    await waitFor(() => expect(client.forgetConversation).toHaveBeenCalledExactlyOnceWith('thc'))
    expect(client.clearView).not.toHaveBeenCalled()
  })

  it('offers forgetting, with the view already clear, and says so', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => talk({ cleared: true, clearable: false }, { items: [] })),
    })
    withServices(<Project />, client)
    await userEvent.type(await screen.findByRole('textbox', { name: /Tell the coordinator something/ }), '/clear{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(
      (within(dialog).getByRole('radio', { name: /Clear only the view.*The view is already clear\./ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      within(dialog)
        .getByRole('radio', { name: /Forget the conversation too/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('does nothing where there is no conversation, and still is not said', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ view: { ...whole, clearable: false, forgettable: false } })),
    })
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator something/ })
    await userEvent.type(composer, '/clear{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(client.send).not.toHaveBeenCalled()
  })
})

describe('the context ring', () => {
  it('asks on forgetting, from its foot, before Compact', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk({}, { session })) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Context \d+% used$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Clear chat…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    // It opens on the warning, with the red button; the light kind is the way out.
    expect(
      within(dialog)
        .getByRole('radio', { name: /Forget the conversation too/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Clear and forget' })).toBeTruthy()
    expect(client.forgetConversation).not.toHaveBeenCalled()
    // The ring closed with the press elsewhere, so focus goes back to the ring.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Context \d+% used$/ }))
  })
})

describe('the line where the view was cleared', () => {
  it('offers the earlier conversation and Undo', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk({ cleared: true }, { items: [items.you('After')] })) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show earlier' }))
    await waitFor(() => expect(client.showEarlier).toHaveBeenCalledExactlyOnceWith('thc', true))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(client.undoClearView).toHaveBeenCalledExactlyOnceWith('thc'))
  })

  it('goes back to now from the earlier conversation', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => talk({ cleared: true, earlierOpen: true }, { items: [items.you('Before')] })),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Back to now' }))
    await waitFor(() => expect(client.showEarlier).toHaveBeenCalledExactlyOnceWith('thc', false))
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull()
  })

  it('is not drawn while the view is whole, or while more of the thread comes before it', async () => {
    const whole = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    const first = withServices(<Project />, whole.client)
    await screen.findByRole('textbox', { name: /Tell the coordinator something/ })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    first.unmount()
    const paged = fakeClient({ getCoordinator: vi.fn(async () => talk({ cleared: true }, { earlier: true })) })
    withServices(<Project />, paged.client)
    await screen.findByRole('textbox', { name: /Tell the coordinator something/ })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('keeps its way back with the earlier conversation open, though there is more of it to read', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => talk({ cleared: true, earlierOpen: true, from: 100 }, { earlier: true })),
    })
    withServices(<Project />, client)
    expect(await screen.findByRole('button', { name: 'Back to now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('does not take an empty cleared thread for a new project’s', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => talk({ cleared: true, clearable: false }, { items: [] })),
    })
    withServices(<Project />, client)
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.queryByText(/connect/i)).toBeNull()
  })
})

describe('the thread, rewritten under the window', () => {
  it('is read whole again once the window clears, shows earlier, undoes or forgets', async () => {
    const getCoordinator = vi.fn(async (_projectId: string, _options?: { readonly limit?: number }) => talk())
    const { client } = fakeClient({ getCoordinator })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator).not.toBeNull())
    const reads = () => getCoordinator.mock.calls.filter((call) => call[1] === undefined).length
    for (const act_ of [
      () => result.current.clearView(),
      () => result.current.showEarlier(true),
      () => result.current.undoClearView(),
      () => result.current.forgetConversation(),
    ]) {
      const before = reads()
      await act(async () => act_())
      expect(reads()).toBeGreaterThan(before)
    }
    expect(client.clearView).toHaveBeenCalledWith('thc')
    expect(client.showEarlier).toHaveBeenCalledWith('thc', true)
    expect(client.undoClearView).toHaveBeenCalledWith('thc')
    expect(client.forgetConversation).toHaveBeenCalledWith('thc')
  })

  it('is read whole again when another window did it, and the thread shows what is left', async () => {
    let now = talk()
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now) })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator?.items).toHaveLength(2))
    now = talk({ cleared: true, clearable: false }, { items: [] })
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(result.current.coordinator?.view.cleared).toBe(true))
    expect(result.current.coordinator?.items).toEqual([])
  })

  it('starts over when the view was cleared, opened on the earlier conversation, restored or forgotten, though the same items are there', () => {
    const was = talk()
    const [first, second] = was.items
    const held = { ...was, items: [first!, second!] }
    // Pages read before are kept while nothing rewrote the thread under them.
    expect(continued(held, { ...was, items: [second!] }).items).toEqual([first, second])
    // And dropped once something did: a deleted item would otherwise stay in the window.
    const rewritten = { ...was, view: { ...was.view, version: 2 }, items: [second!] }
    expect(continued(held, rewritten).items).toEqual([second])
  })
})

/** A read that stays open until it is answered. */
const deferred = <A,>() => {
  let answer: (value: A) => void = () => undefined
  const promise = new Promise<A>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}

const at = (item: ThreadItem, sequence: number): ThreadItem => ({ ...item, sequence })

describe('what the window hears of a thread whose view is cleared', () => {
  it('does not bring back an item from before the clear that its agent goes on writing', async () => {
    const streaming = at(items.says('Half of an answer', 'claude-code', 'live'), 4)
    let now = talk({}, { items: [at(items.you('Why?'), 3), streaming] })
    const getThreadItem = vi.fn(async (_threadId: string, itemId: string) =>
      itemId === 'live'
        ? at(items.says('Half of an answer, and the rest', 'claude-code', 'live'), 4)
        : at(items.says('After', 'claude-code', 'after'), 101),
    )
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now), getThreadItem })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator?.items).toHaveLength(2))
    // Cleared in another window while the agent was answering.
    now = talk({ cleared: true, from: 100, clearable: false, version: 2 }, { items: [] })
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(result.current.coordinator?.view.cleared).toBe(true))
    // The agent's next words are of an item before the mark: the view is not theirs. What it says after the mark is.
    act(() => emit(changed('thread_item', 'live', 'thc', 'p1')))
    await waitFor(() => expect(getThreadItem).toHaveBeenCalledWith('thc', 'live'))
    act(() => emit(changed('thread_item', 'after', 'thc', 'p1')))
    await waitFor(() => expect(result.current.coordinator?.items.map((item) => item.id)).toEqual(['after']))
  })

  it('keeps the earlier conversation to itself while it is open, but for what it already holds', async () => {
    const held = at(items.says('Before', 'claude-code', 'held'), 5)
    const now = talk({ cleared: true, earlierOpen: true, from: 100, version: 2 }, { items: [at(items.you('Then'), 4), held] })
    const getThreadItem = vi.fn(async (_threadId: string, itemId: string) =>
      itemId === 'new' ? at(items.says('Just said', 'claude-code', 'new'), 101) : at(items.says('Before, again', 'claude-code', itemId), 5),
    )
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now), getThreadItem })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator?.items).toHaveLength(2))
    act(() => emit(changed('thread_item', 'new', 'thc', 'p1')))
    act(() => emit(changed('thread_item', 'held', 'thc', 'p1')))
    await waitFor(() =>
      expect(result.current.coordinator?.items.some((item) => item.kind === 'agent_message' && item.content.text === 'Before, again')).toBe(
        true,
      ),
    )
    expect(getThreadItem).toHaveBeenCalledWith('thc', 'new')
    expect(result.current.coordinator?.items.map((item) => item.id)).not.toContain('new')
  })

  it('drops an earlier page that lands after the view was cleared or the conversation wiped', async () => {
    const page = deferred<CoordinatorSnapshot>()
    let now = talk({}, { earlier: true, items: [at(items.you('Newest'), 30)] })
    const getCoordinator = vi.fn(async (_projectId: string, options?: { readonly before?: number }) =>
      options?.before === undefined ? now : page.promise,
    )
    const { client, emit } = fakeClient({ getCoordinator })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator?.earlier).toBe(true))
    let paging: Promise<void> = Promise.resolve()
    act(() => {
      paging = result.current.loadEarlier(true)
    })
    // Wiped meanwhile, here or in another window: the thread is the same, and holds nothing of what the page has.
    now = talk({ forgettable: false, clearable: false, version: 2 }, { earlier: false, items: [] })
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(result.current.coordinator?.view.version).toBe(2))
    await act(async () => {
      page.answer(talk({}, { earlier: false, items: [at(items.you('Deleted words'), 2)] }))
      await paging
    })
    expect(result.current.coordinator?.items).toEqual([])
  })

  it('drops an item read that lands after the thread was wiped', async () => {
    const read = deferred<ThreadItem>()
    let now = talk({}, { items: [at(items.says('Said', 'claude-code', 'said'), 3)] })
    const getThreadItem = vi.fn(() => read.promise)
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now), getThreadItem })
    const { result } = modelOf(client)
    await waitFor(() => expect(result.current.coordinator?.items).toHaveLength(1))
    act(() => emit(changed('thread_item', 'said', 'thc', 'p1')))
    await waitFor(() => expect(getThreadItem).toHaveBeenCalled())
    now = talk({ forgettable: false, clearable: false, version: 2 }, { items: [] })
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(result.current.coordinator?.view.version).toBe(2))
    await act(async () => {
      read.answer(at(items.says('Said, late', 'claude-code', 'said'), 3))
      await Promise.resolve()
    })
    expect(result.current.coordinator?.items).toEqual([])
  })
})

describe('what the thread shows of words still being written, by its view', () => {
  /** A thread of one item after the mark, with the view as given. */
  const read = (view: Partial<ConversationView>, held: ReadonlyArray<ThreadItem> = [at(items.you('After'), 101)]) =>
    talk({ cleared: true, from: 100, clearable: false, ...view }, { items: held })

  it('does not show words of an item before the mark, and shows those after it', async () => {
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => read({})) })
    withServices(<Project />, client)
    expect(await screen.findByText('After')).toBeTruthy()
    // The thread shows the words heard last, so the one the view leaves out comes after.
    act(() => emit(streamed('new', 'Said after the clear', 'thc', 'agent_message', 'claude-code', 101)))
    act(() => emit(streamed('old', 'Said before the clear', 'thc', 'agent_message', 'claude-code', 4)))
    expect(await screen.findByText(/Said after the clear/)).toBeTruthy()
    expect(screen.queryByText(/Said before the clear/)).toBeNull()
  })

  it('takes the words away as the view is cleared mid-answer, and not again as the agent goes on', async () => {
    let now = talk({}, { items: [at(items.you('Why?'), 3)] })
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now) })
    withServices(<Project />, client)
    expect(await screen.findByText('Why?')).toBeTruthy()
    act(() => emit(streamed('live', 'Half of an answer', 'thc', 'agent_message', 'claude-code', 4)))
    expect(await screen.findByText('Half of an answer')).toBeTruthy()
    // Cleared in another window while the agent is answering.
    now = read({ version: 2 }, [])
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(screen.queryByText('Half of an answer')).toBeNull())
    act(() => emit(streamed('live', 'Half of an answer, and the rest', 'thc', 'agent_message', 'claude-code', 4)))
    act(() => emit(streamed('after', 'And a new one', 'thc', 'agent_message', 'claude-code', 101)))
    expect(await screen.findByText('And a new one')).toBeTruthy()
    expect(screen.queryByText(/Half of an answer/)).toBeNull()
  })

  it('shows only the earlier conversation’s words while it is open', async () => {
    const { client, emit } = fakeClient({
      getCoordinator: vi.fn(async () => read({ earlierOpen: true, version: 2 }, [at(items.you('Then'), 4)])),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('Then')).toBeTruthy()
    act(() => emit(streamed('early', 'Said then', 'thc', 'agent_message', 'claude-code', 5)))
    act(() => emit(streamed('late', 'Said now', 'thc', 'agent_message', 'claude-code', 101)))
    expect(await screen.findByText(/Said then/)).toBeTruthy()
    expect(screen.queryByText(/Said now/)).toBeNull()
  })

  it('takes the words away as the conversation is wiped', async () => {
    let now = talk({}, { items: [at(items.you('Why?'), 3)] })
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => now) })
    withServices(<Project />, client)
    expect(await screen.findByText('Why?')).toBeTruthy()
    act(() => emit(streamed('live', 'Half of an answer', 'thc', 'agent_message', 'claude-code', 4)))
    expect(await screen.findByText('Half of an answer')).toBeTruthy()
    now = talk({ clearable: false, forgettable: false, version: 2 }, { items: [] })
    act(() => emit(changed('thread', 'thc', 'thc', 'p1')))
    await waitFor(() => expect(screen.queryByText('Half of an answer')).toBeNull())
  })
})
