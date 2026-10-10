import { Checkbox } from 'radix-ui'
import { type DragEvent, useId, useRef, useState } from 'react'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Icon } from '../../foundations/Icon/Icon'
import { Light } from '../../foundations/Light/Light'
import { BrandChip } from '../../foundations/Marks/Marks'
import { RuntimeState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { type RuntimeEntry, Runtimes, type RuntimesProps, type RuntimesText } from '../../setup/Runtimes/Runtimes'
import s from './Start.module.css'

/*
 * The first thing Althar shows, before there is a project: the whole window
 * spent looking, and seen to look. No tabs and no bar yet; the page runs to
 * the window's edges, a printed halo round the mark and the light rising
 * behind it.
 *
 * On the left the mark stands in its own light, and each agent that
 * answered lands on a ring under it: signed in in full, otherwise faint. On
 * the right, on a sheet over the light, the agents' rows, then the
 * repositories found where people keep code.
 *
 * A project is one repository or several, so they are picked, not opened:
 * each one ticked joins the project taking shape under the mark, named after
 * the first until the person names it. More come from Add a folder, or
 * dropped on the window. Nothing here is a step to finish: a project can be
 * made with no agent ready, and its tasks start once one is.
 */

/** A repository that could be in the first project, as the screen lists it. */
export interface StartRepository {
  readonly id: string
  readonly name: string
  /** Where it is, as the person knows the place: ~/Projects/meridian. */
  readonly where: string
  /** What else says which one it is: its branch and when it was last worked on, or that it was just added. */
  readonly facts?: string
}

export interface StartText {
  looking: string
  lookingNote: string
  pick: string
  nowhere: string
  over: string
  ready: (count: number) => string
  pickNote: string
  agents: string
  agentsLabel: string
  asking: string
  readyOf: (ready: number, of: number) => string
  repositories: string
  repositoriesLabel: string
  lookedIn: (where: string) => string
  searching: string
  none: string
  add: { title: string; note: string; kbd: string }
  project: string
  name: string
  more: string
  leaveOut: (name: string) => string
  create: string
  createKbd: string
}

export const startText: StartText = {
  looking: 'Looking around this Mac…',
  lookingNote: 'Asking each agent who it is signed in as, and looking for repositories where code is usually kept.',
  pick: 'Where should they work?',
  nowhere: 'Where is your code?',
  over: 'Let go to add it',
  ready: (count) =>
    count === 0
      ? 'No agent is signed in yet; a project can wait for one.'
      : count === 1
        ? 'One agent is ready.'
        : `${count} agents are ready.`,
  pickNote: 'Pick the repositories your first project works in. One is fine; a project can hold several.',
  agents: 'Agents',
  agentsLabel: 'Agents on this Mac',
  asking: 'asking…',
  readyOf: (ready, of) => `${ready} of ${of} ready`,
  repositories: 'Repositories',
  repositoriesLabel: 'Repositories for the project',
  lookedIn: (where) => `in ${where}`,
  searching: 'Looking…',
  none: 'None found in the usual places.',
  add: { title: 'Add a folder…', note: 'anywhere on this Mac', kbd: '⌘N' },
  project: 'Your first project',
  name: 'Project name',
  more: 'Tick more, or drop folders on the window.',
  leaveOut: (name) => `Leave ${name} out`,
  create: 'Make the project',
  createKbd: '⌘⏎',
}

export interface StartProps extends Omit<RuntimesProps, 'label' | 'className' | 'text' | 'runtimes'> {
  /** The agents, as each answered; null while they are still being asked. */
  runtimes: readonly RuntimeEntry[] | null
  /** The repositories found, and any added; null while they are still being looked for. */
  repositories: readonly StartRepository[] | null
  /** Where they were looked for, as one line: ~/Projects, ~/Developer. */
  lookedIn?: string
  /** The repositories ticked, by id, in the order they were. */
  picked: readonly string[]
  /** Ticks a repository, or unticks it. */
  onPick: (id: string) => void
  /** Asks for a folder to add. */
  onAdd: () => void
  /** Folders dropped on the window. Without it, a drop does nothing. */
  onDrop?: (files: readonly File[]) => void
  /** The project's name as it stands. */
  name: string
  onNameChange: (name: string) => void
  /** Makes the project from what is ticked. */
  onCreate: () => void
  creating?: boolean
  error?: string
  className?: string
  text?: Partial<StartText>
  /** The agents' rows' own words, such as what this computer is called. */
  runtimesText?: Partial<RuntimesText>
}

/** How far round the ring the agents sit: under the mark, at most from 200° to 340°, as a share of the stage. */
const RING = { from: 200, to: 340, radius: 0.84 } as const

/** Where the i-th of `count` agents sits on the ring: fewer sit closer under the mark, 50° apart, up to the whole arc. */
export const placeOn = (i: number, count: number) => {
  const span = Math.min(RING.to - RING.from, 50 * (count - 1))
  const at = count === 1 ? 0 : i / (count - 1)
  const angle = ((270 - span / 2 + span * at) * Math.PI) / 180
  return { x: 50 + Math.cos(angle) * RING.radius * 50, y: 50 - Math.sin(angle) * RING.radius * 50 }
}

/** A folder held over the window: whether one is, with the counting a drag's enters and leaves need. */
function useDragOver(onDrop: StartProps['onDrop']) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  if (onDrop === undefined) return { over: false, handlers: {} }
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        depth.current += 1
        setOver(true)
      },
      onDragOver: (event: DragEvent) => {
        if (carriesFiles(event)) event.preventDefault()
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault()
        depth.current = 0
        setOver(false)
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onDrop(files)
      },
    },
  }
}

