import { useId } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { unreachable } from '../vocabulary'
import { CELL_PATHS, type CellFill, composition, type MarkCell, ProjectInk } from './drawing'
import s from './ProjectMark.module.css'

/*
 * A project's mark: a small composition generated from a seed, in the
 * project's ink (drawing.ts). It is how a project is known at a glance
 * wherever it appears: in the list of projects, beside its name in a row of
 * work, in its window's bar. Like the other marks it is decoration, and the
 * name beside it is what reads.
 *
 * In a list of projects it can also carry where the project stands. A cobalt
 * arc goes round it while work runs, a violet dot sits on its corner while
 * something waits on you, and a quiet project's mark steps back. These repeat
 * for the eye what the words beside it say; they are never the only place it
 * is said.
 */

export type ProjectMarkProps = RootProps<
  'span',
  {
    /** What the drawing comes from. Pass what stays when the project is renamed, such as its id. */
    seed: string
    /** The project's ink, as stored with it. `projectInk` chooses one when the project is made. */
    ink: ProjectInk
    /** Width and height, in pixels: 15 beside a name, 18 in a bar, 40 in a list of projects. */
    size?: number
    /** Work runs in the project. */
    running?: boolean
    /** Something in the project waits on you. */
    yours?: boolean
    /** Nothing is going on in the project. */
    quiet?: boolean
  }
>

const INK: Record<ProjectInk, string | undefined> = {
  [ProjectInk.Clay]: s.clay,
  [ProjectInk.Ochre]: s.ochre,
  [ProjectInk.Olive]: s.olive,
  [ProjectInk.Moss]: s.moss,
  [ProjectInk.Teal]: s.teal,
  [ProjectInk.Slate]: s.slate,
  [ProjectInk.Rose]: s.rose,
  [ProjectInk.Umber]: s.umber,
}

const FILL: Record<CellFill, string | undefined> = { ink: s.ink, deep: s.deep, paper: s.paper }

/** The corner's radius on the 40 grid: rounder when small, so a mark beside a name reads as a tile. */
function cornerOf(size: number): number {
  if (size >= 32) return 10
  if (size >= 20) return 8.5
  return 7.5
}

function Shape({ cell }: { cell: MarkCell }) {
  switch (cell.shape) {
    case 'circle':
      return <circle cx="10" cy="10" r="6.5" />
    case 'quarter':
    case 'half':
    case 'triangle':
    case 'square':
      return <path d={CELL_PATHS[cell.shape]} />
    default:
      return unreachable(cell.shape)
  }
}

/** The arc that goes round the mark while work runs, a little way out from its edge. */
function Running({ size, corner }: { size: number; corner: number }) {
  const gap = Math.max(3, Math.round(size / 10))
  const width = size + gap * 2
  const ring = { x: 0.75, y: 0.75, width: width - 1.5, height: width - 1.5, rx: (corner * size) / 40 + gap - 0.75 }
  return (
    <svg className={s.run} viewBox={`0 0 ${width} ${width}`} width={width} height={width} focusable="false">
      <rect className={s.track} {...ring} />
      <rect className={s.arc} pathLength={100} {...ring} />
    </svg>
  )
}

export function ProjectMark({ seed, ink, size = 40, running = false, yours = false, quiet = false, className, ...rest }: ProjectMarkProps) {
  const clip = `mark-${useId().replace(/[^\w-]/g, '')}`
  const corner = cornerOf(size)
  return (
    <span className={cx(s.mark, INK[ink], quiet && s.quiet, className)} aria-hidden="true" {...rest}>
      <svg className={s.tile} viewBox="0 0 40 40" width={size} height={size} focusable="false">
        <defs>
          <clipPath id={clip}>
            <rect width="40" height="40" rx={corner} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect className={s.ground} width="40" height="40" />
          {composition(seed).map((cell, i) => (
            <g
              key={i}
              className={FILL[cell.fill]}
              transform={`translate(${(i % 2) * 20} ${Math.floor(i / 2) * 20}) rotate(${cell.turn * 90} 10 10)`}
            >
              <Shape cell={cell} />
            </g>
          ))}
        </g>
        <rect className={s.edge} x="0.5" y="0.5" width="39" height="39" rx={corner - 0.5} />
      </svg>
      {running && <Running size={size} corner={corner} />}
      {yours && <span className={s.you} />}
    </span>
  )
}
