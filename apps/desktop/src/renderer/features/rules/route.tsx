import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { RulesView } from './RulesView'
import { useRules } from './useRules'

function Rules() {
  const { projectId } = rulesRoute.useParams()
  const navigate = useNavigate()
  return <RulesView model={useRules(projectId)} onBack={() => void navigate({ to: '/projects/$projectId', params: { projectId } })} />
}

/** A project's rules: what agents may do without asking, and what waits for the person. */
export const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/rules',
  component: Rules,
  loader: ({ context: { client, cache }, params: { projectId } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.rules(projectId)), cache.fetchQuery(read.projects()), cache.fetchQuery(read.status()))
  },
})
