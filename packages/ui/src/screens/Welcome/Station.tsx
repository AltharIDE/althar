import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import s from './Station.module.css'

/*
 * One stop on the drafting table. Before it is built it is a dashed plot
 * with its number. Building it sketches the real components inside: every
 * box and every line of text they draw is measured and traced in pencil,
 * top to bottom, and then the components themselves are revealed over the
 * sketch. Once built, its scene plays: a script that changes the scene's
 * state, moves a pointer and presses what it points at, and pins notes to
 * the parts it names.
 */

/* ---- the stage a scene's script drives ----------------------------------- */

export class Cancelled extends Error {}

export interface Stage {
  /** Waits, unless the scene is left first. */
  wait: (ms: number) => Promise<void>
  /** Moves the pointer to the element that shows this text, or matches this selector; `within` narrows where to look. */
  point: (target: string, within?: string) => Promise<void>
  /** Presses what the pointer is on: a real click. */
  press: () => Promise<void>
  /** Puts the pointer away. */
  rest: () => void
}

interface StationContext {
  content: RefObject<HTMLDivElement | null>
  /** Station pixels per screen pixel, for measuring under the camera. */
  unscale: () => number
}

const Ctx = createContext<StationContext | null>(null)

/** Finds the deepest element whose own text includes `target`, or the first match for a selector (starting with [ . or #). */
export function find(root: HTMLElement, target: string): HTMLElement | null {
  if (/^[[.#]/.test(target)) return root.querySelector<HTMLElement>(target)
  let best: HTMLElement | null = null
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.textContent?.includes(target) && n.parentElement) {
      best = n.parentElement
      break
    }
  }
  if (best) return best
  /* the text is split across children: take the smallest element holding all of it */
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*')).reverse()) if (el.textContent?.includes(target)) return el
  return null
}

/** Where an element sits inside the station's content, in station pixels. */
export function rectIn(content: HTMLElement, el: Element, unscale: number) {
  const a = content.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  return { x: (b.left - a.left) * unscale, y: (b.top - a.top) * unscale, w: b.width * unscale, h: b.height * unscale }
}

/**
 * Where an element sits inside the station's content by layout alone, in
 * station pixels: transforms, a glide's or the camera's, don't move it. Falls
 * back to measuring the screen when the element isn't laid out under the root.
 */
export function layoutIn(root: HTMLElement, el: Element, unscale: () => number) {
  let x = 0
  let y = 0
  let n: Element | null = el
  while (n instanceof HTMLElement && n !== root) {
    x += n.offsetLeft
    y += n.offsetTop
    const up: Element | null = n.offsetParent
    if (up instanceof HTMLElement && up !== root) {
      x += up.clientLeft
      y += up.clientTop
    }
    n = up
  }
  if (n !== root || !(el instanceof HTMLElement)) return rectIn(root, el, unscale())
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

/* ---- the station ---------------------------------------------------------- */

export interface StationProps {
  n: number
  label: string
  x: number
  y: number
  /** The table is in view: the plot is pegged out. */
  shown: boolean
  /** Sketched and revealed. */
  built: boolean
  /** Arrive built, with no sketch: stills and reduced motion. */
  instant: boolean
  /** The scene: its components, its notes and its pointer, all in station pixels. */
  children: ReactNode
}

export function Station({ n, label, x, y, shown, built, instant, children }: StationProps) {
  const content = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const unscale = useCallback(() => {
    const el = frame.current
    return el && el.getBoundingClientRect().width ? el.offsetWidth / el.getBoundingClientRect().width : 1
  }, [])
  const ctx = useMemo(() => ({ content, unscale }), [unscale])
  return (
    <Ctx.Provider value={ctx}>
      <div
        ref={frame}
        data-stop={n}
        className={cx(s.station, shown && s.shown, built && s.built, instant && s.instant)}
        style={{ left: x, top: y, ...cssVars({ '--n': n }) }}
      >
        <span className={s.plot} aria-hidden="true" />
        <span className={s.tag} aria-hidden="true">
          <span className={s.numeral}>{String(n).padStart(2, '0')}</span>
          <span className={s.label}>{label}</span>
        </span>
        <div ref={content} className={s.content} inert aria-hidden="true">
          {children}
        </div>
        {built && !instant && <Sketch contentRef={content} unscale={unscale} />}
      </div>
    </Ctx.Provider>
  )
}

/* ---- the sketch: the real layout, traced ------------------------------------ */

interface Shape {
  kind: 'box' | 'text'
  x: number
  y: number
  w: number
  h: number
  r: number
}

const MAX_SHAPES = 180

function measure(root: HTMLElement, unscale: number): Shape[] {
  const shapes: Shape[] = []
  const a = root.getBoundingClientRect()
  const at = (r: DOMRect) => ({ x: (r.left - a.left) * unscale, y: (r.top - a.top) * unscale, w: r.width * unscale, h: r.height * unscale })
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (shapes.length >= MAX_SHAPES) break
    const css = getComputedStyle(el)
    if (css.display === 'none' || css.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    const filled = css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.backgroundColor !== 'transparent'
    const edged = css.boxShadow !== 'none' || parseFloat(css.borderTopWidth) > 0
    if (filled || edged) shapes.push({ kind: 'box', ...at(r), r: Math.min(parseFloat(css.borderTopLeftRadius) || 0, 14) })
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  /* a page that cannot measure a run of text gets its boxes alone */
  if (typeof range.getClientRects !== 'function') return shapes
  for (let t = walk.nextNode(); t && shapes.length < MAX_SHAPES; t = walk.nextNode()) {
    if (!t.textContent?.trim()) continue
    range.selectNodeContents(t)
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 4) continue
      shapes.push({ kind: 'text', ...at(r), r: 0 })
    }
  }
  return shapes
}

function Sketch({ contentRef, unscale }: { contentRef: RefObject<HTMLDivElement | null>; unscale: () => number }) {
  const [shapes, setShapes] = useState<Shape[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setShapes(measure(el, unscale()))
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [contentRef, unscale])
  if (!shapes.length) return null
  return (
    <svg className={s.sketch} viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h} aria-hidden="true">
      {shapes.map((p, i) => {
        /* pencil moves down the sheet, so each line starts by where it is */
        const style = cssVars({ '--d': `${Math.round((p.y / Math.max(size.h, 1)) * 620 + (p.x / Math.max(size.w, 1)) * 120)}ms` })
        return p.kind === 'box' ? (
          <rect
            key={i}
            x={p.x + 0.5}
            y={p.y + 0.5}
            width={p.w - 1}
            height={p.h - 1}
            rx={p.r}
            pathLength={1}
            className={s.box}
            style={style}
          />
        ) : (
          <path key={i} d={`M${p.x} ${p.y + p.h * 0.62}H${p.x + p.w}`} pathLength={1} className={s.text} style={style} />
        )
      })}
    </svg>
  )
}

/* ---- notes pinned to parts ------------------------------------------------- */

/** Whether an element draws a box: a fill, a shadow, or a border all round. */
function boxed(el: Element) {
  const c = getComputedStyle(el)
  const filled = c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent'
  const edged =
    c.boxShadow !== 'none' || [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth].every((w) => parseFloat(w) > 0)
  return filled || edged
}

/** What lights when the pointer is over something: a card's stretched title lights the card; a control lights itself. */
function pressBox(root: HTMLElement, press: HTMLElement): Element {
  const after = getComputedStyle(press, '::after')
  if (after.position === 'absolute' && after.content !== 'none' && after.content !== 'normal')
    return boxOf(root, press.parentElement ?? press)
  return press.matches('button, [role="radio"], a') ? press : boxOf(root, press)
}

/** The box around an element: the nearest one (itself included), or the outermost one inside the scene. */
export function boxOf(root: HTMLElement, el: Element, which: 'near' | 'far' = 'near'): Element {
  let found: Element | null = null
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    if (!boxed(n)) continue
    found = n
    if (which === 'near') break
  }
  return found ?? el
}

export interface NoteProps {
  /** The text it points at, or a selector. */
  target: string
  label: string
  /** Which edge the leader leaves from. */
  side: 'left' | 'right' | 'top' | 'bottom'
  /**
   * The box whose edge the leader leaves from: the nearest one around the
   * target, or the outermost one in the scene. The leader starts on that
   * edge, level with the target, so it never crosses what is inside.
   */
  from?: 'near' | 'far'
  /** How far out the label sits, in station pixels. */
  reach?: number
  /** Slides the label along the edge. */
  shift?: number
}

