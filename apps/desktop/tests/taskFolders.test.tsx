import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type TaskFolders } from '@althar/contracts'

import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient } from './fixtures'
import { withServices } from './render'

/*
 * Finished tasks' folders under Work on this computer (ADR-056): when they go,
 * the disk they take, what Clean up takes and what is held back, each with
 * why; Clean up, a folder removed by hand, a task opened from its row, and
 * what couldn't be done.
 */

const GB = 1024 ** 3

const FOLDERS: TaskFolders = {
  disk: { total: 460 * GB, used: 429 * GB },
  measuring: false,
  folders: [
    {
      taskId: 't1',
      threadId: 'th1',
      title: 'CI on Windows',
      project: 'althar',
      kind: 'merged',
      settledAt: new Date(Date.now() - 86_400_000).toISOString(),
      bytes: 2.4 * GB,
      held: null,
    },
    {
      taskId: 't2',
      threadId: 'th2',
      title: 'Prototype: collapsible board lanes',
      project: 'althar',
      kind: 'done',
      settledAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      bytes: 2.3 * GB,
      held: { why: 'uncommitted', count: 3 },
    },
  ],
}

function Settings({ onTask }: { onTask?: (threadId: string) => void }) {
  const [section, setSection] = useState<Section>('this-mac')
  return (
    <SettingsPage
      start={useStart({ recheck: true })}
      section={section}
      onSection={setSection}
      {...(onTask === undefined ? {} : { onTask })}
    />
  )
}

describe('finished tasks’ folders under Work on this computer', () => {
  it('says when they go, what could go now and what is held back, and takes another choice', async () => {
    const { client } = fakeClient({ getTaskFolders: vi.fn(async () => FOLDERS) })
    withServices(<Settings />, client)
    const page = screen.getByRole('main')
    expect(await within(page).findByText(/Reviews right away, merged after 3 days/)).toBeTruthy()
    const legend = await within(page).findByRole('button', { name: /Can go now 2\.4 GB.*Held back 2\.3 GB/ })
    await userEvent.click(within(page).getByRole('combobox', { name: 'Remove finished tasks’ folders' }))
    await userEvent.click(within(document.body).getByRole('option', { name: 'Only when I clean up' }))
    expect(client.setFolderWait).toHaveBeenLastCalledWith('never')
    expect(await within(page).findByText('Their branches stay.')).toBeTruthy()
    // The legend opens the folders, held back apart with why.
    await userEvent.click(legend)
    const held = await screen.findByRole('region', { name: 'Held back' })
    expect(within(held).getByText('Not committed')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Goes with Clean up' })).getByText('CI on Windows')).toBeTruthy()
  })

  it('cleans up, says what it freed, and removes a held-back folder by hand once asked', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({
      getTaskFolders: vi.fn(async () => FOLDERS),
      cleanUpFolders: vi.fn(async () => ({ freed: 2.1 * GB, failed: 0 })),
      removeTaskFolder: vi.fn(async () => ({ freed: 2 * GB, failed: 0 })),
    })
    withServices(<Settings onTask={onTask} />, client)
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: 'Clean up' }))
    expect(client.cleanUpFolders).toHaveBeenCalled()
    expect(await within(page).findByText('Freed 2.1 GB just now')).toBeTruthy()
    await userEvent.click(within(page).getByRole('button', { name: /Can go now/ }))
    const held = await screen.findByRole('region', { name: 'Held back' })
    await userEvent.click(within(held).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(held).getByRole('button', { name: 'Remove anyway' }))
    expect(client.removeTaskFolder).toHaveBeenLastCalledWith('t2', { why: 'uncommitted', count: 3 })
    expect(await within(page).findByText('Freed 4.1 GB just now')).toBeTruthy()
    // A row opens its task.
    await userEvent.click(within(screen.getByRole('region', { name: 'Goes with Clean up' })).getByText('CI on Windows'))
    expect(onTask).toHaveBeenCalledWith('th1')
  })

  it('says what couldn’t be done: a folder something has open, or a choice that couldn’t be kept', async () => {
    const { client } = fakeClient({
      getTaskFolders: vi.fn(async () => FOLDERS),
      cleanUpFolders: vi.fn(async () => ({ freed: 0, failed: 1 })),
      setFolderWait: vi.fn(async () => Promise.reject(new Error('disk full'))),
    })
    withServices(<Settings />, client)
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: 'Clean up' }))
    expect((await within(page).findByRole('alert')).textContent).toBe('One folder couldn’t be removed: something has it open.')
    await userEvent.click(within(page).getByRole('combobox', { name: 'Remove finished tasks’ folders' }))
    await userEvent.click(within(document.body).getByRole('option', { name: 'After a week' }))
    await waitFor(() => expect(within(page).getByRole('alert').textContent).toBe('That choice couldn’t be kept.'))
  })

  it('says it measures while sizes are still being worked out, and nothing more without folders', async () => {
    const { client } = fakeClient({ getTaskFolders: vi.fn(async () => ({ disk: null, folders: [], measuring: true })) })
    withServices(<Settings />, client)
    expect(await within(screen.getByRole('main')).findByText('Measuring…')).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Clean up' })).toBeNull()
  })

  it('gives no total while some of its folders aren’t measured, never a part of it, and one once they are', async () => {
    const [goes, held] = FOLDERS.folders
    const partly: TaskFolders = {
      ...FOLDERS,
      measuring: true,
      folders: [{ ...goes!, bytes: 0.5 * 1024 ** 2 }, { ...goes!, taskId: 't3', bytes: null }, held!],
    }
    const getTaskFolders = vi.fn(async () => partly)
    const { client } = fakeClient({ getTaskFolders })
    withServices(<Settings />, client)
    const page = screen.getByRole('main')
    expect(await within(page).findByRole('button', { name: /^Can go now Measuring…\s*Held back 2\.3 GB/ })).toBeTruthy()
    expect(within(page).queryByText(/MB/)).toBeNull()
    getTaskFolders.mockResolvedValue({ ...partly, measuring: false, folders: [partly.folders[0]!, held!] })
    expect(await within(page).findByRole('button', { name: /^Can go now under 1 MB\s*Held back 2\.3 GB/ })).toBeTruthy()
  })

  it('says so where more would be lost than it said, and reads the folders again', async () => {
    const said = 'What is in the task’s folder changed since you looked at it, so it stays. Have another look before you remove it.'
    const { client } = fakeClient({
      getTaskFolders: vi.fn(async () => FOLDERS),
      removeTaskFolder: vi.fn(async () => Promise.reject(new ApiError({ reason: 'ChangedSinceSeen', message: said }))),
    })
    withServices(<Settings />, client)
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: /Can go now/ }))
    const held = await screen.findByRole('region', { name: 'Held back' })
    await userEvent.click(within(held).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(held).getByRole('button', { name: 'Remove anyway' }))
    expect((await within(page).findByRole('alert')).textContent).toBe(said)
    await waitFor(() => expect(client.getTaskFolders).toHaveBeenCalledTimes(2))
  })

  it('says why a removal failed outright', async () => {
    const { client } = fakeClient({
      getTaskFolders: vi.fn(async () => FOLDERS),
      cleanUpFolders: vi.fn(async () => Promise.reject(new Error('gone'))),
    })
    withServices(<Settings />, client)
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: 'Clean up' }))
    expect((await within(screen.getByRole('main')).findByRole('alert')).textContent).toBe('That couldn’t be done. Try again.')
  })
})
