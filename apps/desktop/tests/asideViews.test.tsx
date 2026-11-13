import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardTask } from '@althar/contracts'

import {
  AskInAside,
  AsideConversation,
  AsideMoveFailed,
  AsideQuote,
  AsidesBar,
  useAsideMoves,
} from '../src/renderer/features/project/Asides'
import { card, fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

describe('the conversations above a project', () => {
  it('opens and clears recent or older asides, and keeps the open older one among the tabs', async () => {
    const now = Date.parse('2026-11-12T12:00:00Z')
    const recent: BoardTask = {
      ...card(),
      taskId: 'recent',
      title: 'Retry',
      scratch: true,
      createdAt: '2026-11-12T11:00:00Z',
      state: 'active',
      settledAt: null,
      changed: null,
      here: [],
    }
    const older: BoardTask = { ...recent, taskId: 'older', title: 'Webhook', createdAt: '2026-11-01T11:00:00Z' }
    const forgotten: BoardTask = { ...older, taskId: 'forgotten', title: 'Old export' }
    const onPick = vi.fn(),
      onClear = vi.fn(),
      onNew = vi.fn()
    render(
      <AsidesBar
        scratch={[recent, older, forgotten]}
        board={[recent, older, forgotten]}
        open={{ kind: 'aside', taskId: 'older', threadId: older.threadId }}
        first={null}
        onPick={onPick}
        onClear={onClear}
        onNew={onNew}
        now={now}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Webhook' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Retry' }))
    expect(onPick).toHaveBeenLastCalledWith('recent')
    await userEvent.click(screen.getByRole('tab', { name: 'Coordinator' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
    await userEvent.click(screen.getByRole('button', { name: 'Clear Retry' }))
    expect(onClear).toHaveBeenLastCalledWith(['recent'])
    await userEvent.click(screen.getByRole('button', { name: '1 older' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear it' }))
    expect(onClear).toHaveBeenLastCalledWith(['forgotten'])
    await userEvent.click(screen.getByRole('button', { name: 'New aside' }))
    expect(onNew).toHaveBeenCalledOnce()
  })
})

describe('an aside moved to the board', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(['card', 'tab', 'neither'] as const)('flies to its %s when one is present and removes the temporary copy', async (target) => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (draw: FrameRequestCallback) => {
      draw(0)
      return 1
    })
    vi.stubGlobal('CSS', { escape: (text: string) => text })
    const finished = Promise.withResolvers<void>()
    const animate = vi.fn(() => ({ finished: finished.promise }))
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    try {
      const one: BoardTask = {
        ...card(),
        taskId: 'a1',
        title: 'Retry',
        scratch: true,
        state: 'active',
        createdAt: '2026-11-12T11:00:00Z',
        settledAt: null,
        changed: null,
        here: [],
      }
      const bar = (moved: boolean) => (
        <>
          <AsidesBar
            scratch={moved ? [] : [one]}
            board={[moved ? { ...one, scratch: false } : one]}
            open={{ kind: 'coordinator' }}
            first={null}
            onPick={vi.fn()}
            onClear={vi.fn()}
            onNew={vi.fn()}
            now={Date.parse(one.createdAt)}
          />
          {target === 'card' ? (
            <div data-move="a1">On the board</div>
          ) : target === 'tab' ? (
            <button type="button" role="tab">
              Board
            </button>
          ) : null}
        </>
      )
      const view = render(bar(false))
      view.rerender(bar(true))
      if (target === 'neither') {
        expect(animate).not.toHaveBeenCalled()
        expect(document.querySelector('[data-aside="a1"]')).toBeNull()
      } else {
        expect(animate).toHaveBeenCalledOnce()
        expect(document.body.querySelector(':scope > [data-aside="a1"]')).not.toBeNull()
        await act(async () => finished.resolve())
        expect(document.querySelector('[data-aside="a1"]')).toBeNull()
        const destination = target === 'card' ? screen.getByText('On the board') : screen.getByRole('tab', { name: 'Board' })
        expect(destination.hasAttribute('data-arrived')).toBe(true)
        act(() => {
          vi.runOnlyPendingTimers()
        })
        expect(destination.hasAttribute('data-arrived')).toBe(false)
      }
    } finally {
      if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'animate')
      else Object.defineProperty(HTMLElement.prototype, 'animate', original)
    }
  })

  it('respects reduced motion and never animates an aside that was cleared', () => {
    const original = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      Object.assign(original(query), { matches: query === '(prefers-reduced-motion: reduce)' }),
    )
    const one: BoardTask = {
      ...card(),
      taskId: 'a1',
      title: 'Retry',
      scratch: true,
      state: 'active',
      createdAt: '2026-11-12T11:00:00Z',
      settledAt: null,
      changed: null,
      here: [],
    }
    const props = {
      open: { kind: 'coordinator' } as const,
      first: null,
      onPick: vi.fn(),
      onClear: vi.fn(),
      onNew: vi.fn(),
      now: Date.parse(one.createdAt),
    }
    const view = render(<AsidesBar {...props} scratch={[one]} board={[one]} />)
    view.rerender(<AsidesBar {...props} scratch={[]} board={[{ ...one, scratch: false }]} />)
    expect(document.querySelector('[data-aside="a1"]')).toBeNull()
    view.rerender(<AsidesBar {...props} scratch={[one]} board={[one]} />)
    view.rerender(<AsidesBar {...props} scratch={[]} board={[{ ...one, phase: 'settled' }]} />)
    expect(document.querySelector('[data-aside="a1"]')).toBeNull()
  })
})

