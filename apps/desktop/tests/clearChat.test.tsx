import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ConversationView, CoordinatorSnapshot } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { continued } from '../src/renderer/data/reads'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { changed, coordinatorSnapshot, fakeClient, items } from './fixtures'
import { servicesFor, useSettingsOf, withServices } from './render'

/*
 * Clearing the coordinator's chat from the project's conversation: the bar
 * above the thread and /clear ask the question on clearing the view; the
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

const whole: ConversationView = { cleared: false, earlierOpen: false, clearable: true, forgettable: true, version: 1 }

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

describe('the Coordinator bar', () => {
  it('holds Clear, which asks on clearing the view and clears only that', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project />, client)
    const bar = await screen.findByRole('region', { name: 'Coordinator' })
    await userEvent.click(within(bar).getByRole('button', { name: 'Clear' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    expect(
      within(dialog)
        .getByRole('radio', { name: /Clear only the view/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(client.clearView).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear the view' }))
    await waitFor(() => expect(client.clearView).toHaveBeenCalledExactlyOnceWith('thc'))
    expect(client.forgetConversation).not.toHaveBeenCalled()
    // The focus is back on what asked.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(within(bar).getByRole('button', { name: 'Clear' }))
  })

  it('forgets nothing until the red button is pressed', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project />, client)
    await userEvent.click(within(await screen.findByRole('region', { name: 'Coordinator' })).getByRole('button', { name: 'Clear' }))
    const dialog = await screen.findByRole('dialog', { name: 'Clear chat' })
    await userEvent.click(within(dialog).getByRole('radio', { name: /Forget the conversation too/ }))
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Escape}')
    expect(client.forgetConversation).not.toHaveBeenCalled()
    await userEvent.click(within(await screen.findByRole('region', { name: 'Coordinator' })).getByRole('button', { name: 'Clear' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: /Forget the conversation too/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear and forget' }))
    await waitFor(() => expect(client.forgetConversation).toHaveBeenCalledExactlyOnceWith('thc'))
    expect(client.clearView).not.toHaveBeenCalled()
  })

  it('is off while there is no conversation to clear', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ view: { ...whole, clearable: false, forgettable: false } })),
    })
    withServices(<Project />, client)
    expect(
      (within(await screen.findByRole('region', { name: 'Coordinator' })).getByRole('button', { name: 'Clear' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('offers forgetting, with the view already clear, and says so', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => talk({ cleared: true, clearable: false }, { items: [] })),
    })
    withServices(<Project />, client)
    await userEvent.click(within(await screen.findByRole('region', { name: 'Coordinator' })).getByRole('button', { name: 'Clear' }))
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
})

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
    await screen.findByRole('region', { name: 'Coordinator' })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    first.unmount()
    const paged = fakeClient({ getCoordinator: vi.fn(async () => talk({ cleared: true }, { earlier: true })) })
    withServices(<Project />, paged.client)
    await screen.findByRole('region', { name: 'Coordinator' })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
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
