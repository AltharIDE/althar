import { createRoute, useNavigate } from '@tanstack/react-router'

import { rootRoute } from '../../root'
import { AltharPage, type View } from './AltharPage'

/** What Althar's page's address can ask: Coming next rather than What's new. */
export interface AltharSearch {
  readonly view?: 'coming'
}

const altharSearchOf = (search: Record<string, unknown>): AltharSearch => (search.view === 'coming' ? { view: 'coming' } : {})

function Althar() {
  const { view } = altharRoute.useSearch()
  const navigate = useNavigate()
  return (
    <AltharPage
      view={view ?? 'new'}
      onView={(next: View) => void navigate({ to: '/althar', search: next === 'coming' ? { view: 'coming' } : {} })}
      onWay={(to) => void navigate({ to: '/settings/$section', params: { section: to } })}
    />
  )
}

/** Althar's own page, as a tab of the window beside the home's: /althar, What's new; /althar?view=coming, Coming next. */
export const altharRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/althar',
  component: Althar,
  validateSearch: altharSearchOf,
})
