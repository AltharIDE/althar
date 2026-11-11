import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ProjectTabs, Room } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { useBoard } from '../../src/renderer/features/board/useBoard'
import { useConnections } from '../../src/renderer/features/connections/useConnections'
import { ProjectView } from '../../src/renderer/features/project/ProjectView'
import { useProject } from '../../src/renderer/features/project/useProject'
import { TaskView } from '../../src/renderer/features/task/TaskView'
import { useTask } from '../../src/renderer/features/task/useTask'
import { useSettingsOf, servicesFor } from '../../tests/render'
import { coordinatorSnapshot, fakeClient, fakeHost, items, project, snapshot } from '../../tests/fixtures'
import { boardOf, CHATS, type Chat, coordinatorItems } from './data'
import { type Direction, type LabState, LabContext, useLab } from './lab'
import { DIRECTIONS, Overlay } from './directions'
import s from './lab.module.css'

/*
 * The Scratch lab (README.md): the app's project window, drawn from the
 * tests' fixtures with no runtime, with each direction for Scratch drawn into
 * it. Keys A–E pick the direction, 1–3 the layout (Home, the conversation
 * alone, the board alone), T the theme; the bar along the bottom does the same.
 */

const params = new URLSearchParams(location.search)
const LAYOUTS = [
  { room: Room.Both, label: 'Both' },
  { room: Room.Talk, label: 'Conversation only' },
  { room: Room.Board, label: 'Board only' },
] as const

/** What the fake runtime answers: read on each fetch, so the lab's state shows once the cache reads again. */
const live = { direction: 'A' as Direction, cleared: new Set<string>(), promoted: new Set<string>(), started: [] as Chat[] }

const chatsNow = () => [...live.started, ...CHATS].filter((chat) => !live.cleared.has(chat.id))

const threadOf = (threadId: string) => {
  const chat = [...live.started, ...CHATS].find((one) => `th-${one.id}` === threadId)
  if (chat === undefined) return snapshot({ threadId })
  const base = snapshot()
  const promoted = live.promoted.has(chat.id)
  return snapshot({
    threadId,
    task: {
      ...base.task,
      id: chat.id,
      title: chat.title,
      slug: chat.id,
      phase: chat.running === true ? 'running' : 'ready',
      branch: null,
      worktree: null,
      kind: 'plain',
      ...(promoted ? {} : { scratch: true }),
    } as typeof base.task,
    items: [items.you(chat.title), items.says(chat.said)],
  })
}

const services = servicesFor(
  fakeClient({
    getBoard: async () => {
      const shelf = DIRECTIONS.find((one) => one.key === live.direction)!.board
      // Quiet, a chat is on the board while its lead is at it, or once it is a task.
      const board =
        shelf === 'quiet'
          ? (() => {
              const all = boardOf('scratch', live.cleared)
              const chat = (id: string) => CHATS.find((one) => one.id === id)
              return {
                ...all,
                tasks: all.tasks
                  .filter((task) => task.scratch !== true || chat(task.taskId)?.running === true || live.promoted.has(task.taskId))
                  .map((task) => ({ ...task, scratch: undefined })),
              }
            })()
          : shelf === 'none'
            ? (() => {
                const all = boardOf('scratch', live.cleared)
                return { ...all, tasks: all.tasks.filter((task) => task.scratch !== true || live.promoted.has(task.taskId)) }
              })()
            : boardOf(shelf, live.cleared)
      // Chats made into tasks are on the board as work, whatever the direction.
      return {
        ...board,
        tasks: board.tasks.map((task) => (live.promoted.has(task.taskId) ? { ...task, scratch: undefined } : task)),
      }
    },
    getCoordinator: async () => {
      const direction = DIRECTIONS.find((one) => one.key === live.direction)!
      return coordinatorSnapshot({ items: [...coordinatorItems(direction.inThread === true ? chatsNow() : null)] })
    },
    getThread: async (threadId: string) => threadOf(threadId),
    listProjects: async () => ({ cursor: 3, projects: [project] }),
  }).client,
  fakeHost(),
)

function Project({ room, visit, onTask }: { room: Room; visit: number; onTask: (threadId: string) => void }) {
  return (
    <ProjectView
      room={room}
      visit={visit}
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={onTask}
    />
  )
}

