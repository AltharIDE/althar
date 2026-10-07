import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { useConnections } from '../connections/useConnections'
import { useStart } from '../start/useStart'
import { SettingsView } from './SettingsView'
import { useAppIcon } from './useAppIcon'

function Settings() {
  const navigate = useNavigate()
  return <SettingsView model={useStart()} connections={useConnections()} appIcon={useAppIcon()} onBack={() => void navigate({ to: '/' })} />
}

/** Settings: the agents on this Mac and their accounts, the connections, and the app's icon. */
export const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings })
