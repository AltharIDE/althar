import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { Client } from '../src/renderer/data/client'
import { follow } from '../src/renderer/data/feed'
import { makeQueryClient } from '../src/renderer/data/reads'
import { type Host, type Services, ServicesProvider } from '../src/renderer/data/services'
import type { ProjectSettingsActions } from '../src/renderer/features/project/ProjectView'
import { useProjectSettings } from '../src/renderer/features/projectSettings/useProjectSettings'
import { fakeHost } from './fixtures'

/** What a window holds: the client, the host, a cache of its own and a watch on the client, from now. */
export const servicesFor = (client: Client, host: Host = fakeHost()): Services => {
  const cache = makeQueryClient()
  return { client, host, cache, feed: follow(client, cache) }
}

/** Renders a screen with the services a view model reaches for. */
export const withServices = (node: ReactNode, client: Client, host: Host = fakeHost()) =>
  render(<ServicesProvider value={servicesFor(client, host)}>{node}</ServicesProvider>)

/** A project's settings as its screen takes them, leading nowhere out of it: for a test of something else on the screen. */
export const useSettingsOf = (projectId: string): ProjectSettingsActions => ({
  model: useProjectSettings(projectId, () => undefined),
  onConnections: () => undefined,
})

/** Picks one of the Layout checks in a project's header's ⋯: a pane, to show or hide it, or which side the conversation is on. */
export const pickLayout = async (name: 'Conversation' | 'Board' | 'Conversation on the right') => {
  await userEvent.click(await screen.findByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name }))
}
