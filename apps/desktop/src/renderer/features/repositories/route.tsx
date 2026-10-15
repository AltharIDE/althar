import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { useConnections } from '../connections/useConnections'
import { RepositoriesView } from './RepositoriesView'
import { useRepositories } from './useRepositories'

function Repositories() {
  const { projectId } = repositoriesRoute.useParams()
  const navigate = useNavigate()
  return (
    <RepositoriesView
      model={useRepositories(projectId)}
      connections={useConnections()}
      onBack={() => void navigate({ to: '/projects/$projectId', params: { projectId } })}
    />
  )
}

/** A project's repositories: where each one's work goes, adding, leaving out, each one's role, and where a fork's pull requests open. */
export const repositoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/repositories',
  component: Repositories,
  pendingComponent: PagePending,
  loader: ({ context: { client, cache }, params: { projectId } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.repositories(projectId)), cache.fetchQuery(read.projects()))
  },
})
