import { createRoute, useNavigate } from '@tanstack/react-router'

import { readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { useStart } from '../start/useStart'
import { FIRST_SECTION, isSection } from './sections'
import { SettingsPage } from './SettingsPage'

function Settings() {
  const { section } = settingsRoute.useParams()
  const navigate = useNavigate()
  // The agents are signed in here, so each is asked again as the tab opens.
  const start = useStart({ recheck: true })
  return (
    <SettingsPage
      start={start}
      section={isSection(section) ? section : FIRST_SECTION}
      onSection={(next) => void navigate({ to: '/settings/$section', params: { section: next } })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}

/** Althar's settings, as a tab of the window beside the home's, on one section: /settings/this-mac. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: Settings,
  pendingComponent: PagePending,
  // What every section shows, and the skills too on their own section, read before it shows (ADR-014).
  loader: ({ params: { section }, context: { client, cache } }) => {
    const read = reads(client)
    return readFirst(
      cache.fetchQuery(read.status()),
      cache.fetchQuery(read.settings()),
      cache.fetchQuery(read.connections()),
      ...(section === 'skills' ? [cache.fetchQuery(read.skills())] : []),
    )
  },
})
