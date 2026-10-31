// Scrappy: the real desktop app on the tests' fake client, opened on a project's settings, with a switcher under it.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../../../packages/ui/src/styles/global.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

import { LinkButton, Segmented } from '@althar/ui'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeClient, fakeHost, project, repositories, snapshot } from '../../tests/fixtures'
import s from './proto.module.css'
import { type Direction, type Moment, proto, useProto, type Which } from './state'

const PROJECTS = {
  althar: {
    ...project,
    name: 'althar',
    slug: 'althar',
    ink: 'clay',
    repository: '/Users/balazs/Projects/charrette-project/althar',
    repositories: ['althar'],
    worktrees: '/Users/balazs/Althar/althar',
  },
  meridian: { ...project, repositories: repositories.map((one) => one.name) },
} as const

const althar = {
  ...repositories[0]!,
  id: 'repo_althar',
  name: 'althar',
  path: '/Users/balazs/Projects/charrette-project/althar',
  host: { ...repositories[0]!.host!, path: 'AltharIDE/althar', url: 'https://github.com/AltharIDE/althar' },
}

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [PROJECTS[proto.get().which]] }),
  getRepositories: async () => (proto.get().which === 'althar' ? [althar] : repositories),
  getThread: async () => snapshot(),
})
const cache = makeQueryClient()
const services = { client, host: fakeHost(), cache, feed: follow(client, cache) }

// Another project, read again, as the runtime's word would have it.
let which = proto.get().which
proto.subscribe(() => {
  if (proto.get().which === which) return
  which = proto.get().which
  void cache.invalidateQueries()
})

const DIRECTIONS: ReadonlyArray<{ value: Direction; name: string; section: string }> = [
  { value: 'A', name: 'Rows', section: 'running' },
  { value: 'B', name: 'Script', section: 'running' },
  { value: 'C', name: 'Its own section', section: 'folders' },
]

/** Swaps the direction in place, on the section it puts the setups in. */
const go = (direction: Direction) => {
  proto.set({ direction })
  const section = DIRECTIONS.find((one) => one.value === direction)?.section ?? 'running'
  window.location.hash = `#/projects/p1?room=settings&section=${section}`
}

window.addEventListener(
  'keydown',
  (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog]')) return
    const at = DIRECTIONS.findIndex((one) => one.value === proto.get().direction)
    const picked =
      event.key === 'ArrowRight'
        ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
        : event.key === 'ArrowLeft'
          ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
          : /^[1-3]$/.test(event.key)
            ? DIRECTIONS[Number(event.key) - 1]
            : undefined
    if (picked === undefined) return
    event.preventDefault()
    event.stopPropagation()
    go(picked.value)
  },
  { capture: true },
)

function Switcher() {
  const p = useProto()
  return (
    <div className={s.strip}>
      <Segmented<Direction>
        label="Direction"
        value={p.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: `${one.value} · ${one.name}`,
          tooltip: { label: one.name, kbd: String(at + 1) },
        }))}
      />
      <Segmented<Which>
        label="Project"
        value={p.which}
        onChange={(next) => proto.set({ which: next })}
        options={[
          { value: 'althar', label: 'althar' },
          { value: 'meridian', label: 'meridian, three repositories' },
        ]}
      />
      <Segmented<Moment>
        label="Recorded"
        value={p.moment}
        onChange={(next) => proto.set({ moment: next })}
        options={[
          { value: 'recorded', label: 'Recorded' },
          { value: 'none', label: 'None yet' },
        ]}
      />
      <span className={s.grow} />
      <span>1–3 or ← → switch</span>
      <LinkButton onClick={() => go(p.direction)}>Back to settings</LinkButton>
    </div>
  )
}

const params = new URLSearchParams(window.location.search)
const d = DIRECTIONS.find((one) => one.value === params.get('d')?.toUpperCase())?.value ?? 'A'
proto.set({
  direction: d,
  which: params.get('p') === 'meridian' ? 'meridian' : 'althar',
  moment: params.get('s') === 'none' ? 'none' : 'recorded',
})
which = proto.get().which
// What the address said is read once: the router reads the hash alone, and a query before it would be read into its routes.
window.history.replaceState(null, '', window.location.pathname)
window.localStorage.removeItem('althar.tabs')
go(d)

const router = makeRouter({ client, cache })
createRoot(document.getElementById('root')!).render(
  <ServicesProvider value={services}>
    <div className={s.frame}>
      <RouterProvider router={router} />
    </div>
    <Switcher />
  </ServicesProvider>,
)
