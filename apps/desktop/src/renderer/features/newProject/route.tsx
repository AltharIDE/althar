import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { held, readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { draftsOf } from './draft'

/** A new project, in a tab of its own: named first, then its folders. Coming here with none being made starts one. */
export const newProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  // Its screen loads as the tab first opens, beside what it reads, and the router waits for both: few launches start here.
  component: lazyRouteComponent(() => import('./NewProjectTab'), 'NewProject'),
  pendingComponent: PagePending,
  // The projects, to say which has each ink and where each repository is already, and the code hosts connected: held, at once.
  loader: ({ context: { client, cache } }) => {
    draftsOf(client).start()
    const read = reads(client)
    return readFirst(held(cache, read.projects()), held(cache, read.connections()))
  },
})
