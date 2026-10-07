import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Launch } from '@althar/ui/screens'

import { receivePort } from './data/client'
import { openWindow } from './data/open'
import { ServicesProvider } from './data/services'

/*
 * The window's entry. The launch plays at once, while the window waits for
 * the port the main process sends and opens over it (`data/open.ts`): what
 * the place it opens on shows is read under the launch, and the app is drawn
 * whole under it before the launch opens onto it.
 */

// Listen before anything else: the port arrives once the page has loaded.
const port = receivePort()
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
  useEffect(() => void opening.then(setOpened), [])
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
