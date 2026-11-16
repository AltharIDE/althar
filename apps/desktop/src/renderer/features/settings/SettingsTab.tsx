import { useNavigate } from '@tanstack/react-router'

import { useStart } from '../start/useStart'
import { settingsRoute } from './route'
import { FIRST_SECTION, sectionOf } from './sections'
import { SettingsPage } from './SettingsPage'

/** Althar's settings in their tab: loaded as the tab first opens, beside what it reads (route.tsx), since few launches start there. */
export function Settings() {
  const { section } = settingsRoute.useParams()
  const { signIn, account, agent } = settingsRoute.useSearch()
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
      onSection={(next) => void navigate({ to: '/settings/$section', params: { section: next } })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
    />
  )
}