function Task({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  return <TaskView model={useTask(threadId)} onBack={onBack} onOpenTask={() => undefined} />
}

function Window() {
  const lab = useLab()
  const tabs = [{ id: 'p1', name: 'meridian', ink: project.ink ?? 'cobalt', seed: 'p1', running: 2, yours: 0 }]
  return (
    <div className={s.window}>
      <ProjectTabs
        tabs={tabs as never}
        home
        current="p1"
        onSelect={() => lab.close()}
        onClose={() => undefined}
        lights="space"
        end={<lab.direction.Chrome />}
      />
      <div className={s.screen} data-screen>
        {lab.open === null ? (
          <Project room={lab.room} visit={lab.visit} onTask={lab.openTask} />
        ) : (
          <Task key={lab.open} threadId={lab.open} onBack={lab.close} />
        )}
        <Overlay />
      </div>
    </div>
  )
}

function Lab() {
  const [direction, setDirection] = useState<Direction>((params.get('d') as Direction | null) ?? 'A')
  const [room, setRoom] = useState<Room>(LAYOUTS[Number(params.get('l') ?? 0)]?.room ?? Room.Both)
  const [visit, setVisit] = useState(0)
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [open, setOpen] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  live.direction = direction
  const refresh = () => {
    setVersion((n) => n + 1)
    void services.cache.invalidateQueries()
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(refresh, [direction])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', direction)
    url.searchParams.set('l', String(LAYOUTS.findIndex((one) => one.room === room)))
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [direction, room, theme])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [role="textbox"]') !== null))
        return
      const key = event.key.toUpperCase()
      const picked = DIRECTIONS.find((one) => one.key === key)
      if (picked !== undefined) {
        setDirection(picked.key)
        setOpen(null)
      }
      const layout = LAYOUTS[Number(event.key) - 1]
      if (layout !== undefined) {
        setRoom(layout.room)
        setVisit((n) => n + 1)
        setOpen(null)
      }
      if (key === 'T') setTheme((was) => (was === 'dark' ? 'light' : 'dark'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const state: LabState = useMemo(
    () => ({
      direction: DIRECTIONS.find((one) => one.key === direction)!,
      room,
      visit,
      open,
      version,
      chats: chatsNow(),
      promoted: live.promoted,
      openTask: (threadId) => setOpen(threadId),
      close: () => setOpen(null),
      clear: (ids) => {
        for (const id of ids) live.cleared.add(id)
        refresh()
      },
      promote: (id) => {
        live.promoted.add(id)
        refresh()
      },
      start: (title) => {
        const chat: Chat = { id: `n${live.started.length + 1}`, title, by: 'person', said: title, minutes: 0, running: true }
        live.started.unshift(chat)
        refresh()
        return chat
      },
      reset: () => {
        live.cleared.clear()
        live.promoted.clear()
        live.started.splice(0)
        setOpen(null)
        refresh()
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [direction, room, visit, open, version],
  )
  return (
    <LabContext.Provider value={state}>
      <div className={s.lab} data-direction={direction}>
        <Window />
        <nav className={s.bar} aria-label="Directions">
          <span className={s.group}>
            {DIRECTIONS.map((one) => (
              <button
                key={one.key}
                type="button"
                aria-pressed={direction === one.key}
                onClick={() => {
                  setDirection(one.key)
                  setOpen(null)
                }}
              >
                <kbd>{one.key}</kbd> {one.label}
              </button>
            ))}
          </span>
          <span className={s.group}>
            {LAYOUTS.map((one, index) => (
              <button
                key={one.room}
                type="button"
                aria-pressed={room === one.room}
                onClick={() => {
                  setRoom(one.room)
                  setVisit((n) => n + 1)
                  setOpen(null)
                }}
              >
                <kbd>{index + 1}</kbd> {one.label}
              </button>
            ))}
          </span>
          <span className={s.group}>
            <button type="button" onClick={() => setTheme((was) => (was === 'dark' ? 'light' : 'dark'))}>
              <kbd>T</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
            <button type="button" onClick={state.reset}>
              Reset
            </button>
          </span>
          <span className={s.note}>{DIRECTIONS.find((one) => one.key === direction)!.note}</span>
        </nav>
      </div>
    </LabContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider value={services}>
      <Lab />
    </ServicesProvider>
  </StrictMode>,
)
