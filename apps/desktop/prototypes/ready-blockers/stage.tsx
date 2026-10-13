import type { ReactNode } from 'react'

import type { BoardTask } from '@althar/contracts'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { BoardView } from '../../src/renderer/features/board/BoardView'
import { lanesOf } from '../../src/renderer/features/board/lanes'
import { HomeView } from '../../src/renderer/features/home/HomeView'
import type { HomeModel } from '../../src/renderer/features/home/useHome'
import p from '../../src/renderer/features/project/Project.module.css'
import type { StartModel } from '../../src/renderer/features/start/useStart'
import { fakeClient, fakeHost, project, status } from '../../tests/fixtures'
import { type Direction, DirectionContext, GroupCounts, GroupHeads, groupsC } from './cards'
import { boardOf, core, homeOf } from './scenario'

/*
 * The app's own board and home, with what they reach for faked as its tests
 * fake it: a runtime that answers with the scenario, and view models whose
 * actions do nothing.
 */

const services = (() => {
  const { client } = fakeClient()
  const cache = makeQueryClient()
  return { client, host: fakeHost(), cache, feed: follow(client, cache) }
})()

export function Services({ children }: { children: ReactNode }) {
  return <ServicesProvider value={services}>{children}</ServicesProvider>
}

const nothing = async () => undefined
/** A view model with these, whose every other action does nothing. */
const modelOf = <M extends object>(base: Partial<M>): M =>
  new Proxy(base, { get: (target, key) => (key in target ? target[key as keyof M] : nothing) }) as M

const start = modelOf<StartModel>({
  status,
  projects: [project],
  error: null,
  installFailed: {},
  checkedAt: 0,
  unremoved: null,
})

/** The ready work in the order the direction shows it, and where C's headings go. */
const orderOf = (direction: Direction) => {
  const tasks: ReadonlyArray<BoardTask> = core.map((one) => one.task)
  if (direction !== 'c') return { tasks, heads: new Set<string>(), counts: { good: 0, waiting: 0, yours: 0 } }
  const { sorted, heads, counts } = groupsC(tasks)
  return { tasks: sorted, heads, counts }
}

function As({ direction, children }: { direction: Direction; children: ReactNode }) {
  const { heads, counts } = orderOf(direction)
  return (
    <Services>
      <DirectionContext.Provider value={direction}>
        <GroupHeads.Provider value={heads}>
          <GroupCounts.Provider value={counts}>{children}</GroupCounts.Provider>
        </GroupHeads.Provider>
      </DirectionContext.Provider>
    </Services>
  )
}

/** The project's board, as its board room shows it. */
export function BoardOf({ direction }: { direction: Direction }) {
  const lanes = lanesOf(boardOf(orderOf(direction).tasks))
  return (
    <As direction={direction}>
      <div className={p.board}>
        <BoardView lanes={lanes} agents={status.agents} now={new Date().toISOString()} onOpen={() => {}} />
      </div>
    </As>
  )
}

/** The home, as the window opens on it. */
export function HomeOf({ direction }: { direction: Direction }) {
  const model = modelOf<HomeModel>({ home: homeOf(orderOf(direction).tasks), board: null, error: null, answer: async () => true })
  return (
    <As direction={direction}>
      <HomeView model={model} start={start} onProject={() => {}} onTalk={() => {}} onTask={() => {}} />
    </As>
  )
}

/** One card, out of the board, in the direction's dress. */
export function CardOf({ direction, children }: { direction: Direction; children: ReactNode }) {
  // Out of the board, its group's heading is the page's to draw.
  return (
    <As direction={direction}>
      <GroupHeads.Provider value={new Set()}>{children}</GroupHeads.Provider>
    </As>
  )
}
