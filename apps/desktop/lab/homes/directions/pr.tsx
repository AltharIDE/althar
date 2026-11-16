import { Button } from '@althar/ui'
import { Launch, OpenFailed } from '@althar/ui/screens'

import { HomeButton, HomeConnections } from '../../../src/renderer/features/homes/HomeConnections'
import { showHomes } from '../../../src/renderer/features/homes/useHomes'
import s from '../../../src/renderer/features/start/Start.module.css'
import { homesFor, stateOf } from '../world'
import type { DirectionParts } from './types'

/*
 * 0 · As #982 has it: its own components, unchanged. The Homes button at
 * the bar's end (the home's name and "SSH" in a home's window), the Homes
 * dialog with its connection form, the launch while a home's window
 * connects, the open failure where it couldn't, and the held dialog over the
 * window once its connection drops.
 */

function Opening({ windowId }: { windowId: string }) {
  const state = stateOf(windowId)
  if (state.connection === 'disconnected')
    // Try again reloads the window in the app; here it connects it again.
    return <OpenFailed reason={state.problem ?? 'The home disconnected.'} onRetry={() => void homesFor(windowId).reconnect()} />
  return (
    <Launch ready={false} quick>
      {null}
    </Launch>
  )
}

function Empty() {
  return (
    <main className={s.remoteEmpty}>
      <h1>No projects on this home yet</h1>
      <p>Set up a project on the host, then reconnect. SSH access supports existing projects and task conversations.</p>
      <p>Approvals require a trusted device. File transfers and local previews are unavailable on this connection.</p>
      <Button onClick={showHomes}>Homes</Button>
    </main>
  )
}

export const pr: DirectionParts = {
  Button: HomeButton,
  Overlays: ({ host }) => <HomeConnections host={host} ready />,
  Opening,
  Empty,
}
