import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { receivePort } from './data/client'
import { openWindow } from './data/open'
import { ServicesProvider } from './data/services'

/*
 * The window's entry: wait for the port the main process sends, open the
 * window over it (`data/open.ts`), then draw the app, whole.
 */

// Listen before anything else: the port arrives once the page has loaded.
const port = receivePort()

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')

void port
  .then((given) => openWindow(given, window.althar))
  .then(({ services, router }) => {
    createRoot(element).render(
      <StrictMode>
        <ServicesProvider value={services}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </StrictMode>,
    )
  })
