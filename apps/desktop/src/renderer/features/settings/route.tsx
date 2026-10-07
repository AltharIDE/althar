import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { useConnections } from '../connections/useConnections'
import { useStart } from '../start/useStart'
import { SettingsView } from './SettingsView'

function Settings() {
  const navigate = useNavigate()
  // This is where agents are signed in, so each is asked again as it opens.
  return <SettingsView model={useStart({ recheck: true })} connections={useConnections()} onBack={() => void navigate({ to: '/' })} />
}

/** Settings: the agents on this Mac and their accounts, and the connections. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
  loader: ({ context: { client, cache } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.status()), cache.fetchQuery(read.connections()), cache.fetchQuery(read.projects()))
  },
})
