import { BrandMark } from '@charrette/ui'
import { useEffect, useRef, useState } from 'react'

import { cx } from '../lib/cx'
import { BRAND_OF, TASKS, twoLines } from '../content/site'
import s from './Knowledge.module.css'

/*
 * What the project knows, as its graph: each note with the task it came
 * from, and the code it applies to. Every few seconds a next task comes in
 * on the right; the code it touches lights up, and the notes that apply to
 * that code are attached to it, whichever agent it goes to. Drafted like
 * the task graph: ruled cells, square corners, orthogonal leaders.
 */

type Agent = keyof typeof BRAND_OF

const AREAS = ['src/money/**', 'tests/ledger/**', 'src/webhooks/**', 'db/ledger/**', 'src/session/**'] as const
type Area = (typeof AREAS)[number]

/** What each note applies to, in the order of TASKS. */
const SCOPE: readonly Area[] = ['src/money/**', 'tests/ledger/**', 'src/webhooks/**', 'src/session/**', 'db/ledger/**', 'src/session/**']

const NEXT: readonly { task: string; who: Agent; title: string; touches: readonly Area[] }[] = [
  {
    task: 'Task 419',
    who: 'Codex',
    title: 'Refunds post twice on a retried webhook',
    touches: ['src/webhooks/**', 'src/money/**', 'db/ledger/**'],
  },
  { task: 'Task 420', who: 'Gemini CLI', title: 'Sessions outlive a revoked key', touches: ['src/session/**'] },
  { task: 'Task 421', who: 'Claude Code', title: 'Settlement report rounds each line', touches: ['src/money/**', 'tests/ledger/**'] },
]
const EVERY = 4200

const tagOf = (kind: string) => (kind === 'Your decision' ? 'Your call' : kind === 'Seen in a task' ? 'Proposed' : 'Settled')

/* ---- The drawing ---------------------------------------------------------------------------------- */

const COL = { from: 20, note: 246, area: 780, next: 1040 } as const
const FW = 176
const NW = 330
const AW = 186
const XW = 184
const noteY = (i: number) => 96 + i * 66
const NH = 48
const areaY = (j: number) => 116 + j * 76
const AH = 38
const NEXT_Y = 190
const NEXT_H = 178

