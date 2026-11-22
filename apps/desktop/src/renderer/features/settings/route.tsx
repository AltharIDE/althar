import { createRoute, redirect, useNavigate } from '@tanstack/react-router'

import { held, readFirst, reads } from '../../data/reads'
import { rootRoute } from '../../root'
import { PagePending } from '../../shared/Pending'
import { useStart } from '../start/useStart'
import { FIRST_SECTION, type SettingsFocus, sectionOf } from './sections'
import { SettingsPage } from './SettingsPage'

/** What the Settings tab's address can ask beyond its section: an agent to sign in again, as a signed-out agent's error asks, or one to show. */
export interface SettingsSearch {
  readonly signIn?: string
  /** Which of its accounts, where it has several and one is meant: one whose sign-in ends soon. */
  readonly account?: string
  /** An agent's tab to open, nothing started: one that isn't installed, where its Install is. */
  readonly agent?: string
  /** A setting to bring into view and light for a moment: the task folders' row, from About's Free up space. */
  readonly focus?: SettingsFocus
}

const given = (value: unknown): value is string => typeof value === 'string' && value !== ''

const settingsSearchOf = (search: Record<string, unknown>): SettingsSearch =>
  given(search.signIn)
    ? { signIn: search.signIn, ...(given(search.account) ? { account: search.account } : {}) }
    : given(search.agent)
      ? { agent: search.agent }
      : search.focus === 'task-folders'
        ? { focus: 'task-folders' }
        : {}

function Settings() {
  const { section } = settingsRoute.useParams()
  const { signIn, account, agent, focus } = settingsRoute.useSearch()
  const navigate = useNavigate()
  // The agents are signed in here, so each is asked again as the tab opens.
  const start = useStart({ recheck: true })
  return (
    <SettingsPage
      start={start}
      section={sectionOf(section) ?? FIRST_SECTION}
      {...(signIn === undefined ? {} : { signIn })}
      {...(account === undefined ? {} : { account })}
      {...(agent === undefined ? {} : { agent })}
      {...(focus === undefined ? {} : { focus })}
      onSection={(next, to) =>
        void navigate({ to: '/settings/$section', params: { section: next }, search: to === undefined ? {} : { focus: to } })
      }
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
      onWhatsNew={() => void navigate({ to: '/althar' })}
    />
  )
}

/** Althar's settings, as a tab of the window beside the home's, on one section: /settings/this-mac. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  component: Settings,
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
