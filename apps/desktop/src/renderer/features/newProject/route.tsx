import { createRoute } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { useConnections } from '../connections/useConnections'
import { useNewTab } from '../tabs/TabsFrame'
import { draftsOf } from './draft'
import { NewProjectView } from './NewProjectView'
import { useNewProject } from './useNewProject'

function NewProject() {
  const tab = useNewTab()
  return <NewProjectView model={useNewProject()} connections={useConnections()} onCreated={tab.made} onClose={tab.close} />
}

/** A new project, in a tab of its own: named first, then its folders. Coming here with none being made starts one. */
export const newProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  component: NewProject,
  pendingComponent: PagePending,
  // The projects, to say which has each ink and where each repository is already, and the code hosts connected.
  loader: ({ context: { client, cache } }) => {
    draftsOf(client).start()
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.projects()), cache.fetchQuery(read.connections()))
  },
})
