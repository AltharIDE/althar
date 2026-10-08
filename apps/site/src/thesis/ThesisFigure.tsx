import type { CSSProperties } from 'react'

import s from './Thesis.module.css'

export type FigureKind = 'inline' | 'stack' | 'lanes' | 'branch' | 'fallback'
type FigureVariant = 'plain' | 'developers' | 'scopes' | 'execution' | 'specialists' | 'providers'

export interface FigureModel {
  kind: FigureKind
  variant: FigureVariant
  labels: string[]
}

/** The words in an ASCII figure, without its arrows and drawing characters. */
export function figureLabels(source: string): string[] {
  return source
    .replace(/[┌┐└┘├┤┬┴┼│─]+/g, ' ')
    .replace(/[→↓↕↔]+/g, '\n')
    .split('\n')
    .flatMap((line) => line.trim().split(/\s{2,}/))
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Choose a rail figure without making THESIS.md know about presentation. */
export function classifyFigure(source: string): FigureModel {
  const labels = figureLabels(source)
  if (labels.length === 0) return { kind: 'fallback', variant: 'plain', labels }
  if (!/[→↓↕↔┌┐└┘├┤┬┴┼│─]/.test(source)) return { kind: 'fallback', variant: 'plain', labels }
  if (!source.includes('\n') && source.includes('→')) return { kind: 'inline', variant: 'plain', labels }
  if (source.includes('Developer A')) return { kind: 'lanes', variant: 'developers', labels }
  if (source.includes('Organisation / ecosystem')) return { kind: 'lanes', variant: 'scopes', labels }
  if (source.includes('Requirements') && source.includes('Pass')) return { kind: 'branch', variant: 'execution', labels }
  if (source.includes('Security review')) return { kind: 'branch', variant: 'specialists', labels }
  if (source.includes('Open layer')) return { kind: 'branch', variant: 'providers', labels }
  return { kind: 'stack', variant: 'plain', labels }
}

const liveAt = (labels: string[], match: RegExp | number): number => {
  if (typeof match === 'number') return match
  const i = labels.findIndex((label) => match.test(label))
  return i < 0 ? Math.max(labels.length - 1, 0) : i
}

function Rail({ labels, live, vertical = false, named }: { labels: string[]; live?: number; vertical?: boolean; named?: boolean }) {
  const n = Math.max(labels.length, 1)
  const at = live == null ? -1 : live
  const down = vertical || n < 2
  return (
    <ol className={`${s.rail} ${down ? s.railV : s.railH}`} style={{ '--n': n, '--reach': Math.max(at, 0) } as CSSProperties}>
      {labels.map((label, i) => (
        <li
          key={`${label}-${i}`}
          style={{ '--i': i } as CSSProperties}
          data-live={i === at ? '' : undefined}
          data-done={i < at ? '' : undefined}
        >
          <i className={s.dot} aria-hidden="true" />
          {named && i === 0 ? <span className={s.railName}>{label}</span> : <span className={s.k}>{label}</span>}
        </li>
      ))}
    </ol>
  )
}

function Lanes({ lanes, named, live = 0 }: { lanes: string[][]; named?: boolean; live?: number }) {
  const rows = Math.max(...lanes.map((lane) => lane.length), 1)
  return (
    <div className={s.lanes} style={{ '--cols': lanes.length, '--rows': rows } as CSSProperties}>
      {lanes.map((lane, i) => (
        <Rail key={i} labels={lane} vertical live={live} named={named} />
      ))}
    </div>
  )
}

function InlineFigure({ labels }: { labels: string[] }) {
  return <Rail labels={labels} live={labels.length > 2 ? labels.length - 2 : labels.length - 1} />
}

function StackFigure({ labels }: { labels: string[] }) {
  return <Rail labels={labels} vertical live={liveAt(labels, /Coordinator|Execution Graph|Althar prototype|^Thesis$/)} />
}

function DeveloperLanes({ labels }: { labels: string[] }) {
  return <Lanes named live={0} lanes={[labels.slice(0, 3), labels.slice(3, 6), labels.slice(6, 9)].filter((lane) => lane.length > 0)} />
}

function ScopeMap({ labels }: { labels: string[] }) {
  const [organisation, product, projectA, projectB, task] = labels
  if (!organisation || !product || !projectA || !projectB || !task) return null
  const pitch = 36
  const y0 = 14
  const ys = [0, 1, 2, 3].map((i) => y0 + i * pitch)
  const spine = 12 + projectA.length * CHAR + GAP + R + 44
  const org: Dot = { x: spine, y: ys[0] ?? y0, label: organisation }
  const prod: Dot = { x: spine, y: ys[1] ?? y0, label: product }
  const left: Dot = { x: spine - 44, y: ys[2] ?? y0, label: projectA, live: true, anchor: 'end' }
  const right: Dot = { x: spine + 44, y: ys[2] ?? y0, label: projectB, live: true }
  const taskDot: Dot = { x: spine, y: ys[3] ?? y0, label: task }
  const dots = [org, prod, left, right, taskDot]
  const lines: Pt[][] = [
    [
      [spine, ys[0] ?? y0],
      [spine, ys[3] ?? y0],
    ],
    [
      [left.x, ys[2] ?? y0],
      [right.x, ys[2] ?? y0],
    ],
  ]
  return <Diagram {...centeredOn(spine, dots, lines, (ys[3] ?? y0) + 16)} />
}

/** A word on the line. The wire runs to the dot and starts again after the word. */
type Dot = { x: number; y: number; label: string; live?: boolean; done?: boolean; anchor?: 'start' | 'end' }
type Pt = [number, number]

const R = 6.5
const GAP = 8
const CHAR = 9.15
const labelEnd = (dot: Dot) => (dot.anchor === 'end' ? dot.x + R + 8 : dot.x + R + GAP + dot.label.length * CHAR + 14)

/** Pad the drawing so `axis` is the horizontal centre. The caption then sits on that axis. */
function centeredOn(axis: number, dots: Dot[], lines: Pt[][], height: number) {
  const edge = (dot: Dot) => {
    const text = dot.label.length * CHAR
    return dot.anchor === 'end' ? [dot.x - R - GAP - text - 2, dot.x + R] : [dot.x - R, labelEnd(dot)]
  }
  const xs = dots.flatMap(edge)
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const half = Math.max(axis - min, max - axis) + 12
  const shift = half - axis
  const move = (x: number) => x + shift
  return {
    width: half * 2,
    height,
    dots: dots.map((dot) => ({ ...dot, x: move(dot.x) })),
    lines: lines.map((pts) => pts.map(([x, y]) => [move(x), y] as Pt)),
  }
}

function Diagram({ width, height, lines, dots }: { width: number; height: number; lines: Pt[][]; dots: Dot[] }) {
  return (
    <svg className={s.diagram} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation">
      {lines.map((pts, i) => (
        <polyline key={i} points={pts.map(([x, y]) => `${x},${y}`).join(' ')} />
      ))}
      {dots.map((dot) => (
        <g key={`${dot.label}-${dot.x}-${dot.y}`}>
          <circle cx={dot.x} cy={dot.y} r={R} data-live={dot.live ? '' : undefined} data-done={dot.done ? '' : undefined} />
          <text
            x={dot.anchor === 'end' ? dot.x - R - GAP : dot.x + R + GAP}
            y={dot.y}
            textAnchor={dot.anchor === 'end' ? 'end' : 'start'}
            data-live={dot.live ? '' : undefined}
          >
            {dot.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function ExecutionGraph({ labels }: { labels: string[] }) {
  const has = (name: string) => labels.includes(name)
  const yReview = 12
  const yMain = 46
  const yNote = 80
  const yTest = 122
  const yBar = 154
  const yLow = 186
  const yFoot = 218
  const req: Dot = { x: 12, y: yMain, label: 'Requirements', done: true }
  const impl: Dot = { x: labelEnd(req) + 20, y: yMain, label: 'Implement', live: true }
  const leftX = labelEnd(impl) + 16
  const review: Dot = { x: leftX + 28, y: yReview, label: 'Review' }
  const midX = labelEnd(review) + 20
  const repair: Dot = { x: midX + 22, y: yMain, label: 'Repair' }
  const rightX = labelEnd(repair) + 22
  const again: Dot = { x: midX + 22, y: yNote, label: 'Re-review' }
  const test: Dot = { x: leftX + 78, y: yTest, label: 'Test' }
  const passX = test.x - 52
  const failX = test.x + 56
  const pass: Dot = { x: passX, y: yLow, label: 'Pass' }
  const fail: Dot = { x: failX, y: yLow, label: 'Fail' }
  const done: Dot = { x: passX, y: yFoot, label: 'Done' }
  const repairLow: Dot = { x: failX, y: yFoot, label: 'Repair' }
  const dots = [req, impl, review, repair, again, test, pass, fail, done, repairLow].filter((dot) => has(dot.label))
  return (
    <Diagram
      width={rightX + 12}
      height={yFoot + 16}
      dots={dots}
      lines={[
        [
          [labelEnd(req), yMain],
          [impl.x, yMain],
        ],
        [
          [labelEnd(impl), yMain],
          [repair.x, yMain],
        ],
        [
          [labelEnd(repair), yMain],
          [rightX, yMain],
          [rightX, yReview],
          [labelEnd(review), yReview],
        ],
        [
          [leftX, yMain],
          [leftX, yReview],
          [review.x, yReview],
        ],
        [
          [midX, yReview],
          [midX, yNote],
          [again.x, yNote],
        ],
        [
          [leftX, yMain],
          [leftX, yTest],
          [test.x, yTest],
        ],
        [
          [test.x, yTest],
          [test.x, yBar],
        ],
        [
          [passX, yBar],
          [failX, yBar],
        ],
        [
          [passX, yBar],
          [passX, yFoot],
        ],
        [
          [failX, yBar],
          [failX, yFoot],
        ],
      ]}
    />
  )
}

function SpecialistGraph({ labels }: { labels: string[] }) {
  const has = (name: string) => labels.includes(name)
  const y = [14, 48, 82]
  const mid = y[1] ?? 48
  const impl: Dot = { x: 12, y: mid, label: 'Implement', live: true }
  const barL = labelEnd(impl) + 16
  const dotX = barL + 20
  const branches: Dot[] = ['Security review', 'Code review', 'Test agent'].map((label, i) => ({ x: dotX, y: y[i] ?? mid, label }))
  const longest = Math.max(...branches.map(labelEnd))
  const barR = longest + 18
  const repair: Dot = { x: barR + 20, y: mid, label: 'Repair', done: true }
  const again: Dot = { x: labelEnd(repair) + 18, y: mid, label: 'Re-review', live: true }
  const dots = [impl, ...branches, repair, again].filter((dot) => has(dot.label))
  const top = y[0] ?? 14
  const bot = y[2] ?? 82
  return (
    <Diagram
      width={labelEnd(again) + 12}
      height={bot + 16}
      dots={dots}
      lines={[
        [
          [labelEnd(impl), mid],
          [barL, mid],
        ],
        [
          [barL, top],
          [barL, bot],
        ],
        [
          [barR, top],
          [barR, bot],
        ],
        ...branches.flatMap((dot) => [
          [
            [barL, dot.y],
            [dot.x, dot.y],
          ] as Pt[],
          [
            [labelEnd(dot), dot.y],
            [barR, dot.y],
          ] as Pt[],
        ]),
        [
          [barR, mid],
          [repair.x, mid],
        ],
        [
          [labelEnd(repair), mid],
          [again.x, mid],
        ],
      ]}
    />
  )
}

function ProviderGraph({ labels }: { labels: string[] }) {
  const has = (name: string) => labels.includes(name)
  const y = [14, 48, 82, 116]
  const join = y[1] ?? 54
  const scopes: Dot = { x: 12, y: join, label: 'Persistent scopes', done: true }
  const open: Dot = { x: labelEnd(scopes) + 20, y: join, label: 'Open layer', live: true }
  const barX = labelEnd(open) + 16
  const modelX = barX + 20
  const models: Dot[] = ['Model A', 'Model B', 'Local agent', 'Future model'].map((label, i) => ({ x: modelX, y: y[i] ?? join, label }))
  const dots = [scopes, open, ...models].filter((dot) => has(dot.label))
  return (
    <Diagram
      width={Math.max(...models.map(labelEnd)) + 12}
      height={(y[3] ?? 126) + 16}
      dots={dots}
      lines={[
        [
          [labelEnd(scopes), join],
          [open.x, join],
        ],
        [
          [labelEnd(open), join],
          [barX, join],
        ],
        [
          [barX, y[0] ?? 18],
          [barX, y[3] ?? 126],
        ],
        ...models.map(
          (dot) =>
            [
              [barX, dot.y],
              [dot.x, dot.y],
            ] as Pt[],
        ),
      ]}
    />
  )
}

function FigureBody({ model }: { model: FigureModel }) {
  if (model.kind === 'inline') return <InlineFigure labels={model.labels} />
  if (model.kind === 'stack') return <StackFigure labels={model.labels} />
  if (model.variant === 'developers') return <DeveloperLanes labels={model.labels} />
  if (model.variant === 'scopes') return <ScopeMap labels={model.labels} />
  if (model.variant === 'execution') return <ExecutionGraph labels={model.labels} />
  if (model.variant === 'specialists') return <SpecialistGraph labels={model.labels} />
  if (model.variant === 'providers') return <ProviderGraph labels={model.labels} />
  return null
}

export function ThesisFigure({ source }: { source: string }) {
  const model = classifyFigure(source)
  if (model.kind === 'fallback') {
    return (
      <figure className={s.figureFallback}>
        <pre>{source}</pre>
      </figure>
    )
  }
  return (
    <figure className={s.thesisFigure} data-kind={model.kind} data-variant={model.variant}>
      <div className={s.figureStage}>
        <FigureBody model={model} />
        <figcaption className={s.figureCaption}>
          Figure <i aria-hidden="true" />
        </figcaption>
      </div>
      <pre className={s.figureSource}>Diagram source: {source}</pre>
    </figure>
  )
}
