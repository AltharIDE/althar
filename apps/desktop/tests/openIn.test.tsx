import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OpenIn } from '../src/renderer/shared/OpenIn'
import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

describe('opening a task’s files elsewhere', () => {
  it('is one button where Finder is all there is, and nothing where there is nothing', async () => {
    const { client } = fakeClient({ listEditors: vi.fn(async () => [{ id: 'finder', name: 'Finder' }]) })
    const view = withServices(<OpenIn taskId="t1" path="README.md" />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show in Finder' }))
    expect(client.openInEditor).toHaveBeenCalledWith({ taskId: 't1', editor: 'finder', path: 'README.md' })
    expect(screen.queryByRole('button', { name: 'Open in another editor' })).toBeNull()
    view.unmount()
    const none = fakeClient({ listEditors: vi.fn(async () => []) })
    withServices(<OpenIn taskId="t1" />, none.client)
    await waitFor(() => expect(none.client.listEditors).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens in the editor files open in, and another chosen from its menu becomes that editor', async () => {
    const { client } = fakeClient({
      listEditors: vi.fn(async () => [
        { id: 'cursor', name: 'Cursor' },
        { id: 'zed', name: 'Zed' },
        { id: 'finder', name: 'Finder' },
      ]),
    })
    const host = fakeHost({ preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, editor: 'zed' })) })
    withServices(<OpenIn taskId="t1" path="src/app.ts" line={12} />, client, host)
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Zed' }))
    expect(client.openInEditor).toHaveBeenCalledWith({ taskId: 't1', editor: 'zed', path: 'src/app.ts', line: 12 })
    expect(host.setPreference).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Open in another editor' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open in Cursor' }))
    expect(client.openInEditor).toHaveBeenLastCalledWith({ taskId: 't1', editor: 'cursor', path: 'src/app.ts', line: 12 })
    expect(host.setPreference).toHaveBeenCalledWith('editor', 'cursor')
    expect(await screen.findByRole('button', { name: 'Open in Cursor' })).toBeTruthy()
  })
})
