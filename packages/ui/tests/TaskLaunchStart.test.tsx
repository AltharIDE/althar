import { act, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PLAN_432 } from '../src/fixtures/coordinator'
import { TaskEnd } from '../src/foundations/vocabulary'
import { TaskLaunch, type TaskLaunchProps } from '../src/coordinator/TaskLaunch/TaskLaunch'

/* A task's plan before it starts: counting down once seen, started once, and what happens when it is done. */

const launch = (more: Partial<TaskLaunchProps> = {}) => {
  const onStart = vi.fn()
  render(
    <TaskLaunch
      task="432"
      title="Backfill idempotency keys"
      project="Meridian"
      defaultSteps={PLAN_432}
      picker={() => null}
      onStart={onStart}
      {...more}
    />,
  )
  return onStart
}

afterEach(() => vi.useRealTimers())

describe('a plan about to start', () => {
  it('counts down a second at a time once it is seen, and starts at the last', async () => {
    vi.useFakeTimers()
    const onStart = launch({ wait: 3 })
    await act(async () => {})
    expect(screen.getByText('Starts in 3s')).toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('Starts in 2s')).toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()
    await act(async () => void vi.advanceTimersByTime(1000))
    await act(async () => void vi.advanceTimersByTime(1000))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('starts once, however often Start is pressed', () => {
    const onStart = launch()
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('says a different end is for this task only', async () => {
    const onStart = launch({ defaultHeld: true })
    await userEvent.click(screen.getByRole('button', { name: /Open a draft PR/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Push the branch only/ }))
    expect(screen.getByText('this task only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onStart).toHaveBeenCalledWith(PLAN_432, TaskEnd.PushOnly)
  })
})
