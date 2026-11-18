import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'

import { RunningSection } from '../src/renderer/features/projectSettings/RunningSection'
import { fakeClient, runnables } from './fixtures'
import { withServices } from './render'

/*
 * A project's settings on what it runs and where its work goes, drawn
 * before its coordinator or repositories are read. How its branches are named
 * and a task ends are its Tasks.
 */

const show = (props: Partial<Parameters<typeof RunningSection>[0]> = {}, client = fakeClient().client) =>
  withServices(
    <RunningSection projectId="p1" project="meridian" runnables={null} repositories={null} worktrees={null} {...props} />,
    client,
  )

describe('the running section', () => {
  it('lists nothing to run before the coordinator and repositories are read, and says where worktrees will be', () => {
    show()
    expect(screen.getByText('Made with its first task')).toBeTruthy()
    expect(screen.queryByText('Branch names')).toBeNull()
    expect(screen.queryByText('When a task is done')).toBeNull()
  })

  it('says where its tasks’ worktrees are', () => {
    show({ worktrees: '/Users/me/Althar/meridian' })
    expect(screen.getByText('~/Althar/meridian')).toBeTruthy()
  })

  it('says what went wrong in the list, where no dialog is open to say it', async () => {
    const client = fakeClient({
      dropRunnable: vi.fn(async () => {
        throw new ApiError({ reason: 'RunnableFailed', message: 'The runtime is restarting.' })
      }),
    }).client
    show({ runnables }, client)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Storybook' }))
    await waitFor(() => expect(screen.getByText('The runtime is restarting.')).toBeTruthy())
  })
})