function Graph({ at }: { at: number }) {
  const next = NEXT[at] ?? NEXT[0]
  const touched = new Set<Area>(next?.touches ?? [])
  const attached = SCOPE.map((a) => touched.has(a))
  const count = attached.filter(Boolean).length
  const nMid = NEXT_Y + NEXT_H / 2
  const [line1, line2] = twoLines(next?.title ?? '')
  return (
    <svg className={s.svg} viewBox="0 0 1240 520" aria-hidden="true">
      <defs>
        <marker
          id="kn-ink"
          viewBox="0 0 12 8"
          refX="11"
          refY="4"
          markerWidth="12"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0 0.8 L12 4 L0 7.2 Z" className={s.headInk} />
        </marker>
        <marker
          id="kn-live"
          viewBox="0 0 12 8"
          refX="11"
          refY="4"
          markerWidth="12"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0 0.8 L12 4 L0 7.2 Z" className={s.headLive} />
        </marker>
      </defs>

      {(
        [
          [COL.from, FW, 'From'],
          [COL.note, NW, 'Notes'],
          [COL.area, AW, 'Applies to'],
          [COL.next, XW, 'Next task'],
        ] as const
      ).map(([x, w, label]) => (
        <g key={label} className={s.colHead}>
          <text x={x} y={56}>
            {label}
          </text>
          <line x1={x} x2={x + w} y1={66} y2={66} />
        </g>
      ))}

      {TASKS.map((t, i) => {
        const y = noteY(i)
        const mid = y + NH / 2
        const a = AREAS.indexOf(SCOPE[i] ?? 'src/money/**')
        const lane = 614 + i * 24
        const am = areaY(a) + AH / 2
        const on = attached[i]
        const tag = tagOf(t.kind)
        return (
          <g key={t.task}>
            {/* where it came from */}
            <g className={s.from}>
              <rect x={COL.from} y={y} width={FW} height={NH} />
              <g transform={`translate(${COL.from + 12} ${y + 10})`} className={s.mark}>
                <BrandMark brand={BRAND_OF[t.who as Agent]} size={14} />
              </g>
              <text className={s.fromTask} x={COL.from + 34} y={y + 22}>
                {t.task}
              </text>
              <text className={s.fromWho} x={COL.from + 34} y={y + 38}>
                {t.who}
              </text>
            </g>
            <line className={s.edge} x1={COL.from + FW} x2={COL.note - 2} y1={mid} y2={mid} markerEnd="url(#kn-ink)" />

            {/* the note */}
            <g className={cx(s.note, on && s.on, tag === 'Proposed' && s.proposed, tag === 'Your call' && s.yours)}>
              <rect className={s.box} x={COL.note} y={y} width={NW} height={NH} />
              <rect className={s.num} x={COL.note} y={y} width={36} height={NH} />
              <line x1={COL.note + 36} x2={COL.note + 36} y1={y} y2={y + NH} />
              <text className={s.no} x={COL.note + 18} y={y + NH / 2 + 5} textAnchor="middle">
                {String(i + 1).padStart(2, '0')}
              </text>
              <text className={s.name} x={COL.note + 50} y={y + NH / 2 + 5}>
                {t.short}
              </text>
              <text className={s.tag} x={COL.note + NW - 12} y={y + NH / 2 + 4} textAnchor="end">
                {on ? 'Attached' : tag}
              </text>
            </g>
            <path
              className={cx(s.edge, s.scope, on && s.on)}
              d={`M${COL.note + NW} ${mid} H${lane} V${am} H${COL.area - 2}`}
              markerEnd={on ? 'url(#kn-live)' : 'url(#kn-ink)'}
            />
          </g>
        )
      })}

      {AREAS.map((a, j) => {
        const y = areaY(j)
        const on = touched.has(a)
        const nx = 1006 - j * 9
        return (
          <g key={a}>
            <g className={cx(s.area, on && s.on)}>
              <rect x={COL.area} y={y} width={AW} height={AH} />
              <text x={COL.area + 12} y={y + AH / 2 + 4}>
                {a}
              </text>
            </g>
            <path
              key={`${a}-${at}`}
              className={cx(s.touch, on && s.on)}
              d={`M${COL.next} ${nMid} H${nx} V${y + AH / 2} H${COL.area + AW + 2}`}
              pathLength={1}
              markerEnd={on ? 'url(#kn-live)' : undefined}
            />
          </g>
        )
      })}

      {/* the next task, and what it starts with */}
      <g key={at} className={s.next}>
        <rect className={s.nextBox} x={COL.next} y={NEXT_Y} width={XW} height={NEXT_H} />
        <line x1={COL.next} x2={COL.next + XW} y1={NEXT_Y + 30} y2={NEXT_Y + 30} />
        <text className={s.nextHead} x={COL.next + 12} y={NEXT_Y + 20}>
          New
        </text>
        <g transform={`translate(${COL.next + 12} ${NEXT_Y + 46})`} className={s.mark}>
          {next && <BrandMark brand={BRAND_OF[next.who]} size={15} />}
        </g>
        <text className={s.nextTask} x={COL.next + 34} y={NEXT_Y + 58}>
          {next?.task}
        </text>
        <text className={s.nextTitle} x={COL.next + 12} y={NEXT_Y + 88}>
          <tspan x={COL.next + 12}>{line1}</tspan>
          <tspan x={COL.next + 12} dy={18}>
            {line2}
          </tspan>
        </text>
        <line x1={COL.next} x2={COL.next + XW} y1={NEXT_Y + NEXT_H - 34} y2={NEXT_Y + NEXT_H - 34} />
        <text className={s.nextCount} x={COL.next + 12} y={NEXT_Y + NEXT_H - 13}>
          Starts with {count} {count === 1 ? 'note' : 'notes'}
        </text>
      </g>
    </svg>
  )
}

/** The same, for narrow screens: the next task, then the notes it starts with picked out. */
function List({ at }: { at: number }) {
  const next = NEXT[at] ?? NEXT[0]
  const touched = new Set<Area>(next?.touches ?? [])
  const count = SCOPE.filter((a) => touched.has(a)).length
  return (
    <div className={s.narrow}>
      <p key={at} className={s.nextCard}>
        <span className={s.nextCardHead}>
          {next && <BrandMark brand={BRAND_OF[next.who]} size={14} />}
          {next?.task}
        </span>
        {next?.title}
        <b>Starts with {count} notes</b>
      </p>
      <ol className={s.rows}>
        {TASKS.map((t, i) => {
          const on = touched.has(SCOPE[i] ?? 'src/money/**')
          return (
            <li key={t.task} className={cx(on && s.rowOn)}>
              <span className={s.rowNo}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.rowName}>{t.short}</span>
              <span className={s.rowFrom}>
                <BrandMark brand={BRAND_OF[t.who as Agent]} size={12} />
                {t.task.replace('Task ', '')}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function Knowledge() {
  const [at, setAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let seen = false
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? false
    })
    io.observe(el)
    const id = window.setInterval(() => {
      if (seen && !document.hidden) setAt((n) => (n + 1) % NEXT.length)
    }, EVERY)
    return () => {
      window.clearInterval(id)
      io.disconnect()
    }
  }, [])

  return (
    <div ref={box} className={s.knowledge}>
      <p className={s.sr}>
        Each of the project’s six notes keeps the task it came from and the code it applies to. A new task starts with the notes that apply
        to the code it touches: for example, a task on refunds and webhooks starts with the notes on money, webhooks and ledger tables.
      </p>
      <Graph at={at} />
      <List at={at} />
      <p className={s.foot}>Where notes should live is still an open question.</p>
    </div>
  )
}
