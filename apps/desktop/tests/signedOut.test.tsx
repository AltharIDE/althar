import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import type { SettingsWays } from '../src/renderer/features/settings/open'
import { coordinatorSnapshot, fakeClient, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * A coordinator whose agent is signed out says so plainly in its thread,
 * and its error leads to signing in: Sign in again opens Settings at that
 * agent's sign-in, and Try again, once it is signed in, gives the turn what
 * the person said in it again.
 */

const ways = (): SettingsWays => ({ signIn: vi.fn(), agents: vi.fn(), connections: vi.fn() })

function Project({ settingsWays }: { settingsWays: SettingsWays }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      room={Room.Talk}
      ways={settingsWays}
    />
  )
}

const signedOut = items.notice({
  severity: 'error',
  title: 'Claude Code is signed out.',
  description: 'Authentication required',
  failure: 'auth_required',
})

describe('a signed-out coordinator, in its thread', () => {
  it('leads to signing its agent in again, then trying the turn again', async () => {
    const settingsWays = ways()
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.you('What is left on the checkout?'), signedOut] })),
    })
    withServices(<Project settingsWays={settingsWays} />, client)
    expect(await screen.findByText('Claude Code is signed out.')).toBeTruthy()
    // Not the agent's raw words as the headline: they stand under it.
    expect(screen.getByText('Authentication required')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(settingsWays.signIn).toHaveBeenCalledWith('claude-code')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(client.tryAgain).toHaveBeenCalledWith('thc')
  })
})