/** Before any project: the agents found on this computer, round the mark and in rows, and picking the first project's repositories. */
export function Start({
  runtimes,
  repositories,
  lookedIn,
  picked,
  onPick,
  onAdd,
  onDrop,
  name,
  onNameChange,
  onCreate,
  creating = false,
  error,
  className,
  text,
  runtimesText,
  ...rows
}: StartProps) {
  const t = { ...startText, ...text }
  const agentsId = useId()
  const reposId = useId()
  const errorId = useId()
  const { over, handlers } = useDragOver(onDrop)
  const asking = runtimes === null
  const agents = runtimes ?? []
  // Round the mark, only the agents on this computer: one to download is in the rows alone.
  const landed = agents.filter((r) => r.state !== RuntimeState.Missing)
  const ready = agents.filter((r) => r.state === RuntimeState.Ready).length
  const chosen = picked.flatMap((id) => repositories?.find((r) => r.id === id) ?? [])
  const forming = chosen.length > 0
  const title = asking ? t.looking : over ? t.over : repositories !== null && repositories.length === 0 ? t.nowhere : t.pick

  return (
    <div className={cx(s.start, over && s.over, forming && s.forming, className)} {...handlers}>
      <div className={s.field} aria-hidden="true">
        <div className={s.halo} />
        {/* Wider than the left half and fading before the sheet, so it never ends in an edge. */}
        <div className={s.glow}>
          <Light height={0.78} />
        </div>
      </div>

      <section className={s.left}>
        <div className={s.stage}>
          <svg className={s.orbit} viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={RING.radius * 50} className={s.ring} pathLength="1" />
            {landed.map((r, i) => {
              const p = placeOn(i, landed.length)
              return (
                <circle
                  key={r.id}
                  cx={p.x}
                  cy={p.y}
                  r="9"
                  className={cx(s.gather, r.state !== RuntimeState.Ready && s.gatherOff)}
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              )
            })}
          </svg>
          <HalftoneMark size={250} className={s.mark} />
          {landed.map((r, i) => {
            const p = placeOn(i, landed.length)
            return (
              <span
                key={r.id}
                className={cx(s.agent, r.state !== RuntimeState.Ready && s.agentOff)}
                style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${i * 140}ms` }}
                aria-hidden="true"
              >
                <BrandChip {...(r.brand === undefined ? {} : { brand: r.brand })} size={40} className={s.chip} />
                <span className={s.agentName}>{r.name}</span>
              </span>
            )
          })}
        </div>

        <div className={s.say}>
          {forming ? (
            <section className={s.project} aria-label={t.project}>
              <span className={s.projectLabel}>{t.project}</span>
              <input
                className={s.projectName}
                aria-label={t.name}
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                spellCheck={false}
                {...(error === undefined ? {} : { 'aria-describedby': errorId })}
              />
              <div className={s.card}>
                <ul className={s.chosen}>
                  {chosen.map((r) => (
                    <li key={r.id} className={s.chosenRepo}>
                      <Icon name="folder" size={13} className={s.chosenIcon} />
                      <span className={s.chosenName}>{r.name}</span>
                      <span className={s.chosenWhere}>{r.where}</span>
                      <button type="button" className={s.leaveOut} aria-label={t.leaveOut(r.name)} onClick={() => onPick(r.id)}>
                        <Icon name="close" size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className={s.ways}>
                  <span className={s.more}>{t.more}</span>
                  <Button variant="signal" kbd={t.createKbd} busy={creating} onClick={onCreate}>
                    {t.create}
                  </Button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <h1 className={s.title}>{title}</h1>
              <p className={s.note}>{asking ? t.lookingNote : `${t.ready(ready)} ${t.pickNote}`}</p>
            </>
          )}
          {error !== undefined && (
            <p id={errorId} className={s.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className={s.right}>
        <div className={s.sheet}>
          <h2 id={agentsId} className={s.label}>
            {t.agents}
            <span className={s.labelNote}>{asking ? t.asking : t.readyOf(ready, agents.length)}</span>
          </h2>
          {asking ? (
            <div className={s.waiting} aria-labelledby={agentsId} aria-busy="true">
              <Skeleton height={36} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : (
            <Runtimes label={t.agentsLabel} runtimes={agents} {...rows} {...(runtimesText === undefined ? {} : { text: runtimesText })} />
          )}

          <div className={s.repos}>
            <h2 id={reposId} className={s.label}>
              {t.repositories}
              {lookedIn !== undefined && repositories !== null && <span className={s.labelNote}>{t.lookedIn(lookedIn)}</span>}
            </h2>
            {repositories === null ? (
              <p className={s.quiet} aria-busy="true">
                {t.searching}
              </p>
            ) : (
              <ul className={s.pick} aria-label={t.repositoriesLabel}>
                {repositories.map((r) => {
                  const on = picked.includes(r.id)
                  return (
                    <li key={r.id}>
                      {/* The whole row ticks it: a Radix checkbox, named by the row. */}
                      <label className={s.repo}>
                        <Checkbox.Root checked={on} onCheckedChange={() => onPick(r.id)} className={s.tick}>
                          <Checkbox.Indicator className={s.tickMark}>
                            <Icon name="check" size={11} />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                        <span className={s.repoName}>{r.name}</span>
                        <span className={s.repoWhere}>{r.where}</span>
                        {r.facts !== undefined && <span className={s.repoFacts}>{r.facts}</span>}
                      </label>
                    </li>
                  )
                })}
                {repositories.length === 0 && <li className={s.quiet}>{t.none}</li>}
                <li>
                  <button type="button" className={cx(s.repo, s.add)} onClick={onAdd}>
                    <span className={cx(s.tick, s.tickAdd)} aria-hidden="true">
                      <Icon name="plus" size={11} />
                    </span>
                    <span className={s.repoName}>{t.add.title}</span>
                    <span className={s.repoWhere}>{t.add.note}</span>
                    <Kbd className={s.repoFacts}>{t.add.kbd}</Kbd>
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
