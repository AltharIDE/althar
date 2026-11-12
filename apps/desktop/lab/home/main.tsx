import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { type PaneTogglesDesign, PaneTogglesDesignProvider, paneTogglesDesigns, Room } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { useBoard } from '../../src/renderer/features/board/useBoard'
import { useConnections } from '../../src/renderer/features/connections/useConnections'
import { ProjectView } from '../../src/renderer/features/project/ProjectView'
import { useProject } from '../../src/renderer/features/project/useProject'
import { fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor, useSettingsOf } from '../../tests/render'
import { board, coordinator } from './data'
import s from './lab.module.css'

/*
 * The home lab (README.md): a project's real home, its header, conversation,
 * composer and board, on made-up data, its panes' toggles drawn as the layout
 * map five ways. 1–5, or the bar along the bottom, swap the look in place; c and b
 * are the app's own keys for the panes; w switches between a wide window and
 * the app's narrowest, t between light and dark.
 */

const params = new URLSearchParams(location.search)
// zoom=3 draws the page larger, for a close look at the toggles in a screenshot.
if (params.has('zoom')) document.documentElement.style.zoom = params.get('zoom') ?? '1'
/** The app's window goes no narrower (its main process's minWidth). */
const NARROW = 880
const PROJECT = 'p1'

const services = servicesFor(fakeClient({ getBoard: async () => board, getCoordinator: async () => coordinator }).client, fakeHost())

/** Whether a key was pressed while typing, where the lab's keys are letters. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"]') !== null)

/** What the address asks open, for a screenshot: talk=0 or board=0 hides that pane, room=settings goes away from home. */
const askedRoom = (): Room => {
  if (params.get('room') === 'settings') return Room.Settings
  if (params.get('talk') === '0') return Room.Board
  if (params.get('board') === '0') return Room.Talk
  return Room.Both
}

function Home() {
  return (
    <ProjectView
      model={useProject(PROJECT)}
      board={useBoard(PROJECT)}
      connections={useConnections()}
      settings={useSettingsOf(PROJECT)}
      onTask={() => undefined}
      room={askedRoom()}
    />
  )
}

function Lab() {
  const asked = paneTogglesDesigns.find((one) => one.key === params.get('d'))?.key
  const [design, setDesign] = useState<PaneTogglesDesign>(asked ?? 'words')
  const [narrow, setNarrow] = useState(params.get('narrow') === '1')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  // Swapped is the app's own, kept in the window's storage: the address can ask for it, for a screenshot.
  if (params.has('swapped')) localStorage.setItem('althar.swapped', params.get('swapped') === '1' ? 'true' : 'false')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const picked = paneTogglesDesigns[Number(event.key) - 1]
      if (picked !== undefined) setDesign(picked.key)
      if (event.key === 'w') setNarrow((was) => !was)
      if (event.key === 't') setTheme((was) => (was === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', design)
    url.searchParams.set('narrow', narrow ? '1' : '0')
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [design, narrow, theme])
  return (
    <div className={s.lab}>
      <main className={s.stage}>
        <div className={s.window} style={narrow ? { width: NARROW } : undefined}>
          <PaneTogglesDesignProvider value={design}>
            <Home />
          </PaneTogglesDesignProvider>
        </div>
      </main>
      <nav className={s.bar} aria-label="Designs" hidden={params.get('shot') === '1'}>
        {paneTogglesDesigns.map((one, index) => (
          <button key={one.key} type="button" aria-pressed={design === one.key} onClick={() => setDesign(one.key)}>
            <kbd>{index + 1}</kbd> {one.label}
          </button>
        ))}
        <span className={s.gap} />
        <button type="button" aria-pressed={narrow} onClick={() => setNarrow((was) => !was)}>
          <kbd>w</kbd> {narrow ? 'Narrow' : 'Wide'}
        </button>
        <button type="button" onClick={() => setTheme((was) => (was === 'dark' ? 'light' : 'dark'))}>
          <kbd>t</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
        <span className={s.hint}>
          <kbd>c</kbd> conversation · <kbd>b</kbd> board
        </span>
      </nav>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Lab />
      </ServicesProvider>
    </StrictMode>,
  )
