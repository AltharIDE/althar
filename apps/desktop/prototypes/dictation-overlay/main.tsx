// Throwaway: the real desktop app (its router, tabs, home, board, coordinator and task screens) on the tests' fake client, with the dictation drawn each idea's way over it.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeClient, fakeHost, repositories } from '../../tests/fixtures'
import { althar, boardOf, coordinatorOf, homeOf, loadOf, threadSnapshotOf } from './data'
import { A } from './ideas/A'
import { B } from './ideas/B'
import { C } from './ideas/C'
import { useView } from './ideas/common'
import { E } from './ideas/E'
import { keepRouter } from './nav'
import s from './page.module.css'
import { addSent, onSent } from './sent'
import { Switcher } from './switcher'
import { store, visit } from './voice'

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [{ ...althar, coordinatorThreadId: 'th-coordinator' }] }),
  getRepositories: async () => [{ ...repositories[0]!, id: 'repo_althar', name: 'althar', path: althar.repository, host: null, tasks: 9 }],
  getHome: async () => homeOf(),
  getBoard: async () => boardOf(),
  getCoordinator: async () => coordinatorOf(),
  getThread: async (threadId: string) => threadSnapshotOf(threadId),
  // Writing down a long dictation while the suites run: the Mac is busy, and the meter says so.
  getLoad: async () => loadOf(store.get().session.slow && store.get().session.phase === 'writing'),
  // What the person sends from a composer lands at the end of its thread, as from a dictation.
  send: async ({ threadId, body }: { threadId: string; body: string }) =>
    addSent(threadId === 'th-coordinator' ? 'coordinator:p1' : `thread:${threadId}`, body),
})

const cache = makeQueryClient()
const services = { client, host: fakeHost(), cache, feed: follow(client, cache) }
onSent(() => void cache.invalidateQueries())

// Every page opens on althar's tab, whatever another page kept.
window.localStorage.removeItem('althar.tabs')
window.localStorage.setItem('althar.both', '560')

const router = makeRouter({ client, cache }, createMemoryHistory({ initialEntries: [store.get().path] }))
keepRouter(router)
router.subscribe('onResolved', ({ toLocation }) => visit(toLocation.href))

// The idea, the state and where the window is go in the address, so a link opens the same.
let shown = ''
store.subscribe(() => {
  const { idea, preset, path, still } = store.get()
  const address = `?idea=${idea}&state=${preset}&at=${path.replace(/&/g, '%26')}${still ? '&still' : ''}`
  if (address === shown) return
  shown = address
  window.history.replaceState(null, '', address)
})

/** What floats over the screen, by idea: A's pill, C's composer, E's pill. B is a bar of its own, and D is on its tab. */
function Floating({ area }: { area: HTMLElement | null }) {
  const view = useView()
  switch (view.live.idea) {
    case 'A':
      return <A view={view} area={area} />
    case 'C':
      return <C view={view} area={area} />
    case 'E':
      return <E view={view} area={area} />
    default:
      return null
  }
}

function Bar() {
  const view = useView()
  return view.live.idea === 'B' ? <B view={view} /> : null
}

function Page() {
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  return (
    <ServicesProvider value={services}>
      <div className={s.page}>
        <div className={s.app} ref={setArea}>
          <RouterProvider router={router} />
          <Floating area={area} />
        </div>
        <Bar />
        <Switcher />
      </div>
    </ServicesProvider>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(<Page />)
