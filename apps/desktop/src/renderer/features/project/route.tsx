import { createRoute } from '@tanstack/react-router'

import { held, projectReads, readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { ThreadPending } from '../../shared/Pending'
import { useShown } from '../tabs/kept'
import { projectSearchOf } from './search'

/**
 * The project on show: its screen is the window's own, kept while the
 * person is elsewhere and shown again as they come back (`KeptScreens`), as they left it.
 */
function Project() {
  const { projectId } = projectRoute.useParams()
  useShown({ kind: 'project', projectId, search: projectRoute.useSearch() })
  return null
}

/** A project: the conversation with its coordinator, the board of its work, and its settings. */
export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: Project,
  pendingComponent: ThreadPending,
  // Only what the window has never read waits: a project the person has been in shows at once, and what changed since is read behind it.
  loader: ({ context: { client, cache }, params: { projectId } }) =>
    readFirst(...projectReads(reads(client), projectId).map((options) => held(cache, options))),
  validateSearch: projectSearchOf,
})
