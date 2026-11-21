import { useEffect, useLayoutEffect, useRef } from 'react'

import { Markdown } from '@althar/ui'

import { BRIEF, type BoardDef, FLOW } from '../artifacts'
import s from './boards.module.css'

/*
 * One board, at its own size: a screen of Kiln running (kiln.html, as a
 * task's copy serves it), laid out at its device's width and as tall as its
 * page; or what Althar draws for what isn't a design (a brief, a diagram, a
 * chart). A change lands in place, as a hot reload would bring it: a part's
 * look posted to the page, or a style laid on an element. Held for before,
 * it shows as it was.
 */

export type Look = Readonly<Record<string, string>>

/** Where each board's page draws, by its key: what pointing reads. */
export type Frames = Map<string, HTMLIFrameElement>

export const drawnWidth = (def: BoardDef) => (def.draw === 'flow' ? 980 : def.draw === 'chart' ? 900 : 760)

/** A look's styles laid on elements: `style:<selector>` → its CSS. */
const stylesOf = (look: Look) =>
  Object.entries(look).flatMap(([key, value]) =>
    key.startsWith('style:') ? [{ selector: key.slice(6), css: JSON.parse(value) as Record<string, string> }] : [],
  )
const looksOf = (look: Look) => Object.fromEntries(Object.entries(look).filter(([key]) => !key.startsWith('style:')))

export function Board({
  id,
  def,
  width,
  look,
  frames,
  onHeight,
}: {
  /** Its key on the canvas: `artifactId/boardId`. */
  id: string
  def: BoardDef
  width: number
  /** How its parts look now: its own look and what landed since, or as it was while held. */
  look: Look
  frames: Frames
  onHeight: (height: number) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const told = useRef(onHeight)
  useEffect(() => {
    told.current = onHeight
  })
  const loaded = useRef(false)
  const watch = useRef<ResizeObserver | null>(null)
  // The page's height, as it draws and as what lands changes it.
  const measure = () => {
    const doc = frame.current?.contentDocument
    const root = doc?.querySelector<HTMLElement>('#root > div')
    if (root == null) return
    told.current(Math.ceil(root.offsetHeight))
  }
  // Each style laid on an element, with what it was, to take it off again.
  const laid = useRef(new Map<HTMLElement, string | null>())
  const apply = (next: Look) => {
    const doc = frame.current?.contentDocument
    const win = frame.current?.contentWindow
    if (doc == null || win == null) return
    win.postMessage({ kind: 'kiln:look', look: looksOf(next) }, '*')
    for (const [element, was] of laid.current) {
      if (was === null) element.removeAttribute('style')
      else element.setAttribute('style', was)
    }
    laid.current.clear()
    for (const { selector, css } of stylesOf(next)) {
      const element = doc.querySelector<HTMLElement>(selector)
      if (element === null) continue
      laid.current.set(element, element.getAttribute('style'))
      Object.assign(element.style, css)
    }
    window.requestAnimationFrame(measure)
  }
  const wanted = useRef(look)
  wanted.current = look
  const lookKey = JSON.stringify(look)
  useEffect(() => {
    if (loaded.current) apply(wanted.current)
  }, [lookKey])

  useEffect(() => {
    const element = frame.current
    if (element !== null) frames.set(id, element)
    return () => {
      frames.delete(id)
      watch.current?.disconnect()
    }
  }, [frames, id])

  if (def.draw !== undefined) return <Drawn def={def} onHeight={onHeight} />
  return (
    <iframe
      ref={frame}
      className={s.frame}
      title={def.name}
      src={`./kiln.html?${def.shows ?? ''}`}
      tabIndex={-1}
      style={{ width }}
      onLoad={() => {
        const doc = frame.current?.contentDocument
        if (doc == null) return
        // Kiln draws a moment after its page loads, and listens for a look once it has: what landed waits for it.
        let tries = 0
        const ready = () => {
          if (doc.querySelector('#root > div') === null && tries++ < 60) return void window.setTimeout(ready, 30)
          window.setTimeout(() => {
            loaded.current = true
            apply(wanted.current)
          }, 60)
          watch.current?.disconnect()
          watch.current = new ResizeObserver(measure)
          watch.current.observe(doc.body)
          measure()
        }
        ready()
      }}
    />
  )
}

/** What Althar draws for what isn't a design: a document and a diagram in its own Markdown, a chart as a drawing. */
function Drawn({ def, onHeight }: { def: BoardDef; onHeight: (height: number) => void }) {
  const sheet = useRef<HTMLDivElement>(null)
  const told = useRef(onHeight)
  useEffect(() => {
    told.current = onHeight
  })
  useLayoutEffect(() => {
    const box = sheet.current
    if (box === null) return
    const observer = new ResizeObserver(() => told.current(box.offsetHeight))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={sheet} className={s.drawn} style={{ width: drawnWidth(def) }} data-drawn={def.draw}>
      {def.draw === 'brief' ? (
        <Markdown source={BRIEF} size="panel" />
      ) : def.draw === 'flow' ? (
        <Markdown source={`\`\`\`mermaid\n${FLOW}\n\`\`\``} size="panel" />
      ) : (
        <Chart />
      )}
    </div>
  )
}

const WEEKS = [
  { week: '6 Oct', n: 31 },
  { week: '13 Oct', n: 38 },
  { week: '20 Oct', n: 35 },
  { week: '27 Oct', n: 44 },
  { week: '3 Nov', n: 52 },
  { week: '10 Nov', n: 49 },
  { week: '17 Nov', n: 61 },
]

function Chart() {
  const top = 70
  return (
    <figure className={s.chart}>
      <figcaption>
        <strong>Bookings by week</strong>
        <span>Classes booked on the site this autumn</span>
      </figcaption>
      <svg viewBox="0 0 800 340" role="img" aria-label="Bookings by week, rising from 31 to 61">
        {[0, 20, 40, 60].map((n) => (
          <g key={n}>
            <line x1="48" x2="790" y1={300 - (n / top) * 280} y2={300 - (n / top) * 280} className={s.chartRule} />
            <text x="36" y={304 - (n / top) * 280} textAnchor="end" className={s.chartTick}>
              {n}
            </text>
          </g>
        ))}
        {WEEKS.map((one, i) => {
          const h = (one.n / top) * 280
          const x = 70 + i * 104
          return (
            <g key={one.week}>
              <rect x={x} y={300 - h} width="64" height={h} rx="3" className={i === WEEKS.length - 1 ? s.chartBarNow : s.chartBar} />
              <text x={x + 32} y={292 - h} textAnchor="middle" className={s.chartValue}>
                {one.n}
              </text>
              <text x={x + 32} y="326" textAnchor="middle" className={s.chartTick}>
                {one.week}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
