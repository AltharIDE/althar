import { type ComponentProps, useMemo, useRef, useState } from 'react'

import { Model } from '@althar/ui'

import { chooseFace } from '../../../src/renderer/features/task/chosenFaces'
import { router, scenario, useWorld } from '../state'
import { graphOf, type GraphView, lay, type NodeView, taskIdOf } from '../view'
import { Mark, modelOf, Node, useWidth, Wires } from '../graph/parts'
import s from './OnTaskPage.module.css'

/*
 * C · On a task's page. Each task of a request has a Request view beside
 * Conversation and Outputs: the request it came from, in the person's own
 * words, and the whole graph, this task marked in it. There is room here
 * for each task to say more: where it stands, its pull request, who leads
 * it and for how long. Pressing another task goes to its page, on the same
 * view, so the graph can be walked task by task.
 */

const SIZE = { w: 216, h: 92 }
const GAP = 56
const PITCH = 18

/** Goes to another task of the request, on its Request view. */
const walkTo = (node: NodeView) => {
  chooseFace(taskIdOf(scenario(), node.key), 'request' as 'talk')
  void router.current?.navigate({ to: '/threads/$threadId', params: { threadId: node.threadId } })
}

/** A task, as the popover's trigger: it takes the trigger's props and ref, and goes to its task on a press. */
function Tile({ node, here, ...rest }: { node: NodeView; here: boolean } & ComponentProps<'button'>) {
  const corner = node.stand === 'done' ? null : node.worked === null ? null : `${node.worked}m`
  return (
    <button
      type="button"
      {...rest}
      className={[s.tile, s[node.stand], here && s.here].filter(Boolean).join(' ')}
      onClick={() => !here && walkTo(node)}
    >
      <span className={[s.stands, s[node.tone]].join(' ')}>
        <Mark stand={node.stand} />
        <span className={s.word}>{node.word}</span>
        {node.pr !== null && <span className={s.pr}>{node.pr}</span>}
      </span>
      <span className={s.title}>{node.spec.title}</span>
      <span className={s.foot}>
        <Model model={modelOf(node)} short className={s.model} />
        {here ? <span className={s.thisTask}>This task</span> : corner !== null && <span className={s.corner}>{corner}</span>}
      </span>
    </button>
  )
}

export function RequestFace({ slug }: { slug: string }) {
  const world = useWorld()
  const sc = scenario()
  const graph: GraphView = useMemo(() => graphOf(sc, world), [sc, world])
  const shape = graph.nodes.map((one) => `${one.key}:${one.now.deps.join(',')}`).join(' ')
  const laid = useMemo(
    () =>
      lay(
        graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps })),
        SIZE,
        GAP,
        PITCH,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )
  const [lit, setLit] = useState<string | null>(null)
  const here = graph.nodes.find((one) => one.slug === slug) ?? null
  // Drawn smaller where it is wider than the view, down to three quarters; past that, the view scrolls.
  const canvas = useRef<HTMLDivElement>(null)
  const room = useWidth(canvas)
  const scale = room === 0 ? 1 : Math.max(0.75, Math.min(1, room / laid.w))
  return (
    <div className={s.face}>
      <header className={s.head}>
        <div className={s.what}>
          <h2 className={s.name}>{sc.name}</h2>
          <p className={s.asked}>{sc.asked}</p>
        </div>
        <span className={[s.status, s[graph.stand.tone]].join(' ')}>{graph.stand.word}</span>
        <span className={s.count}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </header>
      <div className={s.canvas} ref={canvas}>
        <div className={s.room} style={{ width: laid.w * scale, height: laid.h * scale }}>
          <div
            className={s.world}
            style={{ width: laid.w, height: laid.h, transform: `scale(${scale})` }}
            onPointerLeave={() => setLit(null)}
          >
            <Wires laid={laid} edges={graph.edges} gap={GAP} lit={lit ?? here?.key ?? null} />
            {graph.nodes.map((node) => {
              const box = laid.boxes.get(node.key)
              if (box === undefined) return null
              const mine = node.key === here?.key
              return (
                <div
                  key={node.key}
                  className={s.place}
                  data-node={node.key}
                  style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
                  onPointerEnter={() => setLit(node.key)}
                >
                  <Node node={node} graph={graph} placement="below">
                    <Tile node={node} here={mine} />
                  </Node>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
