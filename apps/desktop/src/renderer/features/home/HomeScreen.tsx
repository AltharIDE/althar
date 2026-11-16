import { useNavigate } from '@tanstack/react-router'
import { memo } from 'react'

import { Room } from '@althar/ui'

import { useSettingsWays } from '../settings/open'
import { useStart } from '../start/useStart'
import { HomeView } from './HomeView'
import { useHome } from './useHome'

/** The home's screen, kept while the person is elsewhere (`KeptScreens`), as they left it: scrolled where it was. */
export const HomeScreen = memo(function HomeScreen() {
  const navigate = useNavigate()
  const ways = useSettingsWays()
  return (
    <HomeView
      model={useHome()}
      start={useStart()}
      onProject={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId } })}
      onTalk={(projectId) => void navigate({ to: '/projects/$projectId', params: { projectId }, search: { room: Room.Talk } })}
      onTask={(threadId) => void navigate({ to: '/threads/$threadId', params: { threadId } })}
      onSignIn={ways.signIn}
    />
  )
})
