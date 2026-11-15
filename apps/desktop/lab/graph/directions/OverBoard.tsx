import { useEffect, useMemo, useRef, useState } from 'react'

import { IconButton } from '@althar/ui'

import { scenario, useWorld } from '../state'
import { graphOf, lay, taskIdOf } from '../view'
import { Mark, Node, openTask, useWidth, Wires } from '../graph/parts'
import s from './OverBoard.module.css'

/*
 * B · Over the board. Each request in flight is a band across the top of
 * the board, its tasks left to right in the order they can start, each a
 * mark and a name, a line from each into what waits for it. It reads in a
 * glance and leaves the lanes as they are: pointing at a task in the band
 * finds its card below, and pointing at a card finds it in the band. Folded,
 * the band is one line: the request and where it stands. Where its names
 * don't fit, as beside the conversation in a narrow window, each task is its
 * mark alone, and its name is in its detail.
 */

const SIZE = { w: 118, h: 30 }
const GAP = 32
const PITCH = 8
/** A task as its mark alone, where the names don't fit. */
const DOT = { w: 28, h: 28 }
const DOT_GAP = 16

/** The card of a task on the board, by its key: the board gives each its task's id as `data-move`. */
const cardOf = (taskId: string) => document.querySelector<HTMLElement>(`[data-lane] [data-move="${CSS.escape(taskId)}"]`)

export function Band() {
  const world = useWorld()
  const sc = scenario()
  const graph = useMemo(() => graphOf(sc, world), [sc, world])
  const shape = graph.nodes.map((one) => `${one.key}:${one.now.deps.join(',')}`).join(' ')
  const scroll = useRef<HTMLDivElement>(null)
  const room = useWidth(scroll)
  const { laid, small, gap } = useMemo(
    () => {
      const nodes = graph.nodes.map((one) => ({ key: one.key, deps: one.now.deps }))
      const named = lay(nodes, SIZE, GAP, PITCH)
      if (room === 0 || named.w <= room) return { laid: named, small: false, gap: GAP }
      return { laid: lay(nodes, DOT, DOT_GAP, PITCH), small: true, gap: DOT_GAP }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, room],
  )
  const [open, setOpen] = useState(true)
  // The task pointed at, in the band or on the board.
  const [lit, setLit] = useState<string | null>(null)

  // A card pointed at on the board lights its task here.
  useEffect(() => {
    const keys = new Map(sc.tasks.map((one) => [taskIdOf(sc, one.key), one.key]))
    const over = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[data-band]') !== null) return
      const id = event.target.closest('[data-lane] [data-move]')?.getAttribute('data-move') ?? null
      setLit(id === null ? null : (keys.get(id) ?? null))
    }
    document.addEventListener('pointerover', over)
    return () => document.removeEventListener('pointerover', over)
  }, [sc])

  // A task pointed at here lights its card on the board.
  useEffect(() => {
    if (lit === null) return
    const card = cardOf(taskIdOf(sc, lit))
    card?.setAttribute('data-lit', '')
    return () => card?.removeAttribute('data-lit')
  }, [lit, sc, world])

  const needs = graph.nodes.filter((one) => one.stand === 'yours' || one.stand === 'failed')
  return (
    <section className={s.band} data-band="" aria-label={sc.name}>
      <header className={s.head}>
        <span className={[s.status, s[graph.stand.tone]].join(' ')}>
          <Mark
            stand={
              graph.stand.tone === 'signal'
                ? 'yours'
                : graph.stand.tone === 'live'
                  ? 'running'
                  : graph.stand.tone === 'danger'
                    ? 'failed'
                    : graph.merged === graph.nodes.length
                      ? 'done'
                      : 'waits'
            }
          />
          {graph.stand.word}
        </span>
        <h2 className={s.title}>{sc.name}</h2>
        {!open && needs.length > 0 && (
          <span className={s.folded}>
            {needs.map((one) => (
              <button key={one.key} type="button" className={[s.need, s[one.tone]].join(' ')} onClick={() => openTask(one)}>
                {one.spec.short}: {one.word}
              </button>
            ))}
          </span>
        )}
        <span className={s.count}>
          {graph.merged} of {graph.nodes.length} merged
        </span>
        <IconButton
          icon={open ? 'chevronU' : 'chevronD'}
          size="small"
          label={open ? 'Fold' : 'Unfold'}
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        />
      </header>
      {open && (
        <div className={s.scroll} ref={scroll}>
          <div className={s.canvas} style={{ width: laid.w, height: laid.h }} onPointerLeave={() => setLit(null)}>
            <Wires laid={laid} edges={graph.edges} gap={gap} lit={lit} heads={!small} />
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
                  <Node node={node} graph={graph} placement="below">
                    <button
                      type="button"
                      className={[s.pill, s[node.stand], small && s.dot, lit === node.key && s.lit].filter(Boolean).join(' ')}
                      aria-label={small ? node.spec.short : undefined}
                      onClick={() => openTask(node)}
                    >
                      <Mark stand={node.stand} />
                      {!small && <span className={s.name}>{node.spec.short}</span>}
                    </button>
                  </Node>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
