import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import './edge.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { connect, receivePort } from './data/client'
import { follow } from './data/feed'
import { makeQueryClient } from './data/reads'
import { ServicesProvider } from './data/services'
import { EdgeView, type EdgePlaceShown } from './features/edge/EdgeView'
import { edgeRead, useEdge } from './features/edge/useEdge'

/*
 * The edge's entry (features/edge): a page of its own, in the island round
 * the notch or under the menu bar's mark, with its own port to the runtime,
 * cache and watch, as the window has. The main process says which, and the
 * notch's size, in the address. It shows nothing until the first read: the
 * island stays the notch's black, and the sheet is only seen once clicked.
 */

const asked = new URLSearchParams(window.location.search)
const shown: EdgePlaceShown =
  asked.get('place') === 'menu'
    ? { place: 'menu' }
    : { place: 'island', notch: { width: Number(asked.get('notchWidth')) || 180, height: Number(asked.get('notchHeight')) || 32 } }

function Edge() {
  return <EdgeView model={useEdge()} shown={shown} />
}

const open = async () => {
  const client = await connect(await receivePort())
  const cache = makeQueryClient()
  // Watched from where the first read was: nothing after it is missed.
  const first = await cache.fetchQuery(edgeRead(client)).catch(() => null)
  const feed = follow(client, cache, first?.cursor)
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <StrictMode>
      <ServicesProvider value={{ client, host: window.althar, cache, feed }}>
        <Edge />
      </ServicesProvider>
    </StrictMode>,
  )
}

void open()
