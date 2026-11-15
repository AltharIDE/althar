import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { scenario, useWorld } from '../state'
import { type EdgeView, graphOf, taskIdOf } from '../view'
import s from './Threads.module.css'

/*
 * D · The board as the graph. Nothing new to read: the board's own cards
 * are the graph's tasks. At rest the board is as it is, and each task that
 * waits says in Up next what it waits for. Pointing at a card of the
 * request draws its line (what it waited for, what waits for it) between
 * the cards themselves, and the rest of the board steps back.
 */

interface Rect {
  readonly l: number
  readonly t: number
  readonly r: number
  readonly b: number
}

/** Where each of the request's cards is on the board, in the board's own coordinates; a card scrolled out of its lane is held to the lane's edge. */
const measure = (root: HTMLElement, ids: ReadonlyArray<string>): Map<string, Rect> => {
  const origin = root.getBoundingClientRect()
  const out = new Map<string, Rect>()
  for (const id of ids) {
    const card = root.querySelector<HTMLElement>(`[data-lane] [data-move="${CSS.escape(id)}"]`)
    if (card === null) continue
    const at = card.getBoundingClientRect()
    const lane = card.closest('[data-lane]')?.getBoundingClientRect()
    const top = lane === undefined ? at.top : Math.max(at.top, lane.top + 40)
    const bottom = lane === undefined ? at.bottom : Math.min(at.bottom, lane.bottom)
    if (bottom <= top) continue
    out.set(id, { l: at.left - origin.left, t: top - origin.top, r: at.right - origin.left, b: bottom - origin.top })
  }
  return out
}

const keyOf = (rects: Map<string, Rect>) =>
  [...rects].map(([id, r]) => `${id}:${Math.round(r.l)},${Math.round(r.t)},${Math.round(r.r)},${Math.round(r.b)}`).join(' ')

/** A line from the card of what a task depends on into the task's card, curving through the gap between them. */
const curve = (from: Rect, to: Rect): string => {
  const fy = (from.t + from.b) / 2
  const ty = (to.t + to.b) / 2
  // What it waits for is to the right, as it is once it runs: out of its left side into the task's right.
  if (from.l >= to.r - 4) {
    const dx = Math.max(24, (from.l - to.r) / 2)
    return `M ${from.l} ${fy} C ${from.l - dx} ${fy}, ${to.r + dx} ${ty}, ${to.r} ${ty}`
  }
  // To the left, as where the task was started first: out of its right side into the task's left.
  if (from.r <= to.l + 4) {
    const dx = Math.max(24, (to.l - from.r) / 2)
    return `M ${from.r} ${fy} C ${from.r + dx} ${fy}, ${to.l - dx} ${ty}, ${to.l} ${ty}`
  }
  // In the same lane: round its right side, from one card's edge into the other's.
  const x = Math.max(from.r, to.r)
  const bulge = 18 + Math.min(18, Math.abs(ty - fy) / 12)
  return `M ${from.r} ${fy} C ${x + bulge} ${fy}, ${x + bulge} ${ty}, ${to.r} ${ty}`
}

export function Threads({ children }: { children: ReactNode }) {
  const world = useWorld()
  const sc = scenario()
  const graph = useMemo(() => graphOf(sc, world), [sc, world])
  const ref = useRef<HTMLDivElement>(null)
  const [{ rects, w, h }, setRects] = useState<{ rects: Map<string, Rect>; w: number; h: number }>({ rects: new Map(), w: 0, h: 0 })
  const [lit, setLit] = useState<string | null>(null)
  const ids = useMemo(() => sc.tasks.map((one) => taskIdOf(sc, one.key)), [sc])
  const keys = useMemo(() => new Map(sc.tasks.map((one) => [taskIdOf(sc, one.key), one.key])), [sc])

  // The cards move as the work does, and with the board's own motion: measured each frame, drawn only when they moved.
  useEffect(() => {
    let last = ''
    let frame = 0
    const step = () => {
      const root = ref.current
      if (root !== null) {
        const now = measure(root, ids)
        const size = root.getBoundingClientRect()
        const key = `${keyOf(now)} ${Math.round(size.width)}x${Math.round(size.height)}`
        if (key !== last) {
          last = key
          setRects({ rects: now, w: size.width, h: size.height })
        }
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [ids])

  // Pointing at one of the request's cards brings its line forward.
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    const over = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const id = event.target.closest('[data-lane] [data-move]')?.getAttribute('data-move') ?? null
      setLit(id === null ? null : (keys.get(id) ?? null))
    }
    const out = () => setLit(null)
    root.addEventListener('pointerover', over)
    root.addEventListener('pointerleave', out)
    return () => {
      root.removeEventListener('pointerover', over)
      root.removeEventListener('pointerleave', out)
    }
  }, [keys])

  // The cards off its line step back while one is pointed at.
  const near = useMemo(() => {
    if (lit === null) return null
    const node = graph.byKey.get(lit)
    if (node === undefined) return null
    const kids = graph.edges.filter((edge) => edge.from === lit).map((edge) => edge.to)
    return new Set([lit, ...node.now.deps, ...kids])
  }, [lit, graph])
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    root.toggleAttribute('data-spot', near !== null)
    const cards = [...root.querySelectorAll<HTMLElement>('[data-lane] [data-move]')]
    for (const card of cards) {
      const key = keys.get(card.getAttribute('data-move') ?? '')
      card.toggleAttribute('data-near', near !== null && key !== undefined && near.has(key))
    }
  }, [near, keys, world])

  const shown: ReadonlyArray<EdgeView> = lit === null ? [] : graph.edges.filter((edge) => edge.from === lit || edge.to === lit)
  return (
    <div ref={ref} className={s.threads}>
      <svg className={s.over} width={w} height={h} aria-hidden="true">
        <defs>
          {(['met', 'waits', 'you', 'stuck'] as const).map((look) => (
            <marker
              key={look}
              id={`thread-${look}`}
              viewBox="0 0 6 6"
              refX="5.5"
              refY="3"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0.6 L 5.6 3 L 0 5.4 z" className={s[`head_${look}`]} />
            </marker>
          ))}
        </defs>
        {shown.map((edge) => {
          const from = rects.get(taskIdOf(sc, edge.from))
          const to = rects.get(taskIdOf(sc, edge.to))
          if (from === undefined || to === undefined) return null
          return (
            <path
              key={`${edge.from}>${edge.to}`}
              d={curve(from, to)}
              className={[s.line, s[edge.look], lit !== null && s.lit].filter(Boolean).join(' ')}
              markerEnd={`url(#thread-${edge.look})`}
            />
          )
        })}
      </svg>
      <div className={s.board}>{children}</div>
    </div>
  )
}
