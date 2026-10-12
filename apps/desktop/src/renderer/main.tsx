import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, startTransition, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Launch, OpenFailed } from '@althar/ui/screens'

import { receivePort } from './data/client'
import { openWindow } from './data/open'
import { ServicesProvider, type StoreFailure } from './data/services'
import { UpdateStoppedView } from './features/update/UpdateStoppedView'

/*
 * The window's entry. The launch plays at once, while the window waits for
 * the port the main process sends and opens over it (`data/open.ts`): what
 * the place it opens on shows is read under the launch, and the app is drawn
 * whole under it before the launch opens onto it. If it can't open (no port
 * within WAIT_PORT, or connecting or the first reads fail), it says so in
 * the launch's place, and offers to try again. If an update couldn't move
 * the store, main sends that instead of a port, and the window shows it,
 * whatever it was showing.
 */

/** How long the window waits for the runtime's port before it says it couldn't open. */
const WAIT_PORT = 15_000

const text = {
  noRuntime: 'The runtime didn’t start.',
}

// Listen before anything else: the port arrives once the page has loaded.
const port = Promise.race([
  receivePort(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(text.noRuntime)), WAIT_PORT)),
])
const opening = port.then((given) => openWindow(given, window.althar))

/** The launch plays in full once a window; a reload, as after the runtime restarted, opens at once. */
const OPENED = 'althar.opened'
const openedBefore = (() => {
  try {
    const before = window.sessionStorage.getItem(OPENED) !== null
    window.sessionStorage.setItem(OPENED, '1')
    return before
  } catch {
    return false
  }
})()

function Window() {
  const [opened, setOpened] = useState<Awaited<typeof opening> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [storeFailure, setStoreFailure] = useState<StoreFailure | null>(null)
  useEffect(() => window.althar.onStoreFailed(setStoreFailure), [])
  useEffect(
    () =>
      // Drawn as a transition, a little at a time, so the launch playing over it keeps every frame.
      void opening.then(
        (given) => startTransition(() => setOpened(given)),
        (failure: unknown) => setFailed(failure instanceof Error && failure.message !== '' ? failure.message : String(failure)),
      ),
    [],
  )
  if (storeFailure !== null) return <UpdateStoppedView failure={storeFailure} host={window.althar} />
  if (failed !== null) return <OpenFailed reason={failed} onRetry={() => window.location.reload()} />
  return (
    <Launch ready={opened !== null} quick={openedBefore}>
      {opened !== null && (
        <ServicesProvider value={opened.services}>
          <RouterProvider router={opened.router} />
        </ServicesProvider>
      )}
    </Launch>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(
  <StrictMode>
    <Window />
  </StrictMode>,
)
