import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { LoadMeter, ProjectInk, ProjectTabs } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { BoardView } from '../../src/renderer/features/board/BoardView'
import { TaskView } from '../../src/renderer/features/task/TaskView'
import { useTask } from '../../src/renderer/features/task/useTask'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { servicesFor } from '../../tests/render'
import { DIRECTIONS, type Direction, type Lab, LabContext } from './context'
import { agentsOf, boardOf, loadOf, NOW, type Scene, SCENES, SLOTS, threadOf, worldOf } from './data'
import s from './lab.module.css'

/*
 * The held-back lab (README.md): the app's own board and task view while
 * This Mac lets fewer agents work than the person's number. The bar along
 * the bottom, or its keys, swaps in place: the direction (0 as built, A B C
 * D), the scene (Q W E R), the board or the task first in line (T), a
 * narrow window (N) and dark (K). P opens This Mac from the bar. Start
 * anyway moves a held task into Running at once; choosing a scene again
 * puts it back in line.
 */

const SCENE_KEYS = ['q', 'w', 'e', 'r'] as const

const params = () => new URLSearchParams(location.search)
const read = () => {
  const now = params()
  return {
    d: (DIRECTIONS.find((one) => one.key === now.get('d'))?.key ?? 'a') as Direction,
    p: (SCENES.find((one) => one.key === now.get('p'))?.key ?? 'memory') as Scene,
    task: now.get('screen') === 'task',
    narrow: now.get('n') === '1',
    dark: now.get('theme') === 'dark',
  }
}
type State = ReturnType<typeof read>

if (params().get('shot') === '1') document.documentElement.dataset.shot = ''

const PROJECTS = [
  { id: 'meridian', name: 'Meridian', ink: ProjectInk.Teal },
  { id: 'halyard', name: 'Halyard', ink: ProjectInk.Clay },
] as const

/** The task first in line, in its own view, read from a client that knows only its thread. */
function TaskScreen({ lab, onBack }: { lab: Lab; onBack: () => void }) {
  const thread = useMemo(() => threadOf(lab.world), [lab.world])
  const services = useMemo(() => servicesFor(fakeClient({ getThread: async () => thread }).client, fakeHost()), [thread])
  return (
    <ServicesProvider value={services}>
      <Task threadId={thread.threadId} onBack={onBack} />
    </ServicesProvider>
  )
}

