import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { useConnections } from '../connections/useConnections'
import { useStart } from '../start/useStart'
import { SettingsView } from './SettingsView'

function Settings() {
  const navigate = useNavigate()
  return <SettingsView model={useStart()} connections={useConnections()} onBack={() => void navigate({ to: '/' })} />
}

/** Settings: the agents on this Mac and their accounts, and the connections. */
export const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings })
