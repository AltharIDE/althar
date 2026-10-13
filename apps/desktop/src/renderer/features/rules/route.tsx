import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { RulesView } from './RulesView'
import { useAgentRules } from './useAgentRules'
import { useRules } from './useRules'

function Rules() {
  const { projectId } = rulesRoute.useParams()
  const { import: importing } = rulesRoute.useSearch()
  // Another project's rules are a page of their own: nothing half typed or on its way carries over.
  return <ProjectRulesPage key={projectId} projectId={projectId} importing={importing === true} />
}

function ProjectRulesPage({ projectId, importing }: { projectId: string; importing: boolean }) {
  const navigate = useNavigate()
  return (
    <RulesView
      model={useRules(projectId)}
      agents={useAgentRules(projectId)}
      importing={importing}
      // Closed, the address no longer opens it: going back to the page doesn't open it again.
      onImportClosed={() => void navigate({ to: '/projects/$projectId/rules', params: { projectId }, search: {}, replace: true })}
      onBack={() => void navigate({ to: '/projects/$projectId', params: { projectId } })}
    />
  )
}

/** What the rules screen opens on: what the agents' own settings would add, as their offer's Review asks. */
interface RulesSearch {
  readonly import?: true
}

/** A project's rules: what agents may do without asking, and what waits for the person. */
export const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/rules',
  component: Rules,
  pendingComponent: PagePending,
  loader: ({ context: { client, cache }, params: { projectId } }) => {
    const read = reads(client)
    return readFirst(cache.fetchQuery(read.rules(projectId)), cache.fetchQuery(read.projects()), cache.fetchQuery(read.status()))
  },
  validateSearch: (search: Record<string, unknown>): RulesSearch =>
    search.import === true || search.import === 'true' ? { import: true } : {},
})
