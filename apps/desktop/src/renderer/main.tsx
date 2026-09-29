import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@charrette/ui/styles.css'
import './app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { connect, receivePort } from './data/client'
import { ServicesProvider } from './data/services'
import { router } from './router'

/*
 * The window's entry: wait for the port the main process sends, connect to
 * the runtime over it, then draw the app.
 */

// Listen before anything else: the port arrives once the page has loaded.
const port = receivePort()

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')

void port.then(connect).then((client) => {
  createRoot(element).render(
    <StrictMode>
      <ServicesProvider value={{ client, host: window.charrette }}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </StrictMode>,
  )
})
