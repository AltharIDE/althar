import { act, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

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
})
