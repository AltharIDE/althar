import type { CSSProperties } from 'react'
import { BrandMark, Icon, type IconName } from '@althar/ui'

import type { Held, Places, Worker } from './data'
import { tasksOf, words } from './words'
import s from './parts.module.css'

/*
 * What the takes share: a computer's places as a row of cells, every
 * computer's as groups of cells or as parts of one track, a computer's glyph,
 * and the work that holds the places.
 */

type Cell = 'on' | 'free' | 'shut' | 'gone'

/**
 * One cell a place: in use in cobalt, free as an empty step, closed for now faded. A worker out of reach: its work as
 * last seen, faded cobalt, and the rest faded, since nothing can start there.
 */
const cellsOf = (places: Places, away: boolean): Cell[] => {
  const busy = places.held.length
  return Array.from({ length: Math.max(places.configured, busy) }, (_, i) =>
    away ? (i < busy ? 'gone' : 'shut') : i < busy ? 'on' : i >= places.atOnce ? 'shut' : 'free',
  )
}

/** A worker's places as cells: small, as the window's bar draws its meters; large, where there is room. */
export function Pips({ places, away = false, size = 'small' }: { places: Places; away?: boolean; size?: 'small' | 'large' }) {
  return (
    <span className={`${s.pips} ${s[size]}`} aria-hidden="true">
      {cellsOf(places, away).map((cell, i) => (
        <i key={i} data-cell={cell} />
      ))}
    </span>
  )
}

/** Every worker's places, a group of cells each, a little apart. */
export function WorkerPips({ workers }: { workers: readonly Worker[] }) {
  return (
    <span className={s.groups} aria-hidden="true">
      {workers.map((one) => (
        <Pips key={one.id} places={one.places} away={one.away !== null} />
      ))}
    </span>
  )
}

/**
 * Every computer as a part of one track, as long as its places are many: at work in cobalt, free bare, closed for now
 * faded at its end; one out of reach faded whole. Small, the bar's, as wide whatever the numbers; large, a popover's.
 */
export function Track({ workers, size = 'small' }: { workers: readonly Worker[]; size?: 'small' | 'large' }) {
  return (
    <span className={`${s.track} ${size === 'large' ? s.trackLarge : ''}`} aria-hidden="true">
      {workers.map((one) => {
        const { held, configured, atOnce } = one.places
        const style = {
          flexGrow: configured,
          '--used': `${(Math.min(held.length, configured) / configured) * 100}%`,
          '--open': `${(Math.max(Math.min(atOnce, configured), Math.min(held.length, configured)) / configured) * 100}%`,
        } as CSSProperties
        return <i key={one.id} style={style} data-away={one.away !== null || undefined} />
      })}
    </span>
  )
}

const GLYPH: Record<Worker['kind'], IconName> = { this: 'computer', own: 'computer', cloud: 'globe' }

/** A worker's glyph: a computer, or the cloud. */
export function WorkerGlyph({ worker, className }: { worker: Worker; className?: string }) {
  return <Icon name={GLYPH[worker.kind]} size={14} {...(className === undefined ? {} : { className })} />
}

/** As many cells as places it holds, in cobalt: the column a task's row starts with. */
function HeldCells({ n, gone }: { n: number; gone: boolean }) {
  return (
    <span className={`${s.pips} ${s.small} ${s.held}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-cell={gone ? 'gone' : 'on'} />
      ))}
    </span>
  )
}

/** A task's agents, as its row says them: its project, who, and what runs where it isn't a turn. */
function Meta({ agents }: { agents: readonly Held[] }) {
  const first = agents[0]!
  const background = agents.find((one) => one.doing.kind === 'background')
  const starting = agents.every((one) => one.doing.kind === 'starting')
  return (
    <span className={s.meta}>
      {[first.project, words.roles(agents), starting ? words.starting : null].filter((part) => part !== null).join(' · ')}
      {background?.doing.kind === 'background' && (
        <>
          {' · '}
          <code className={s.command}>{background.doing.command}</code>
        </>
      )}
    </span>
  )
}

export interface HeldRowsProps {
  held: readonly Held[]
  onOpen: (taskId: string) => void
  /** The worker a task's agents are on, at the row's end, where the list is of several. */
  whereOf?: (taskId: string) => string
  /** As last seen, on a worker out of reach. */
  gone?: boolean
}

/**
 * The work holding the places, a row a task, each opening it: as many cobalt cells as places it holds, its title, its
 * project and who, and where it runs where the list is of several workers.
 */
export function HeldRows({ held, onOpen, whereOf, gone = false }: HeldRowsProps) {
  const tasks = tasksOf(held)
  if (tasks.length === 0) return <p className={s.none}>{words.nothing}</p>
  const most = Math.max(...tasks.map((agents) => agents.length))
  return (
    <ul className={s.rows} data-gone={gone || undefined} style={{ '--cells': `${most * 4 + (most - 1) * 2}px` } as React.CSSProperties}>
      {tasks.map((agents) => {
        const first = agents[0]!
        const where = whereOf?.(first.taskId)
        return (
          <li key={first.taskId}>
            <button
              type="button"
              className={s.row}
              onClick={() => onOpen(first.taskId)}
              title={first.title}
              data-where={where !== undefined || undefined}
            >
              <HeldCells n={agents.length} gone={gone} />
              <span className={s.words}>
                <span className={s.title}>
                  <BrandMark brand={first.mark} size={11} className={s.mark} />
                  <span className={s.titleText}>{first.title}</span>
                </span>
                <Meta agents={agents} />
              </span>
              {where !== undefined && <span className={s.where}>{where}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
