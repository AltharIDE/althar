import { Checkbox } from 'radix-ui'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import { keys, modKey } from '../../foundations/keys'
import { device } from '../../foundations/device'
import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Icon } from '../../foundations/Icon/Icon'
import { Light } from '../../foundations/Light/Light'
import { BrandChip, BrandMark } from '../../foundations/Marks/Marks'
import { RuntimeState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { useDragOver } from '../../lib/dragOver'
import { Button } from '../../primitives/Button/Button'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { type PinnedDownload, type RuntimeEntry, Runtimes, type RuntimesProps, type RuntimesText } from '../../setup/Runtimes/Runtimes'
import s from './Start.module.css'

/*
 * The first thing Althar shows, before there is a project: the whole window
 * spent looking, and seen to look. No tabs and no bar yet; the page runs to
 * the window's edges, a printed halo round the mark and the light rising
 * behind it.
 *
 * On the left the mark stands in its own light, and each agent that
 * answered lands on a ring under it: signed in in full, otherwise faint. On
 * the right, on a sheet over the light, the agents on this computer, a row
 * each with who it is signed in as and its accounts; under them, quieter, a
 * small tile for each other agent Althar runs, to download where Althar can
 * fetch it, as many as there are; then the repositories found where people
 * keep code.
 *
 * A project is one repository or several, so they are picked, not opened:
 * each one ticked joins the project taking shape under the mark, named after
 * the first until the person names it. More come from Add a folder, or
 * dropped on the window. Nothing here is a step to finish: a project can be
 * made with no agent ready, and its tasks start once one is. At the
 * sheet's foot, a quiet line may ask once what may be sent, such as crash
 * reports, with its switch: never a step to finish either.
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
  pick: string
  nowhere: string
  over: string
  pickNote: string
  agents: string
  agentsLabel: string
  asking: string
  readyOf: (ready: number, of: number) => string
  /** Under the rows where none is on this computer yet. */
  noneHere: string
  /** The other agents Althar runs, under those on this computer: their heading, and their list's name. */
  away: string
  awayLabel: string
  /** A tile's way to have its agent: Althar fetches it, about this big (its button shows the size), or the agent's own instructions. */
  downloadNamed: (name: string, size: string) => string
  /** Where a download comes from, on its button's tooltip: a release's latest on GitHub, or one version its maker publishes. */
  downloadFrom: (pinned?: PinnedDownload) => string
  downloading: (size: string) => string
  install: string
  installNamed: (name: string) => string
  tryAgain: string
  tryAgainNamed: (name: string, size: string) => string
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
  looking: `Looking around ${device.this}…`,
  pick: 'Where should they work?',
  nowhere: 'Where is your code?',
  over: 'Let go to add it',
  pickNote: 'One or more repositories',
  agents: 'Agents',
  agentsLabel: `Agents on ${device.this}`,
  asking: 'asking…',
  readyOf: (ready, of) => `${ready} of ${of} ready`,
  noneHere: `None on ${device.this} yet`,
  away: `Not on ${device.this}`,
  awayLabel: `Agents not on ${device.this}`,
  downloadNamed: (name, size) => `Download ${name}, ${size}`,
  downloadFrom: (pinned) => (pinned === undefined ? 'Its latest release, from GitHub' : `${pinned.version}, from ${pinned.from}`),
  downloading: (size) => `Downloading, ${size}…`,
  install: 'How to install',
  installNamed: (name) => `How to install ${name}`,
  tryAgain: 'Try again',
  tryAgainNamed: (name, size) => `Try again to download ${name}, ${size}`,
  repositories: 'Repositories',
  repositoriesLabel: 'Repositories for the project',
  lookedIn: (where) => `in ${where}`,
  searching: 'Looking…',
  none: 'None found in the usual places.',
  add: { title: 'Add a folder…', note: `anywhere on ${device.this}`, kbd: modKey('N') },
  project: 'Your first project',
  name: 'Project name',
  more: 'Tick more, or drop folders on the window.',
  leaveOut: (name) => `Leave ${name} out`,
  create: 'Make the project',
  createKbd: modKey(keys.return),
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
  /** One quiet line at the sheet's foot, such as crash reports with their switch (CrashReportsLine). */
  foot?: ReactNode
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
  foot,
  ...rows
}: StartProps) {
  const t = { ...startText, ...text }
  const agentsId = useId()
  const reposId = useId()
  const errorId = useId()
  const { over, handlers } = useDragOver(onDrop)
  const page = useRef<HTMLDivElement>(null)
  // A repository left out takes its × with it: focus goes to the × now in its place, else to the repository's own tick.
  const refocus = useRef<{ readonly at: number; readonly id: string } | null>(null)
  useEffect(() => {
    const was = refocus.current
    if (was === null) return
    refocus.current = null
    if (document.activeElement !== null && document.activeElement !== document.body) return
    const buttons = page.current?.querySelectorAll<HTMLButtonElement>('[data-leave-out]') ?? []
    const tick = [...(page.current?.querySelectorAll<HTMLButtonElement>('[data-pick]') ?? [])].find((one) => one.dataset.pick === was.id)
    ;(buttons[Math.min(was.at, buttons.length - 1)] ?? tick)?.focus()
  })
  const asking = runtimes === null
  const agents = runtimes ?? []
  // On this computer: round the mark, and a row each, with who it is signed in as and its accounts.
  const here: readonly RuntimeEntry[] = agents.filter((r) => r.state !== RuntimeState.Missing && r.state !== RuntimeState.Installing)
  // The others Althar runs, under those and quieter, a tile each: those it can fetch first, as there may be many.
  const away = [...agents.filter((r) => !here.includes(r) && fetchable(r)), ...agents.filter((r) => !here.includes(r) && !fetchable(r))]
  const ready = agents.filter((r) => r.state === RuntimeState.Ready).length
  const chosen = picked.flatMap((id) => repositories?.find((r) => r.id === id) ?? [])
  const forming = chosen.length > 0
  const title = asking ? t.looking : over ? t.over : repositories !== null && repositories.length === 0 ? t.nowhere : t.pick

  return (
    <div ref={page} className={cx(s.start, over && s.over, forming && s.forming, className)} {...handlers}>
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
            {here.map((r, i) => {
              const p = placeOn(i, here.length)
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
          {here.map((r, i) => {
            const p = placeOn(i, here.length)
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
                  {chosen.map((r, at) => (
                    <li key={r.id} className={s.chosenRepo}>
                      <Icon name="folder" size={13} className={s.chosenIcon} />
                      <span className={s.chosenName}>{r.name}</span>
                      <span className={s.chosenWhere}>{r.where}</span>
                      <button
                        type="button"
                        className={s.leaveOut}
                        aria-label={t.leaveOut(r.name)}
                        data-leave-out=""
                        onClick={() => {
                          refocus.current = { at, id: r.id }
                          onPick(r.id)
                        }}
                      >
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
              {!asking && <p className={s.note}>{t.pickNote}</p>}
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
            <span className={s.labelNote}>{asking ? t.asking : t.readyOf(ready, here.length)}</span>
          </h2>
          {asking ? (
            <div className={s.waiting} aria-labelledby={agentsId} aria-busy="true">
              <Skeleton height={36} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : (
            <>
              {here.length > 0 ? (
                <Runtimes label={t.agentsLabel} runtimes={here} {...rows} {...(runtimesText === undefined ? {} : { text: runtimesText })} />
              ) : (
                <p className={s.quiet}>{t.noneHere}</p>
              )}
              {away.length > 0 && <Away agents={away} t={t} onInstall={rows.onInstall} onHelp={rows.onHelp} />}
            </>
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
                        <Checkbox.Root checked={on} onCheckedChange={() => onPick(r.id)} className={s.tick} data-pick={r.id}>
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
          {foot !== undefined && (
            <div className={s.foot}>
              <div className={s.footLine}>{foot}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

/** Whether Althar can fetch an agent that isn't on this computer, or is fetching it. */
const fetchable = (r: RuntimeEntry) => r.state === RuntimeState.Installing || (r.state === RuntimeState.Missing && r.download !== undefined)

/**
 * The agents Althar runs that aren't on this computer, under those that are:
 * a heading quieter than theirs, and a small tile each, side by side where
 * there is room, so many more fit in a few lines. A tile is the agent's mark
 * and name, and its one way in: a download, about so big, where Althar can
 * fetch it (where from, on its tooltip); else the agent's own instructions.
 */
function Away({
  agents,
  t,
  onInstall,
  onHelp,
}: {
  agents: readonly RuntimeEntry[]
  t: StartText
  onInstall: RuntimesProps['onInstall']
  onHelp: RuntimesProps['onHelp']
}) {
  const id = useId()
  return (
    <section className={s.away} aria-labelledby={id}>
      <h3 id={id} className={s.awayLabel}>
        {t.away}
        <span className={s.labelNote}>{agents.length}</span>
      </h3>
      <ul className={s.spares} aria-label={t.awayLabel}>
        {agents.map((r) => (
          <li key={r.id} className={s.spare}>
            <span className={s.spareMark}>{r.brand ? <BrandMark brand={r.brand} size={15} /> : <Icon name="plug" size={14} />}</span>
            <span className={s.spareName}>{r.name}</span>
            <span className={s.spareWay}>{wayOf(r, t, onInstall, onHelp)}</span>
            {r.state === RuntimeState.Missing && r.failed !== undefined && (
              <span className={s.spareFailed} role="alert">
                {r.failed}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A tile's one way in: downloading, a download, or the agent's own instructions; nothing where it has none. */
function wayOf(r: RuntimeEntry, t: StartText, onInstall: RuntimesProps['onInstall'], onHelp: RuntimesProps['onHelp']) {
  if (r.state === RuntimeState.Installing)
    return (
      <output className={s.spareBusy}>
        <Spinner size="small" />
        {t.downloading(r.download)}
      </output>
    )
  if (r.state !== RuntimeState.Missing) return null
  if (r.download !== undefined && onInstall !== undefined)
    return (
      <Tooltip label={t.downloadFrom(r.pinned)} placement="above" align="end">
        <Button
          size="small"
          {...(r.failed === undefined ? { icon: 'download' as const } : {})}
          aria-label={r.failed === undefined ? t.downloadNamed(r.name, r.download) : t.tryAgainNamed(r.name, r.download)}
          onClick={() => onInstall(r.id)}
        >
          {r.failed === undefined ? r.download : t.tryAgain}
        </Button>
      </Tooltip>
    )
  if (onHelp !== undefined && r.guide !== false)
    return (
      <button type="button" className={s.spareHelp} aria-label={t.installNamed(r.name)} onClick={() => onHelp(r.id)}>
        {t.install}
        <Icon name="external" size={11} />
      </button>
    )
  return null
}
