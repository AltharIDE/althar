import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OpenIn } from '../src/renderer/shared/OpenIn'
import { fakeClient } from './fixtures'
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
    window.localStorage.removeItem('althar.editor')
  })
})