describe('an aside’s own conversation', () => {
  it.each([
    { request: '> The client retries.\n\nWhy?', first: 'Why?', note: 'Quoting the coordinator' },
    { request: null, first: '> The client retries.\n\nWhy?', note: 'Quoting the coordinator' },
    { request: null, first: 'Why?', note: /^Asked / },
  ])('shows where its first words came from: $first', async ({ request, first, note }) => {
    const thread = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ ...thread, task: { ...thread.task, scratch: true, request }, items: [items.you(first)] })),
    })
    const onMakeTask = vi.fn()
    withServices(<AsideConversation threadId="th1" onBack={vi.fn()} onOpenTask={vi.fn()} onMakeTask={onMakeTask} failed={null} />, client)
    expect(await screen.findByText(note)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Make it a task' }))
    expect(onMakeTask).toHaveBeenCalledWith('t1')
  })

  it('offers no move to the board once an aside is settled', async () => {
    const thread = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        snapshot({ ...thread, task: { ...thread.task, scratch: true, phase: 'settled' }, items: [items.you('Hi')] }),
      ),
    })
    withServices(
      <AsideConversation
        threadId="th1"
        onBack={vi.fn()}
        onOpenTask={vi.fn()}
        onMakeTask={vi.fn()}
        failed={<span>Last move refused</span>}
      />,
      client,
    )
    await screen.findByText('Last move refused')
    expect(screen.queryByRole('button', { name: 'Make it a task' })).toBeNull()
  })
})

describe('starting an aside from the coordinator’s words', () => {
  function Conversation({ onAsk }: { onAsk: (quote: string) => void }) {
    const root = useRef<HTMLDivElement>(null)
    return (
      <>
        <div ref={root}>
          <article>
            <p>It retries in two places.</p>
          </article>
          <p>The person’s words.</p>
        </div>
        <article>Another conversation.</article>
        <AskInAside within={root} onAsk={onAsk} />
      </>
    )
  }

  const select = (element: Element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.getBoundingClientRect = () => new DOMRect(10, 20, 200, 30)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(document)
  }

  it('quotes selected agent words and clears the selection once the aside takes them', async () => {
    const onAsk = vi.fn()
    render(<Conversation onAsk={onAsk} />)
    select(screen.getByText('It retries in two places.'))
    const ask = await screen.findByRole('button', { name: 'Ask in an aside' })
    // Pressing it keeps the selection in place until the quote has been taken.
    expect(fireEvent.mouseDown(ask)).toBe(false)
    expect(document.getSelection()?.toString()).toBe('It retries in two places.')
    await userEvent.click(ask)
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('It retries in two places.')
    expect(document.getSelection()?.rangeCount).toBe(0)
    expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull()
  })

  it('offers no aside for the person’s words or another conversation, and hides it on scroll or an empty selection', async () => {
    render(<Conversation onAsk={vi.fn()} />)
    select(screen.getByText('It retries in two places.'))
    await screen.findByRole('button', { name: 'Ask in an aside' })
    select(screen.getByText('The person’s words.'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull())
    select(screen.getByText('It retries in two places.'))
    await screen.findByRole('button', { name: 'Ask in an aside' })
    select(screen.getByText('Another conversation.'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull())
    select(screen.getByText('It retries in two places.'))
    await screen.findByRole('button', { name: 'Ask in an aside' })
    fireEvent.scroll(document)
    expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull()
    select(screen.getByText('It retries in two places.'))
    await screen.findByRole('button', { name: 'Ask in an aside' })
    document.getSelection()?.removeAllRanges()
    fireEvent.keyUp(document)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull())
  })

  it('caps a long quotation, and stops watching once the conversation closes', async () => {
    const onAsk = vi.fn()
    const view = render(<Conversation onAsk={onAsk} />)
    const message = screen.getByText('It retries in two places.')
    message.textContent = 'A'.repeat(700)
    select(message)
    await userEvent.click(await screen.findByRole('button', { name: 'Ask in an aside' }))
    expect(onAsk).toHaveBeenCalledWith(`${'A'.repeat(600)}…`)
    select(message)
    await screen.findByRole('button', { name: 'Ask in an aside' })
    view.unmount()
    fireEvent.keyUp(document)
    expect(screen.queryByRole('button', { name: 'Ask in an aside' })).toBeNull()
  })
})

describe('an aside’s quote and a refused move', () => {
  it('shows the quotation with a way to drop it', async () => {
    const onDrop = vi.fn()
    render(<AsideQuote quote="The client waits." onDrop={onDrop} />)
    expect(screen.getByText('The client waits.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Drop the quote' }))
    expect(onDrop).toHaveBeenCalledOnce()
  })

  it('shows why starting failed and lets the person dismiss it', async () => {
    const { client } = fakeClient()
    const { result } = renderHook(() => useAsideMoves(client, null))
    const view = render(<AsideMoveFailed moves={result.current} />)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => result.current.startFailed(new ApiError({ reason: 'conflict', message: 'The agent is signed out.' })))
    view.rerender(<AsideMoveFailed moves={result.current} />)
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t start the aside. The agent is signed out.')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    view.rerender(<AsideMoveFailed moves={result.current} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
