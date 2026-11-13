import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { Bar } from './Bar'
import { makeClient, TABS } from './data'
import { entriesFor, search } from './index'
import { router as shared } from './state'
import s from './lab.module.css'

/*
 * The search lab (README.md): the desktop app's window, whole, in the
 * browser (its router, tabs and screens) on made-up data, with the page's
 * bar under it. ⌘K (Control-K off a Mac) opens search as the app does;
 * the bar swaps which direction it opens, with keys too. Where in the app
 * is the address's hash: #/ the home, #/projects/p_althar a project,
 * #/threads/th_… a task.
 */

// The tabs this window keeps, the same at every load.
window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
document.documentElement.dataset.theme = 'light'

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })
shared.current = router
// For timing a search from the console: searchLab.time('lig').
Object.defineProperty(window, 'searchLab', {
  configurable: true,
  value: {
    time: (query: string, runs = 200) => {
      const entries = entriesFor({ project: 'p_althar', task: null })
      const began = performance.now()
      for (let n = 0; n < runs; n += 1) search(entries, query, { project: 'p_althar', task: null })
      return { entries: entries.length, ms: (performance.now() - began) / runs }
    },
  },
})

function Lab() {
  // Opened on althar's project, the first time.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/projects/$projectId', params: { projectId: 'p_althar' } })
  }, [])
  return (
    <div className={s.lab}>
      <div className={s.window}>
        <ServicesProvider value={services}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </div>
      <Bar />
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
