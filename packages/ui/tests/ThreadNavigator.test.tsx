import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Delivery } from '../src/foundations/vocabulary'
import { TaskFace } from '../src/thread/TaskFace/TaskFace'
import { Thread } from '../src/thread/Thread/Thread'
import { Prose, Turn } from '../src/thread/Turn/Turn'
import { You } from '../src/thread/You/You'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1500)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
})
afterEach(() => vi.restoreAllMocks())

function Conversation({ reply = 'First answer', earlier = false }: { reply?: string; earlier?: boolean }) {
  return (
    <TaskFace composer={<input aria-label="Message" />}>
      <Thread label="Chat">
        <div hidden={!earlier}>
          <You>Earlier question</You>
          <Turn voice="Agent">
            <Prose>Earlier answer</Prose>
          </Turn>
        </div>
        <You>First question</You>
        <Turn voice="Agent">
          <Prose>{reply}</Prose>
        </Turn>
        <You>Second question</You>
        <Turn voice="Agent">
          <Prose>Second answer</Prose>
        </Turn>
        <You delivery={Delivery.Queued}>Waiting to send</You>
      </Thread>
    </TaskFace>
  )
}

const navigation = () => screen.findByRole('navigation', { name: 'Conversation navigation' })

describe('conversation navigation', () => {
  it('previews a message and its answer on keyboard focus and dismisses on Escape', async () => {
    render(<Conversation />)
    const nav = await navigation()
    expect(within(nav).getAllByRole('button')).toHaveLength(2)
    const first = within(nav).getByRole('button', { name: 'Go to message 1: First question' })
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'End' })
    expect(within(nav).getAllByRole('button').at(-1)).toHaveFocus()
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Home' })
    expect(first).toHaveFocus()
    const preview = await screen.findByRole('tooltip')
    expect(preview).toHaveTextContent('First question')
    expect(preview).toHaveTextContent('First answer')
    expect(preview).not.toHaveTextContent('Second answer')
    fireEvent.keyDown(first, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('updates streaming previews and indexes earlier messages only when opened', async () => {
    const { rerender } = render(<Conversation />)
    await navigation()
    rerender(<Conversation reply="The completed answer" earlier />)
    await waitFor(() => expect(within(screen.getByRole('navigation')).getAllByRole('button')).toHaveLength(3))
    const first = screen.getByRole('button', { name: 'Go to message 2: First question' })
    act(() => first.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The completed answer')
    rerender(<Conversation reply="Another update" />)
    await waitFor(() => expect(within(screen.getByRole('navigation')).getAllByRole('button')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /Earlier question/ })).not.toBeInTheDocument()
  })

  it('jumps within its own scroller and follows which message is being read', async () => {
    const { container } = render(<Conversation />)
    const nav = await navigation()
    const first = within(nav).getByRole('button', { name: /message 1:/ })
    const second = within(nav).getByRole('button', { name: /message 2:/ })
    const prompt = screen.getByText('Second question').closest('article')
    const scroller = container.querySelector('[data-floats-host] > div > div')
    if (!(scroller instanceof HTMLElement) || !prompt) throw new Error('Conversation not mounted')
    scroller.scrollTop = 0
    vi.spyOn(prompt, 'getBoundingClientRect').mockImplementation(() => ({ top: 600 - scroller.scrollTop }) as DOMRect)
    fireEvent.scroll(scroller)
    expect(first).toHaveAttribute('aria-current', 'location')
    fireEvent.click(second)
    expect(scroller.scrollTop).toBe(570)
    fireEvent.scroll(scroller)
    expect(second).toHaveAttribute('aria-current', 'location')
    fireEvent.scroll(scroller, { target: { scrollTop: 0 } })
    expect(first).toHaveAttribute('aria-current', 'location')
  })

  it('leaves short conversations and empty chats clear', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300)
    const { rerender } = render(<Conversation />)
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    rerender(
      <TaskFace composer={null}>
        <Thread label="Empty">{null}</Thread>
      </TaskFace>,
    )
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
