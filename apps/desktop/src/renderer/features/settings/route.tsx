import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'

import { held, readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { sectionOf } from './sections'

/** What the Settings tab's address can ask beyond its section: an agent to sign in again, as a signed-out agent's error asks, or one to show. */
export interface SettingsSearch {
  readonly signIn?: string
  /** Which of its accounts, where it has several and one is meant: one whose sign-in ends soon. */
  readonly account?: string
  /** An agent's tab to open, nothing started: one that isn't installed, where its Install is. */
  readonly agent?: string
}

const given = (value: unknown): value is string => typeof value === 'string' && value !== ''

const settingsSearchOf = (search: Record<string, unknown>): SettingsSearch =>
  given(search.signIn)
    ? { signIn: search.signIn, ...(given(search.account) ? { account: search.account } : {}) }
    : given(search.agent)
      ? { agent: search.agent }
      : {}

/** Althar's settings, as a tab of the window beside the home's, on one section: /settings/this-mac. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  // Its screen loads as the tab first opens, beside what it reads, and the router waits for both: few launches start here.
  component: lazyRouteComponent(() => import('./SettingsTab'), 'Settings'),
  pendingComponent: PagePending,
  // An old address opens where its settings went: /settings/reviews is /settings/pull-requests.
  beforeLoad: ({ params: { section } }) => {
    const moved = sectionOf(section)
    if (moved !== undefined && moved !== section) throw redirect({ to: '/settings/$section', params: { section: moved }, replace: true })
  },
  // What every section shows, and the skills too on their own section, read before it shows (ADR-014); held, at once, and read
  // again behind it where the feed said it changed, so coming back never waits on the runtime.
  loader: ({ params: { section }, context: { client, cache } }) => {
    const read = reads(client)
    return readFirst(
      held(cache, read.settings()),
      held(cache, read.connections()),
      ...(section === 'skills' ? [held(cache, read.skills())] : []),
    )
  },
  validateSearch: settingsSearchOf,
})
