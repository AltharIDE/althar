import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'

import { inkVar } from './words.ts'
import type { Ink } from './facts.ts'
import s from './charts.module.css'

/*
 * The pieces the directions draw their charts from: one hover tip for the
 * page, a legend, a line of days against the period before, and a bar of
 * parts. Thin marks, a 2px gap of the surface between parts, text in the
 * text inks, colour only on marks (the dataviz rules), in the project inks.
 */

interface Tip {
  readonly x: number
  readonly y: number
  readonly content: ReactNode
}

const TipContext = createContext<(tip: Tip | null) => void>(() => undefined)

/** The page's one tip: what a mark says as the pointer rests on it. Drawn inside the window, which positions against itself. */
export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const place = useCallback((next: Tip | null) => {
    const box = ref.current?.getBoundingClientRect()
    setTip(next === null || box === undefined ? null : { ...next, x: next.x - box.left, y: next.y - box.top })
  }, [])
  return (
    <TipContext.Provider value={place}>
      <div ref={ref} className={s.layer}>
        {children}
        {tip !== null && (
          <div className={s.tip} style={{ left: tip.x, top: tip.y }} role="tooltip">
            {tip.content}
          </div>
        )}
      </div>
    </TipContext.Provider>
  )
}

/** Props for a mark that says something as it is pointed at. */
export const useTip = () => {
  const set = useContext(TipContext)
  return (content: ReactNode) => ({
    onPointerMove: (event: { clientX: number; clientY: number }) => set({ x: event.clientX, y: event.clientY, content }),
    onPointerLeave: () => set(null),
  })
}

export function TipLines({ title, lines }: { title: ReactNode; lines: ReadonlyArray<ReactNode> }) {
  return (
    <>
      <div className={s.tipTitle}>{title}</div>
      {lines.map((line, i) => (
        <div key={i} className={s.tipLine}>
          {line}
        </div>
      ))}
    </>
  )
}

export function Swatch({ ink, color, shape = 'square' }: { ink?: Ink; color?: string; shape?: 'square' | 'dot' | 'dash' | 'line' }) {
  return (
    <span
      className={s.swatch}
      data-shape={shape}
      style={{ background: color ?? (ink === undefined ? undefined : inkVar(ink)) }}
      aria-hidden="true"
    />
  )
}

export function Legend({
  items,
}: {
  items: ReadonlyArray<{
    readonly label: string
    readonly ink?: Ink
    readonly color?: string
    readonly shape?: 'square' | 'dot' | 'dash' | 'line'
  }>
}) {
  return (
    <ul className={s.legend}>
      {items.map((item) => (
        <li key={item.label}>
          <Swatch
            {...(item.ink === undefined ? {} : { ink: item.ink })}
            {...(item.color === undefined ? {} : { color: item.color })}
            shape={item.shape ?? 'square'}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * A day-by-day line of the period, over the same days of the one before as a
 * quieter line. Days with nothing to say (a median of no merges) are gaps.
 */
export function Spark({
  now,
  before,
  width = 200,
  height = 36,
  tip,
}: {
  now: ReadonlyArray<number | null>
  before: ReadonlyArray<number | null>
  width?: number
  height?: number
  tip?: (i: number) => ReactNode
}) {
  const tipOf = useTip()
  const all = [...now, ...before].filter((v): v is number => v !== null)
  const top = Math.max(1e-9, ...all)
  const n = Math.max(now.length, before.length)
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (width - 4) + 2)
  const y = (v: number) => height - 3 - (v / top) * (height - 6)
  const path = (values: ReadonlyArray<number | null>) => {
    let d = ''
    let open = false
    values.forEach((v, i) => {
      if (v === null) {
        open = false
        return
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      open = true
    })
    return d
  }
  return (
    <svg className={s.spark} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <path d={path(before)} className={s.sparkBefore} vectorEffect="non-scaling-stroke" />
      <path d={path(now)} className={s.sparkNow} vectorEffect="non-scaling-stroke" />
      {tip !== undefined &&
        Array.from({ length: n }, (_, i) => (
          <rect key={i} x={x(i) - width / n / 2} y={0} width={width / n} height={height} className={s.hit} {...tipOf(tip(i))} />
        ))}
    </svg>
  )
}

/** A bar of parts, side by side, a 2px gap between them; a part too small to see still shows a sliver. */
export function PartsBar({
  parts,
  height = 8,
  total,
}: {
  parts: ReadonlyArray<{ readonly key: string; readonly value: number; readonly color: string; readonly tip?: ReactNode }>
  height?: number
  /** What the whole bar stands for, where the parts fill only some of it. */
  total?: number
}) {
  const tipOf = useTip()
  const whole = total ?? parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <div className={s.parts} style={{ height }}>
      {parts
        .filter((part) => part.value > 0)
        .map((part) => (
          <span
            key={part.key}
            className={s.part}
            style={{ flexGrow: 0, flexBasis: `${(part.value / Math.max(whole, 1e-9)) * 100}%`, background: part.color }}
            {...(part.tip === undefined ? {} : tipOf(part.tip))}
          />
        ))}
    </div>
  )
}
