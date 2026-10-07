import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { useConnections } from '../connections/useConnections'
import { useStart } from '../start/useStart'
import { SettingsView } from './SettingsView'
import { useAppIcon } from './useAppIcon'

function Settings() {
  const navigate = useNavigate()
  // This is where agents are signed in, so each is asked again as it opens.
  return (
    <SettingsView
      model={useStart({ recheck: true })}
      connections={useConnections()}
      appIcon={useAppIcon()}
      onBack={() => void navigate({ to: '/' })}
    />
  )
}

/** Settings: the agents on this Mac and their accounts, the connections, and the app's icon. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
  pendingComponent: PagePending,
  loader: ({ context: { client, cache } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.status()), cache.fetchQuery(read.connections()), cache.fetchQuery(read.projects()))
  },
})