interface Pin {
  x: number
  y: number
}

/** A leader from a part of the scene to its name, drafted: a dot on the part's edge, a line out, a shoulder, the words. */
export function Note({ target, label, side, from = 'near', reach = 56, shift = 0 }: NoteProps) {
  const ctx = useContext(Ctx)
  const [at, setAt] = useState<Pin | null>(null)
  const contentRef = ctx?.content
  const unscale = ctx?.unscale
  /*
   * Measured from layout, which a glide or the camera's transform doesn't
   * move, and again whenever the scene changes, so it follows the part.
   */
  useLayoutEffect(() => {
    const root = contentRef?.current
    if (!root || !unscale) return
    const measure = () => {
      const el = find(root, target)
      if (!el) return
      const r = layoutIn(root, el, unscale)
      const b = layoutIn(root, boxOf(root, el, from), unscale)
      const along = r.x + Math.min(r.w / 2, 60)
      const next =
        side === 'left'
          ? { x: b.x, y: r.y + r.h / 2 }
          : side === 'right'
            ? { x: b.x + b.w, y: r.y + r.h / 2 }
            : side === 'top'
              ? { x: along, y: b.y }
              : { x: along, y: b.y + b.h }
      setAt((was) => (was && Math.abs(was.x - next.x) < 0.5 && Math.abs(was.y - next.y) < 0.5 ? was : next))
    }
    measure()
    if (typeof MutationObserver === 'undefined') return
    const changes = new MutationObserver(measure)
    changes.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
    return () => changes.disconnect()
  }, [contentRef, unscale, target, side, from])
  if (!at) return null
  const normal = side === 'left' ? [-1, 0] : side === 'right' ? [1, 0] : side === 'top' ? [0, -1] : [0, 1]
  const across = side === 'left' || side === 'right' ? [0, 1] : [1, 0]
  const stub = { x: at.x + normal[0]! * 12, y: at.y + normal[1]! * 12 }
  const end = { x: at.x + normal[0]! * reach + across[0]! * shift, y: at.y + normal[1]! * reach + across[1]! * shift }
  const leftward = side === 'left' || (side !== 'right' && end.x < at.x)
  const shoulder = leftward ? -16 : 16
  const d = `M${at.x} ${at.y}L${stub.x} ${stub.y}L${end.x} ${end.y}h${shoulder}`
  return (
    <span className={s.note} style={{ left: 0, top: 0 }}>
      <svg className={s.leader} aria-hidden="true">
        <path d={d} pathLength={1} className={s.casing} />
        <path d={d} pathLength={1} className={s.line} />
        <circle cx={at.x} cy={at.y} r={2.5} className={s.dot} />
      </svg>
      <span className={cx(s.noteLabel, leftward && s.noteLeft)} style={{ left: end.x + shoulder + (leftward ? -6 : 6), top: end.y }}>
        {label}
      </span>
    </span>
  )
}

/* ---- the pointer and the script ------------------------------------------- */

interface Hand {
  x: number
  y: number
  down: boolean
  shown: boolean
  /** What it is over, washed as a hover would: its box in station pixels, and its corner radius. */
  over: { x: number; y: number; w: number; h: number; r: number } | null
}

const RESTING: Hand = { x: 0, y: 0, down: false, shown: false, over: null }

