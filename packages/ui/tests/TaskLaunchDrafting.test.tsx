import { act, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CODEX, OPUS } from '../src/fixtures/models'
import { TaskLaunch, type LaunchStep, type TaskLaunchProps } from '../src/coordinator/TaskLaunch/TaskLaunch'

/* A task's card from the moment its draft begins: it fills in as the coordinator writes it, with Hold its one action. */

const lead = (chosen: boolean): LaunchStep => ({ id: 'implement', label: 'Implement', agents: chosen ? [OPUS] : [], effort: 'High' })
const review = (chosen: boolean): LaunchStep => ({ id: 'review', label: 'Review', agents: chosen ? [CODEX] : [], optional: true })

const card = (more: Partial<TaskLaunchProps>) => {
  const onStart = vi.fn()
  const view = render(<TaskLaunch task="812" title="" project="Meridian" picker={() => null} onStart={onStart} {...more} />)
  return { onStart, ...view }
}

describe('a task card while it is drafted', () => {
  it('shows before anything is written, saying what it is at, with Hold and nothing to start', async () => {
    const onHeldChange = vi.fn()
    card({ steps: [lead(false), review(false)], drafting: { phase: 'writing' }, onHeldChange })
    expect(screen.getByText('Putting a team together')).toBeInTheDocument()
    expect(screen.getByText('Writing the brief')).toBeInTheDocument()
    expect(screen.getAllByText('Open seat')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull()
    expect(screen.queryByText(/Starts in/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(onHeldChange).toHaveBeenCalledWith(true)
  })

  it('fills in each step as it is chosen, and says how the work ends only once it is known', () => {
    const { rerender, onStart } = card({ title: 'Fix the VAT rate', steps: [lead(false), review(false)], drafting: { phase: 'lead' } })
    expect(screen.getByText('Fix the VAT rate')).toBeInTheDocument()
    expect(screen.getByText('Choosing a lead')).toBeInTheDocument()
    expect(screen.getByText('Choosing…')).toBeInTheDocument()
    rerender(
      <TaskLaunch
        task="812"
        title="Fix the VAT rate"
        preset="Change"
        project="Meridian"
        picker={() => null}
        onStart={onStart}
        steps={[lead(true), review(true)]}
        drafting={{ phase: 'end' }}
      />,
    )
    expect(screen.getByText('Change')).toBeInTheDocument()
    expect(screen.getByText(OPUS.short)).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText(CODEX.short)).toBeInTheDocument()
    expect(screen.getByText('Deciding…')).toBeInTheDocument()
    // Nothing in it can be changed yet: no step's picker, no ending's menu.
    expect(screen.queryByRole('button', { name: /When the work is done/ })).toBeNull()
  })

  it('held while drafted, says it waits for the person', () => {
    card({ steps: [lead(true)], drafting: { phase: 'end' }, held: true })
    expect(screen.getByText('Held · starts when you say')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull()
  })
})

describe('a plan as a roster', () => {
  it('makes a whole row its picker, and puts skipping the review in it', async () => {
    const onStepsChange = vi.fn()
    const picker = vi.fn((pick: Parameters<TaskLaunchProps['picker']>[0]) => (
      <button type="button" onClick={() => pick.skip?.onSkip()}>
        {pick.owner}
      </button>
    ))
    card({ title: 'Fix the VAT rate', defaultSteps: [lead(true), review(true)], picker, onStepsChange })
    await act(async () => {})
    // Who does each step is drawn by the row; the picker lies over it, told when it opens.
    expect(screen.getByText(OPUS.short)).toBeInTheDocument()
    const reviewPick = picker.mock.calls.map(([pick]) => pick).find((pick) => pick.step.id === 'review')
    expect(reviewPick?.skip?.label).toBe('Skip the review')
    expect(typeof reviewPick?.onOpenChange).toBe('function')
    expect(picker.mock.calls.find(([pick]) => pick.step.id === 'implement')?.[0].skip).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onStepsChange.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ id: 'implement' }),
      expect.objectContaining({ id: 'review', skipped: true }),
    ])
  })

  it('covers the whole row again once a press opens no menu: skipped, added back, its picker is the whole row', async () => {
    const picker = vi.fn((pick: Parameters<TaskLaunchProps['picker']>[0]) => (
      <button type="button" onClick={() => pick.onOpenChange(true)}>
        {pick.owner}
      </button>
    ))
    card({ title: 'Fix the VAT rate', defaultSteps: [lead(true), { ...review(true), skipped: true }], picker })
    await act(async () => {})
    const addBack = screen.getByRole('button', { name: 'Add back: Review' })
    // Pressed, its cover moves under the pointer; let go, with no menu, and Add back done.
    fireEvent.pointerDown(addBack, { clientX: 40 })
    expect(addBack.parentElement?.style.width).toBe('16px')
    fireEvent.pointerUp(window)
    fireEvent.click(addBack)
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10))
    })
    // Its picker is back, over the whole row: a press anywhere on it opens it.
    const restored = screen.getByRole('button', { name: 'Review' })
    expect(restored.parentElement?.style.width).toBe('')
    // A press dragged off and let go, no menu opening, leaves it whole too.
    fireEvent.pointerDown(restored, { clientX: 120 })
    fireEvent.pointerCancel(window)
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10))
    })
    expect(restored.parentElement?.style.width).toBe('')
  })
})

describe('a node being chosen', () => {
  const matchMedia = window.matchMedia
  afterEach(() => {
    window.matchMedia = matchMedia
    vi.useRealTimers()
  })
  const reduce = (on: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: on && query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as never
  }
  const choosing = () => document.querySelector('[data-state="choosing"]')?.innerHTML

  it("rolls makers' marks through, and with reduced motion stands still", () => {
    vi.useFakeTimers()
    reduce(false)
    const { unmount } = card({ title: 'Fix the VAT rate', steps: [lead(false)], drafting: { phase: 'lead' } })
    const first = choosing()
    act(() => vi.advanceTimersByTime(300))
    expect(choosing()).not.toBe(first)
    unmount()

    reduce(true)
    card({ title: 'Fix the VAT rate', steps: [lead(false)], drafting: { phase: 'lead' } })
    const still = choosing()
    expect(still).toBeDefined()
    act(() => vi.advanceTimersByTime(1000))
    expect(choosing()).toBe(still)
  })
})
