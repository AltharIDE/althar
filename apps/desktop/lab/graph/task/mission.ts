import { useMemo } from 'react'

import { chooseFace } from '../../../src/renderer/features/task/chosenFaces'
import { EFFORTS, leadOf } from '../plan'
import { router, scenario, stage, useStore, useWorld } from '../state'
import { graphOf, type GraphView, listed, type NodeView, taskIdOf } from '../view'

/*
 * Where a task sits in the mission it belongs to, for every option of its
 * page: which step of the plan it is, what came before it and what comes
 * after, and how the whole mission stands. A task that isn't one of the
 * mission's has none, and its page is as it is today.
 */

export interface Place {
  readonly graph: GraphView
  readonly node: NodeView
  /** Its number in the plan, from 1, as the person and the coordinator talk about it: step six. */
  readonly n: number
  readonly of: number
  /** What it depends on, in the plan's order: merged, on its way, or failed. */
  readonly before: ReadonlyArray<NodeView>
  /** What depends on it, in the plan's order. */
  readonly after: ReadonlyArray<NodeView>
}

/** The task's place in its mission, now; null for a task that isn't one of its. */
export const placeOf = (graph: GraphView, slug: string | undefined): Place | null => {
  const node = graph.nodes.find((one) => one.slug === slug)
  if (node === undefined) return null
  const n = graph.nodes.indexOf(node) + 1
  return {
    graph,
    node,
    n,
    of: graph.nodes.length,
    before: graph.nodes.filter((one) => node.now.deps.includes(one.key)),
    after: graph.nodes.filter((one) => one.now.deps.includes(node.key)),
  }
}

/** The task's place, drawn again as the clock and the plan move; null where the mission hasn't launched or the task isn't in it. */
export const usePlace = (slug: string | undefined): Place | null => {
  const world = useWorld()
  const launched = useStore(stage) === 'run'
  const sc = scenario()
  const graph = useMemo(() => graphOf(sc, world), [sc, world])
  return launched ? placeOf(graph, slug) : null
}

/** Neighbours with the one that says the most first: failed, then can't start, then yours, at work, waiting, merged; ties in the plan's order. */
export const loudestFirst = (nodes: ReadonlyArray<NodeView>): ReadonlyArray<NodeView> => {
  const rank = { failed: 0, stuck: 1, yours: 2, running: 3, starting: 3, held: 4, waits: 4, done: 5 } as const
  return nodes.toSorted((a, b) => rank[a.stand] - rank[b.stand])
}

/** Goes to another task of the mission, on its conversation or, where given, another of its views. */
export const goTo = (node: NodeView, face?: string) => {
  if (face !== undefined) chooseFace(taskIdOf(scenario(), node.key), face as 'talk')
  void router.current?.navigate({ to: '/threads/$threadId', params: { threadId: node.threadId } })
}

/** Who leads it, in the plan's words: Opus 5.5, or Opus 5.5 at extra high. */
export const leadWords = (node: NodeView): string => {
  const lead = leadOf(node.spec.model).short
  return node.spec.effort === undefined ? lead : `${lead}, ${EFFORTS[node.spec.effort]}`
}

/** A neighbour as it stands, in a few words: merged as #614, implementing, failed its e2e check. */
export const standWords = (node: NodeView): string => {
  switch (node.stand) {
    case 'done':
      return `merged as #${node.spec.pr}`
    case 'failed':
      return `failed its ${node.spec.breaks?.check ?? ''} check`.replace('  ', ' ')
    case 'waits':
    case 'stuck':
    case 'held':
      return node.word.charAt(0).toLowerCase() + node.word.slice(1)
    default:
      return node.word.charAt(0).toLowerCase() + node.word.slice(1)
  }
}

/** Whether it is the mission's last: everything else is what it waits for, or what that waits for. */
export const isLast = (place: Place): boolean => {
  const { graph, node } = place
  const seen = new Set<string>()
  const walk = (key: string) => {
    for (const dep of graph.byKey.get(key)?.now.deps ?? [])
      if (!seen.has(dep)) {
        seen.add(dep)
        walk(dep)
      }
  }
  walk(node.key)
  return seen.size === graph.nodes.length - 1
}

/** What merging it does to what comes after it, in a sentence; null where nothing comes after. */
export const nextWords = (place: Place): string | null => {
  const { node, after, graph } = place
  if (after.length === 0) return null
  const short = (one: NodeView) => one.spec.short
  const merged = node.stand === 'done'
  const alone = after.filter((one) => one.now.deps.every((dep) => dep === node.key || graph.byKey.get(dep)?.stand === 'done'))
  const others = after.filter((one) => !alone.includes(one))
  // What else each of the rest still waits for: Guide, once VPS proof merges too.
  const waitsToo = (one: NodeView) =>
    one.now.deps
      .filter((dep) => dep !== node.key && graph.byKey.get(dep)?.stand !== 'done')
      .map((dep) => graph.byKey.get(dep)?.spec.short ?? dep)
  const once = (one: NodeView) => {
    const rest = waitsToo(one)
    return `once ${listed(rest)} ${rest.length > 1 ? 'merge' : 'merges'} too`
  }
  const parts: string[] = []
  if (alone.length > 0) parts.push(merged ? `${listed(alone.map(short))} started` : `Merging this starts ${listed(alone.map(short))}`)
  for (const one of others)
    parts.push(alone.length > 0 || merged ? `${one.spec.short} starts ${once(one)}` : `Merging this starts ${one.spec.short} ${once(one)}`)
  return `${parts.join('. ')}.`
}
