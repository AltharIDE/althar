import type { Launch } from '@althar/contracts'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Runs } from '../src/renderer/features/runs/Runs'
import { fakeClient, runnables } from './fixtures'
import { servicesFor } from './render'
import { ServicesProvider } from '../src/renderer/data/services'

const launch: Launch = {
  id: 'proc_new',
  taskId: 't1',
  runnableId: 'rnbl_storybook',
  where: 'Task',
  command: 'bun storybook',
  url: 'localhost:6006',
  startedAt: '2026-10-14T09:00:00.000Z',
  ended: null,
}

const screenOf = (launches: ReadonlyArray<Launch>, onRun: () => Promise<boolean>) => (
  <Runs
    projectId="proj_1"
    project="Meridian"
    taskId="t1"
    runnables={runnables}
    launches={launches}
    now="2026-10-14T09:00:05.000Z"
    onRun={onRun}
    onStop={vi.fn()}
    onClear={vi.fn()}
  />
)

describe('a run pressed before the runtime shows its launch', () => {
  it('says starting, with nothing to stop, however long its launch takes to show, until it shows', async () => {
    const onRun = vi.fn(() => Promise.resolve(true))
    const services = servicesFor(fakeClient().client)
    const { rerender } = render(<ServicesProvider value={services}>{screenOf([], onRun)}</ServicesProvider>)
    await userEvent.click(screen.getByRole('button', { name: /^Run/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run Storybook' }))
    expect(onRun).toHaveBeenCalledTimes(1)
    // Its start has answered, and a refresh is still pending: no launch yet, and still starting.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 2_000))
    })
    const list = within(screen.getByRole('dialog'))
    expect(list.getByText('Starting…')).toBeTruthy()
    expect(list.queryByRole('button', { name: 'Stop Storybook' })).toBeNull()
    // Its launch shows: that tells it.
    rerender(<ServicesProvider value={services}>{screenOf([launch], onRun)}</ServicesProvider>)
    expect(await list.findByRole('button', { name: 'Stop Storybook' })).toBeTruthy()
  }, 15_000)

  it('lets go at once where its start was refused', async () => {
    const onRun = vi.fn(() => Promise.resolve(false))
    render(<ServicesProvider value={servicesFor(fakeClient().client)}>{screenOf([], onRun)}</ServicesProvider>)
    await userEvent.click(screen.getByRole('button', { name: /^Run/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run Storybook' }))
    expect(await screen.findByRole('button', { name: 'Run Storybook' })).toBeTruthy()
  })
})