function Task({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  return <TaskView model={useTask(threadId)} onBack={onBack} />
}

function Page() {
  const [state, setStateNow] = useState(read)
  const [started, setStarted] = useState<readonly string[]>([])
  const [mac, setMac] = useState(params().get('open') === 'mac')
  const [said, setSaid] = useState<string | null>(null)
  const services = useMemo(() => servicesFor(fakeClient().client, fakeHost()), [])

  const set = (next: Partial<State>) => {
    const merged = { ...state, ...next }
    const url = params()
    url.set('d', merged.d)
    url.set('p', merged.p)
    for (const [key, on, value] of [
      ['screen', merged.task, 'task'],
      ['n', merged.narrow, '1'],
      ['theme', merged.dark, 'dark'],
    ] as const)
      if (on) url.set(key, value)
      else url.delete(key)
    url.delete('open')
    history.replaceState(null, '', `?${url.toString()}`)
    if (next.p !== undefined) setStarted([])
    setStateNow(merged)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  }, [state.dark])

  const world = useMemo(() => worldOf(state.p, started), [state.p, started])
  const lanes = useMemo(() => boardOf(world), [world])
  const load = useMemo(() => loadOf(world), [world])
  const say = (what: string) => {
    setSaid(what)
    setTimeout(() => setSaid((was) => (was === what ? null : was)), 2600)
  }
  const titleOf = (id: string) => [...world.line, ...world.running].find((one) => one.id === id)?.title ?? id
  const lab: Lab = {
    direction: state.d,
    world,
    startAnyway: (id) => {
      setStarted((was) => (was.includes(id) ? was : [...was, id]))
      if (state.task) set({ task: false })
    },
    showMac: () => setMac(true),
    open: (id) => say(`Opens ${titleOf(id)}`),
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (typing || (event.target as HTMLElement | null)?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.key === key)
      if (direction !== undefined) return set({ d: direction.key })
      const scene = SCENES[SCENE_KEYS.indexOf(key as (typeof SCENE_KEYS)[number])]
      if (scene !== undefined) return set({ p: scene.key })
      if (key === 't') return set({ task: !state.task })
      if (key === 'n') return set({ narrow: !state.narrow })
      if (key === 'k') return set({ dark: !state.dark })
      if (key === 'p') setMac((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const idea = DIRECTIONS.find((one) => one.key === state.d)!.idea

  return (
    <ServicesProvider value={services}>
      <LabContext.Provider value={lab}>
        <div className={s.lab}>
          <div className={s.desk}>
            <div className={s.window} data-narrow={state.narrow || undefined}>
              <ProjectTabs
                tabs={PROJECTS.map((project) => ({
                  id: project.id,
                  name: project.name,
                  seed: project.id,
                  ink: project.ink,
                  running: project.id === 'meridian',
                  yours: 0,
                }))}
                current="meridian"
                onSelect={() => set({ task: false })}
                onClose={() => undefined}
                lights="space"
                end={
                  <LoadMeter
                    load={load}
                    agents={agentsOf(world)}
                    slots={SLOTS}
                    open={mac}
                    onOpenChange={setMac}
                    onOpen={(id) => say(`Opens ${titleOf(id)}`)}
                  />
                }
              />
              <div className={s.screen}>
                {state.task ? (
                  <TaskScreen key={`${state.p}-${started.join()}`} lab={lab} onBack={() => set({ task: false })} />
                ) : (
                  <div className={s.board}>
                    <BoardView
                      key={state.p}
                      lanes={lanes}
                      agents={agents}
                      now={NOW}
                      onOpen={(threadId) => {
                        const id = threadId.replace(/^th-/, '')
                        if (id === world.line[0]?.id) set({ task: true })
                        else say(`Opens ${titleOf(id)}`)
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          {said !== null && <output className={s.said}>{said}</output>}
          <div className={s.bar} role="toolbar" aria-label="Directions">
            {DIRECTIONS.map((one) => (
              <button key={one.key} type="button" aria-pressed={state.d === one.key} onClick={() => set({ d: one.key })} title={one.idea}>
                <kbd>{one.key.toUpperCase()}</kbd>
                {one.label}
              </button>
            ))}
            <span className={s.rule} />
            {SCENES.map((one, i) => (
              <button key={one.key} type="button" aria-pressed={state.p === one.key} onClick={() => set({ p: one.key })} title={one.idea}>
                <kbd>{SCENE_KEYS[i]!.toUpperCase()}</kbd>
                {one.label}
              </button>
            ))}
            <span className={s.rule} />
            {(
              [
                ['T', 'Task', state.task, () => set({ task: !state.task })],
                ['N', 'Narrow', state.narrow, () => set({ narrow: !state.narrow })],
                ['K', 'Dark', state.dark, () => set({ dark: !state.dark })],
                ['P', 'This Mac', mac, () => setMac(!mac)],
              ] as const
            ).map(([key, label, on, press]) => (
              <button key={key} type="button" aria-pressed={on} onClick={press}>
                <kbd>{key}</kbd>
                {label}
              </button>
            ))}
            <span className={s.rule} />
            <span className={s.idea}>{idea}</span>
          </div>
        </div>
      </LabContext.Provider>
    </ServicesProvider>
  )
}

// For pictures: still=1 draws every state at once, with no transitions or animations to catch halfway.
if (params().get('still') === '1') {
  const still = document.createElement('style')
  still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
  document.head.append(still)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
