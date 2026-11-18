import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ChangedFile } from '@althar/contracts'

import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * A task off a Mac: its shortcuts as a PC writes them, on what it changed,
 * on sending now, and in every model's list.
 */

/* The kit reads its system once, from the preload, as it loads: say Windows before it does. */
vi.hoisted(() => {
  ;(window as { althar?: { platform?: string } }).althar = { platform: 'win32' }
})

vi.mock('@althar/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@althar/ui')>()
  const { keysFor } = await import('./mockKeys')
  return { ...actual, ...keysFor('win32') }
})

vi.mock('../src/renderer/shared/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/shared/device')>()
  return { ...actual, platform: 'win32', device: actual.deviceWords('win32') }
})

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const FILE: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }

describe('a task on Windows', () => {
  it('names its shortcuts with Ctrl', async () => {
    const base = snapshot()
    const running = {
      ...base,
      task: { ...base.task, files: [FILE] },
      session: base.session === null ? null : { ...base.session, turnRunning: true },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => running) })
    withServices(<Task />, client)
    // Its key for the changes is said where they open from: its worktree's part.
    await userEvent.click(await screen.findByRole('button', { name: /^Parts, / }))
    await userEvent.click(await screen.findByRole('button', { name: 'Worktree' }))
    expect((await screen.findByRole('button', { name: /^See the changes/ })).textContent).toContain('Ctrl+D')
    await userEvent.keyboard('{Escape}')
    // Sending now, over the turn under way.
    await userEvent.type(await screen.findByRole('textbox', { name: /^Add to the queue/ }), 'Stop there')
    expect(screen.getByRole('button', { name: /Send now/ }).textContent).toContain('Ctrl+Enter')
    // Pinning, in every model's list.
    await userEvent.click(screen.getByRole('button', { name: /^Lead: / }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    expect(within(await screen.findByRole('dialog')).getAllByText(/Ctrl\+P/).length).toBeGreaterThan(0)
  })
})
