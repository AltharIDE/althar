import type { ReactNode } from 'react'

import type { BoardTask } from '@althar/contracts'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { BoardView } from '../../src/renderer/features/board/BoardView'
import { DockView } from '../../src/renderer/features/board/DockView'
import { type Lanes, lanesOf } from '../../src/renderer/features/board/lanes'
import type { BoardModel } from '../../src/renderer/features/board/useBoard'
import { HomeView } from '../../src/renderer/features/home/HomeView'
import type { HomeModel } from '../../src/renderer/features/home/useHome'
import { Card } from '../../src/renderer/features/project/Card'
import p from '../../src/renderer/features/project/Project.module.css'
import type { StartModel } from '../../src/renderer/features/start/useStart'
import { TaskView } from '../../src/renderer/features/task/TaskView'
import type { TaskModel } from '../../src/renderer/features/task/useTask'
import { fakeClient, fakeHost, project, status } from '../../tests/fixtures'
import { boardOf, cardOf, homeOf, sceneOf, type State, states, threadOf } from './scenario'
import { type Direction, lineOf, type Scene, SceneContext } from './scene'
import { upNext } from './words'

/*
 * The app's own board, dock, home, task screen and card, with what they
 * reach for faked as its tests fake it: a runtime that answers with the
 * scenario, and view models whose actions do nothing.
 */

const services = (() => {
  const { client } = fakeClient()
  const cache = makeQueryClient()
  return { client, host: fakeHost(), cache, feed: follow(client, cache) }
})()

const nothing = async () => undefined
/** A view model with these, whose every other action does nothing. */
const modelOf = <M extends object>(base: Partial<M>): M =>
  new Proxy(base, { get: (target, key) => (key in target ? target[key as keyof M] : nothing) }) as M

const start = modelOf<StartModel>({ status, projects: [project], error: null, installFailed: {}, checkedAt: 0, unremoved: null })

function On({ scene, children }: { scene: Scene; children: ReactNode }) {
  return (
    <ServicesProvider value={services}>
      <SceneContext.Provider value={scene}>{children}</SceneContext.Provider>
    </ServicesProvider>
  )
}

/** The lanes as the direction lays them out: today's as the app has them; else waiting work up next, first, in its order. */
const lanesFor = (scene: Scene): Lanes => {
  const board = boardOf(scene.tasks)
  const today = lanesOf(board)
  if (scene.direction === 'today') return today
  const bySlug = (slug: string) => scene.tasks.find((one) => one.slug === slug)!
  const waitsUpNext = (one: BoardTask) => {
    const q = lineOf(one)
    return q !== null && upNext(q)
  }
  return {
    ...today,
    next: scene.next.map(bySlug),
    // Running: what an agent is on; then, in D and E, work under way whose turn waits, quiet at the end.
    running: today.running.filter((one) => !waitsUpNext(one)).toSorted((a, b) => Number(a.queued !== null) - Number(b.queued !== null)),
  }
}

/** The project's board, as its board room shows it. */
export function BoardOf({ state, direction, tip }: { state: State; direction: Direction; tip?: string }) {
  const scene = { ...sceneOf(state, direction), ...(tip === undefined ? {} : { tip }) }
  return (
    <On scene={scene}>
      <div className={p.board}>
        <BoardView lanes={lanesFor(scene)} agents={status.agents} now={new Date().toISOString()} onOpen={() => {}} />
      </div>
    </On>
  )
}

/** The dock, opened from the board on a waiting task: one not started, or one under way. */
export function DockOf({ direction, started }: { direction: Direction; started: boolean }) {
  const state = states.find((one) => one.key === 'midway')!
  const scene = sceneOf(state, direction)
  const task = scene.tasks.find((one) => one.queued !== null && lineOf(one)!.started === started)!
  const model = modelOf<BoardModel>({
    board: boardOf(scene.tasks),
    error: null,
    merging: null,
    sending: null,
    pushing: null,
    opening: null,
  })
  return (
    <On scene={scene}>
      <DockView
        target={{ kind: 'task', id: task.taskId }}
        model={model}
        agents={status.agents}
        project="meridian"
        now={new Date().toISOString()}
        onClose={() => {}}
        onTask={() => {}}
        onChanges={() => {}}
      />
    </On>
  )
}

/** A waiting task's own screen: its header, and its conversation under it. */
export function TaskOf({ direction, started }: { direction: Direction; started: boolean }) {
  const model = modelOf<TaskModel>({
    snapshot: threadOf(direction, started),
    streaming: new Map(),
    outputs: new Map(),
    agents: status.agents,
    agentsKnown: true,
    error: null,
    conflict: null,
    refused: null,
    pending: false,
    doing: null,
    loadingEarlier: false,
    dismissConflict: () => {},
    readFiles: () => {},
  })
  return (
    <On scene={{ direction, tasks: [], next: [] }}>
      <TaskView model={model} onBack={() => {}} />
    </On>
  )
}

/** The card the coordinator posted for a task not started, waiting, in the project's conversation. */
export function TalkCardOf({ direction }: { direction: Direction }) {
  return (
    <On scene={{ direction, tasks: [], next: [] }}>
      <Card
        card={cardOf(direction)}
        actions={{
          project: 'meridian',
          agents: status.agents,
          agentName: (id) => status.agents.find((one) => one.id === id)?.name ?? id ?? '',
          onStart: () => {},
          onHold: () => {},
          onChange: () => {},
          onOpen: () => {},
        }}
      />
    </On>
  )
}

/** The home, as the window opens on it. */
export function HomeOf({ direction }: { direction: Direction }) {
  const model = modelOf<HomeModel>({ home: homeOf(direction), error: null, answer: async () => true })
  return (
    <On scene={{ direction, tasks: [], next: [] }}>
      <HomeView model={model} start={start} onProject={() => {}} onTalk={() => {}} onTask={() => {}} />
    </On>
  )
}
