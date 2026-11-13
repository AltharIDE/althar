import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, startTransition, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { API_VERSION_MISMATCH, ApiError } from '@althar/contracts'
import { Launch, OpenFailed } from '@althar/ui/screens'

import { receivePort } from './data/client'
import { openWindow } from './data/open'
import { ServicesProvider, type StoreFailure } from './data/services'
import { QuitDialog } from './features/quit/QuitDialog'
import { ReportDialog } from './features/report/ReportDialog'
import { ApiVersionMismatchView } from './features/update/ApiVersionMismatchView'
import { ProfileInUseView } from './features/update/ProfileInUseView'
import { UpdateStoppedView } from './features/update/UpdateStoppedView'
import { followScheme } from './shared/scheme'
import { SystemAccent } from './shared/SystemAccent'
import { useHostChrome } from './shared/useWindowChrome'
import { keepWindowErrors } from './shared/windowErrors'

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

// Light or dark, before anything draws.
followScheme()

// What the page doesn't handle goes to the app's log.
keepWindowErrors(window.althar)

// Listen before anything else: the port arrives once the page has loaded.
const port = Promise.race([
  receivePort(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(text.noRuntime)), WAIT_PORT)),
])
window.althar.startup?.('renderer-entry')
const opening = port.then((given) => {
  window.althar.startup?.('port-received')
  return openWindow(given, window.althar)
})

/** The first-run welcome plays the full launch; returning profiles and reloads take its quick opening. */
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

/** The launch's place when the window couldn't open: its own bar carries the window's buttons, so its third says maximize or restore. */
function FailedOpen({ reason }: { reason: string }) {
  // Subscribed only while this screen is the one shown, not for the window's whole life. Off a Mac the window's own buttons sit
  // in this bar too, as the desktop has them, so the window can still be closed here.
  const chrome = useHostChrome(window.althar)
  return <OpenFailed reason={reason} onRetry={() => window.location.reload()} {...chrome} />
}

function Window() {
  const [opened, setOpened] = useState<Awaited<typeof opening> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<ApiError | null>(null)
  const [storeFailure, setStoreFailure] = useState<StoreFailure | null>(null)
  useEffect(() => window.althar.onStoreFailed(setStoreFailure), [])
  useEffect(
    () =>
      // Drawn as a transition, a little at a time, so the launch playing over it keeps every frame.
      void opening.then(
        (given) => startTransition(() => setOpened(given)),
        (failure: unknown) =>
          failure instanceof ApiError && failure.reason === API_VERSION_MISMATCH
            ? setMismatch(failure)
            : setFailed(failure instanceof Error && failure.message !== '' ? failure.message : String(failure)),
      ),
    [],
  )
  if (storeFailure?.stopped === 'held') return <ProfileInUseView failure={storeFailure} host={window.althar} />
  if (storeFailure !== null) return <UpdateStoppedView failure={storeFailure} host={window.althar} />
  if (mismatch?.runtimeVersion !== undefined)
    return (
      <ApiVersionMismatchView
        windowVersion={mismatch.clientVersion ?? null}
        runtimeVersion={mismatch.runtimeVersion}
        host={window.althar}
      />
    )
  if (failed !== null) return <FailedOpen reason={failed} />
  return (
    <Launch
      ready={opened !== null}
      quick={openedBefore || opened?.hasProjects === true}
      onDone={() =>
        requestAnimationFrame(() => {
          window.althar.startup?.('first-screen-drawn')
          opened?.afterOpen()
        })
      }
    >
      {opened !== null && (
        <ServicesProvider value={opened.services}>
          <SystemAccent />
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
    {/* Report a problem opens over whatever the window shows, with or without the runtime. */}
    <ReportDialog host={window.althar} />
    {/* So does Quit with work under way, which asks first. */}
    <QuitDialog host={window.althar} />
  </StrictMode>,
)
