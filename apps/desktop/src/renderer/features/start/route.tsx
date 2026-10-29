import { useQuery } from '@tanstack/react-query'
import { createRoute, useNavigate } from '@tanstack/react-router'

import { held, readFirst, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { rootRoute } from '../../root'
import { HomePending } from '../../shared/Pending'
import { useAccountSignIn } from '../accounts/useAccountSignIn'
import { useShown } from '../tabs/kept'
import { StartView } from './StartView'
import { useStart } from './useStart'

/**
 * The home on show: its screen is the window's own, kept while the person is
 * elsewhere and shown again as they come back (`KeptScreens`), as they left it.
 */
function ShownHome() {
  useShown({ kind: 'home' })
  return null
}

/** The first screen, before there is any project, or while the runtime doesn't answer. */
function First() {
  const navigate = useNavigate()
  const start = useStart()
  const accounts = useAccountSignIn(start)
  return (
    <StartView
      model={start}
      accounts={accounts}
      onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      home={() => <ShownHome />}
    />
  )
}

function Start() {
  const { client } = useServices()
  const projects = useQuery(reads(client).projects()).data?.projects
  return projects !== undefined && projects.length > 0 ? <ShownHome /> : <First />
}

/** Where the window starts: the first screen with no project yet, the home once there are. */
export const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Start,
  pendingComponent: HomePending,
  // The projects and the agents, and, once there are projects, the home. Only what the window has never read waits: a
  // home the person has been on shows at once, and what changed since is read behind it.
  loader: ({ context: { client, cache } }) => {
    const read = reads(client)
    return readFirst(
      held(cache, read.status()),
      held(cache, read.projects()).then(() => {
        if ((cache.getQueryData(read.projects().queryKey)?.projects.length ?? 0) > 0) return held(cache, read.home())
      }),
    )
  },
})