/** Runs a scene's script once it is live; if the scene is left or arrives instant, jumps to its end instead. */
export function useScene(live: boolean, instant: boolean, script: (stage: Stage) => Promise<void>, end: () => void) {
  const ctx = useContext(Ctx)
  const [hand, setHand] = useState<Hand>(RESTING)
  const started = useRef(false)
  const finished = useRef(false)
  const pointed = useRef<{ press: HTMLElement; box: Element } | null>(null)
  const scriptRef = useRef(script)
  const endRef = useRef(end)
  useLayoutEffect(() => {
    scriptRef.current = script
    endRef.current = end
  })

  useEffect(() => {
    if (finished.current) return
    const finish = () => {
      finished.current = true
      setHand(RESTING)
      endRef.current()
    }
    if (instant) return finish()
    /* left before it finished: show how it ends */
    if (!live) {
      if (started.current) finish()
      return
    }
    started.current = true
    let gone = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const wait = (ms: number) =>
      new Promise<void>((done, fail) => {
        if (gone) return fail(new Cancelled())
        const t = setTimeout(() => {
          timers.delete(t)
          if (gone) fail(new Cancelled())
          else done()
        }, ms)
        timers.add(t)
      })
    const stage: Stage = {
      wait,
      point: async (target, within) => {
        const root = ctx?.content.current
        const scope = within ? root?.querySelector<HTMLElement>(within) : root
        const el = root && scope && find(scope, target)
        if (!root || !el) return
        const press = el.closest<HTMLElement>('button, [role="radio"], a') ?? el
        const box = pressBox(root, press)
        pointed.current = { press, box }
        const k = ctx.unscale()
        const r = rectIn(root, el, k)
        setHand((h) => ({ ...h, x: r.x + Math.min(r.w * 0.5, 48), y: r.y + r.h * 0.55, shown: true, over: null }))
        await wait(560)
        /* arrived: what it is over lights as a hover would */
        const b = rectIn(root, box, k)
        setHand((h) => ({ ...h, over: { ...b, r: Math.min(parseFloat(getComputedStyle(box).borderTopLeftRadius) || 6, 14) } }))
        await wait(220)
      },
      press: async () => {
        const at = pointed.current
        setHand((h) => ({ ...h, down: true }))
        /* the part gives under the press, as it does under a finger */
        const big = at && at.box.getBoundingClientRect().width > 200
        if (at && typeof at.box.animate === 'function')
          at.box.animate([{ transform: 'none' }, { transform: `scale(${big ? 0.985 : 0.95})`, offset: 0.4 }, { transform: 'none' }], {
            duration: 340,
            easing: 'cubic-bezier(0.3, 0, 0.2, 1)',
          })
        await wait(150)
        at?.press.click()
        await wait(120)
        setHand((h) => ({ ...h, down: false, over: null }))
        await wait(230)
      },
      rest: () => setHand((h) => ({ ...h, shown: false, over: null })),
    }
    scriptRef
      .current(stage)
      .then(() => {
        if (!gone) finish()
      })
      .catch((e: unknown) => {
        if (!(e instanceof Cancelled)) throw e
      })
    /* torn down mid-run (or by StrictMode's second mount): the next run starts again, or the scene is left and ends */
    return () => {
      gone = true
      timers.forEach(clearTimeout)
    }
  }, [live, instant, ctx])

  return <Pointer {...hand} />
}

function Pointer({ x, y, down, shown, over }: Hand) {
  return (
    <>
      <span
        className={cx(s.wash, over && s.washOn, down && s.washDown)}
        style={over ? { left: over.x, top: over.y, width: over.w, height: over.h, borderRadius: over.r } : undefined}
        aria-hidden="true"
      />
      <span
        className={cx(s.pointer, shown && s.pointerShown, down && s.pointerDown)}
        style={{ transform: `translate(${x}px, ${y}px)` }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 22" width="20" height="22">
          <path d="M2 1.5L2 17.2L6.3 13.4L9.2 20L12 18.8L9.2 12.4L15 12.4Z" />
        </svg>
        <span className={s.pressRing} />
      </span>
    </>
  )
}
