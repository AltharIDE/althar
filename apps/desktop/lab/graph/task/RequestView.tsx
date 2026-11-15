import { type ComponentProps, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { scenario } from '../state'
import { type GraphView, lay, type NodeView } from '../view'
import { Mark, Node, Wires } from '../graph/parts'
import { word } from '../plan'
import { Lead, Notes } from './Brief'
import { goTo, usePlace } from './mission'
import s from './RequestView.module.css'

/*
 * C · A view of its own. Each task of a mission has a view beside
 * Conversation and Outputs (r), named as the mission is: the mission in a
 * line, this step as the plan gave it, and the whole mission on the Graph
 * view's dotted canvas, this task ringed in it: left to right, or top to
 * bottom where the window is narrow.
 * Each task says where it stands and opens its detail on pointing; pressing
 * one goes to its page on the same view, so the mission can be walked.
 */

const SIZE = { w: 172, h: 54 }
const GAP = 40
const PITCH = 14
/** Drawn smaller to fit, down to this; past it, the canvas scrolls. */
const LEAST = 0.72

/** Goes to another task of the mission, on this view. */
const walkTo = (node: NodeView) => goTo(node, 'request')

/** A task, as the popover's trigger: it takes the trigger's props and ref, and goes to its task on a press. */
function Tile({ node, here, ...rest }: { node: NodeView; here: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...rest}
      className={[s.tile, s[node.stand], here && s.here].filter(Boolean).join(' ')}
      aria-current={here ? 'page' : undefined}
      onClick={() => !here && walkTo(node)}
    >
      <span className={s.title}>
        <span className={s.short}>{node.spec.short}</span>
        {node.pr !== null && <span className={s.pr}>{node.pr}</span>}
      </span>
      <span className={[s.stands, s[node.tone]].join(' ')}>
        <Mark stand={node.stand} />
        <span className={s.word}>{node.word}</span>
      </span>
    </button>
  )
}

/** How big an element is inside its padding, as it changes; 0 by 0 until it is measured. */
const useRoom = (ref: RefObject<HTMLElement | null>, ready: boolean) => {
  const [room, setRoom] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => {
      const style = getComputedStyle(element)
      // Its whole box, scrollbars and all, so a scrollbar the drawing brings never changes the room it was drawn for.
      const w = Math.round(element.offsetWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight))
      const h = Math.round(element.offsetHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom))
      setRoom((was) => (was.w === w && was.h === h ? was : { w, h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, ready])
  return room
}

export function RequestFace({ slug }: { slug: string }) {
  const place = usePlace(slug)
  const sc = scenario()
  const graph: GraphView | null = place?.graph ?? null
  const shape = graph?.nodes.map((one) => `${one.key}:${one.now.deps.join(',')}`).join(' ') ?? ''
  const nodes = useMemo(
    () => (graph?.nodes ?? []).map((one) => ({ key: one.key, deps: one.now.deps })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape],
  )
  // Left to right, or top to bottom where that draws it larger: in the narrow window, or beside the conversation.
  const across = useMemo(() => lay(nodes, SIZE, GAP, PITCH), [nodes])
  const down = useMemo(() => lay(nodes, SIZE, GAP, PITCH, true), [nodes])
  const [lit, setLit] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const room = useRoom(canvas, place !== null)
  if (place === null || graph === null) return null
  const { node: here } = place
  const fit = (one: typeof across) => (room.w === 0 ? 1 : Math.min(1, room.w / one.w, room.h / one.h))
  const isDown = fit(down) > fit(across) + 0.02
  const laid = isDown ? down : across
  const scale = Math.max(LEAST, fit(laid))
  return (
    <div className={s.face}>
      <header className={s.head}>
        <div className={s.what}>
          <h2 className={s.name}>
            {sc.name}
            <span className={s.noun}>{word()}</span>
          </h2>
          <p className={s.asked} title={sc.asked}>
            {sc.asked}
          </p>
        </div>
        <span className={s.count}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
      </header>
      <section className={s.step} aria-label={`Step ${place.n}: ${here.spec.short}`}>
        <div className={s.stepMain}>
          <p className={s.stepName}>
            <span className={s.ring} aria-hidden="true" />
            Step {place.n} · {here.spec.short}
          </p>
          <p className={s.stepWhat}>{here.spec.what}</p>
          <p className={s.stepWhy}>{here.spec.why}</p>
        </div>
        <div className={s.stepSide}>
          <Notes node={here} />
          <Lead node={here} />
        </div>
      </section>
      <div className={s.canvas} ref={canvas}>
        <div className={s.room} style={{ width: laid.w * scale, height: laid.h * scale }}>
          <div
            className={s.world}
            style={{ width: laid.w, height: laid.h, transform: `scale(${scale})` }}
            onPointerLeave={() => setLit(null)}
          >
            <Wires laid={laid} edges={graph.edges} gap={GAP} down={isDown} lit={lit ?? here.key} />
            {graph.nodes.map((node) => {
              const box = laid.boxes.get(node.key)
              if (box === undefined) return null
              return (
                <div
                  key={node.key}
                  className={s.place}
                  data-node={node.key}
                  style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
                  onPointerEnter={() => setLit(node.key)}
                >
                  <Node node={node} graph={graph} placement={isDown ? 'right' : 'below'}>
                    <Tile node={node} here={node.key === here.key} />
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
