import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { StoreFailure } from '../src/renderer/data/services'
import { UpdateStoppedView } from '../src/renderer/features/update/UpdateStoppedView'
import { fakeHost } from './fixtures'

const failure: StoreFailure = {
  stopped: 'moving',
  backup: '~/Library/Application Support/Althar/backups/althar-0018-2026-10-11-103248.sqlite',
  reason: 'Migration "19_task_numbers" failed: Failed to prepare statement: no such column: number',
}

describe('an update that couldn’t move the store', () => {
  it('shows the copy in this system’s file manager, and offers no report until the app can send one', async () => {
    const host = fakeHost({ platform: 'win32' })
    render(<UpdateStoppedView failure={failure} host={host} />)
    screen.getByRole('heading', { name: 'This update couldn’t move your data' })
    await userEvent.click(screen.getByRole('button', { name: 'Show in File Explorer' }))
    expect(host.showBackup).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull()
  })

  it('reports what stopped the update, once the app can send a report', async () => {
    const reportProblem = vi.fn()
    render(<UpdateStoppedView failure={failure} host={fakeHost({ reportProblem })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Report this' }))
    expect(reportProblem).toHaveBeenCalledWith({ kind: 'update', reason: failure.reason })
  })
})
