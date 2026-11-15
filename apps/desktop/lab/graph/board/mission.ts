import type { BoardTask } from '@althar/contracts'

import type { Lanes } from '../../../src/renderer/features/board/lanes'
import { noun } from '../plan'
import { scenario, stage, useStore, useWorld } from '../state'
import { columnsOf, graphOf, type GraphView, type NodeView, type Stand, taskIdOf } from '../view'

/*
 * The launched mission as the board's options read it: its tasks in the
 * order they can start (the graph's waves, top to bottom), each one's place
 * in that order, which of them need the person, and how far along it is.
 */

export interface Mission {
  readonly graph: GraphView
  /** Its tasks in the order they can start: wave by wave, each wave as the graph lays it out. */
  readonly order: ReadonlyArray<NodeView>
  readonly waves: ReadonlyArray<ReadonlyArray<NodeView>>
  /** A task's place in that order, from 1: Althar Cloud 4/12. */
  readonly placeOf: (key: string) => number
  /** The task a board card is, by its task id; undefined for any other work. */
  readonly byTaskId: (taskId: string) => NodeView | undefined
  readonly merged: number
  readonly total: number
  /** Minutes since it was launched. */
  readonly minutes: number
}

/** Where a task needs the person, so that it shows on its own wherever the mission is folded: it asks, it's ready to merge, or it failed. */
export const needsYou = (node: NodeView): boolean => node.stand === 'yours' || node.stand === 'failed'

/** Where a task is on its way: starting or at work. */
export const atWork = (stand: Stand): boolean => stand === 'running' || stand === 'starting'

const cache = new WeakMap<GraphView, Mission>()

export const missionOf = (graph: GraphView, minutes: number): Mission => {
  const known = cache.get(graph)
  if (known !== undefined) return known
  const columns = columnsOf(graph.nodes.map((one) => ({ key: one.key, deps: one.spec.deps })))
  const waves = columns.map((column) => column.map((key) => graph.byKey.get(key) as NodeView))
  const order = waves.flat()
  const places = new Map(order.map((one, i) => [one.key, i + 1]))
  const ids = new Map(graph.nodes.map((one) => [taskIdOf(graph.scenario, one.key), one]))
  const made: Mission = {
    graph,
    order,
    waves,
    placeOf: (key) => places.get(key) ?? 0,
    byTaskId: (taskId) => ids.get(taskId),
    merged: graph.merged,
    total: graph.nodes.length,
    minutes,
  }
  cache.set(graph, made)
  return made
}

/** The mission now, for a component: drawn again as the clock moves. Null while it's still planned. */
export const useMission = (): Mission | null => {
  const world = useWorld()
  const at = useStore(stage)
  // What it's called is said wherever it's drawn.
  useStore(noun)
  if (at !== 'run') return null
  return missionNow(world)
}

/** The mission now, outside React, as the board's seams read it on each draw. */
let last: { world: unknown; graph: GraphView } | null = null
export const missionNow = (world: Parameters<typeof graphOf>[1]): Mission | null => {
  if (stage.get() !== 'run') return null
  if (last?.world !== world) last = { world, graph: graphOf(scenario(), world) }
  return missionOf(last.graph, world.t)
}

/** How long it has run: 40m, 1h 10m. */
export const ranFor = (minutes: number): string => {
  const whole = Math.max(1, Math.floor(minutes))
  return whole < 60 ? `${whole}m` : `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}m`
}

/* ——— the lanes, with some of the mission's tasks taken out ——— */

/**
 * The board's lanes without the tasks `out` picks: out of Up next, Running,
 * Needs you and Settled alike, each lane's count without them.
 */
export const without = (lanes: Lanes, out: (task: BoardTask) => boolean): Lanes => {
  const next = lanes.next.filter((task) => !out(task))
  const running = lanes.running.filter((task) => !out(task))
  const stopped = lanes.stopped.filter((task) => !out(task))
  const settled = lanes.settled.filter((task) => !out(task))
  return {
    ...lanes,
    next,
    upNext: lanes.upNext - (lanes.next.length - next.length) - (lanes.stopped.length - stopped.length),
    running,
    atWork: lanes.atWork - (lanes.running.length - running.length),
    stopped,
    waiting: lanes.waiting.filter((one) => !out(one.task)),
    ready: lanes.ready.filter((task) => !out(task)),
    issues: lanes.issues.filter((task) => !out(task)),
    settled,
    settledTotal: lanes.settledTotal - (lanes.settled.length - settled.length),
  }
}
