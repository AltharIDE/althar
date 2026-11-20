import { BrandMark, Icon } from '@althar/ui'

import type { Held, Places } from './data'
import { tasksOf, words } from './words'
import s from './parts.module.css'

/*
 * What the directions share: the places as a row of cells, the work that
 * holds them, and the line that says the number is lowered for a while.
 */

type Cell = 'on' | 'free' | 'shut'

/** One cell a place: in use in cobalt, free as an empty step, and closed for now as an outline. */
export const cellsOf = (places: Places): Cell[] => {
  const busy = places.held.length
  return Array.from({ length: Math.max(places.configured, busy) }, (_, i) => (i < busy ? 'on' : i >= places.atOnce ? 'shut' : 'free'))
}

/** The places as cells: small, as the window's bar draws its meters; large, where there is room. */
export function Pips({ places, size = 'small' }: { places: Places; size?: 'small' | 'large' }) {
  return (
    <span className={`${s.pips} ${s[size]}`} aria-hidden="true">
      {cellsOf(places).map((cell, i) => (
        <i key={i} data-cell={cell} />
      ))}
    </span>
  )
}

/** As many cells as places it holds, in cobalt: the column a task's row starts with. */
function Held({ n }: { n: number }) {
  return (
    <span className={`${s.pips} ${s.small} ${s.held}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} data-cell="on" />
      ))}
    </span>
  )
}

/** A task's agents, as its row says them: its project, who, and what runs where it isn't a turn. */
function Meta({ agents, project }: { agents: readonly Held[]; project: boolean }) {
  const first = agents[0]!
  const background = agents.find((one) => one.doing.kind === 'background')
  const starting = agents.every((one) => one.doing.kind === 'starting')
  return (
    <span className={s.meta}>
      {[project ? first.project : null, words.roles(agents), starting ? words.starting : null].filter((part) => part !== null).join(' · ')}
      {background?.doing.kind === 'background' && (
        <>
          {' · '}
          <code className={s.command}>{background.doing.command}</code>
        </>
      )}
    </span>
  )
}

/**
 * The work holding the places, a row a task, each opening it: as many cobalt cells as places it holds, its title, its
 * project and who; with `figures`, what it takes of the computer.
 */
export function HeldRows({
  places,
  onOpen,
  figures = false,
  project = true,
}: {
  places: Places
  onOpen: (taskId: string) => void
  figures?: boolean
  project?: boolean
}) {
  const tasks = tasksOf(places.held)
  if (tasks.length === 0) return <p className={s.none}>{words.nothing}</p>
  const most = Math.max(...tasks.map((agents) => agents.length))
  return (
    <ul className={s.rows} style={{ '--cells': `${most * 4 + (most - 1) * 2}px` } as React.CSSProperties}>
      {tasks.map((agents) => {
        const first = agents[0]!
        const cpu = agents.reduce((sum, one) => sum + one.cpu, 0)
        const memory = agents.reduce((sum, one) => sum + Number.parseFloat(one.memory), 0)
        return (
          <li key={first.taskId}>
            <button type="button" className={s.row} onClick={() => onOpen(first.taskId)} title={first.title}>
              <Held n={agents.length} />
              <span className={s.words}>
                <span className={s.title}>
                  <BrandMark brand={first.mark} size={11} className={s.mark} />
                  <span className={s.titleText}>{first.title}</span>
                </span>
                <Meta agents={agents} project={project} />
              </span>
              {figures && (
                <span className={s.figures}>
                  <span className={s.figure}>{Math.round(cpu * 100)}%</span>
                  <span className={s.figureQuiet}>{memory.toFixed(1)} GB</span>
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** While the number is lowered: what to, and until when. Nothing otherwise. */
export function Lowered({ places, className }: { places: Places; className?: string }) {
  const line = words.lowered(places)
  if (line === null) return null
  return (
    <p className={`${s.lowered} ${className ?? ''}`}>
      <Icon name="load" size={13} className={s.loweredIcon} />
      <span>{line}</span>
    </p>
  )
}
