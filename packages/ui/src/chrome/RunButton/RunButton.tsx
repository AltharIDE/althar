import { type KeyboardEvent, type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './RunButton.module.css'

/*
 * What a project runs, from the top of its screen or a task's bar (ADR-070):
 * the button always says Run, and after it, short, how many failed, or how
 * many run, or that one is on its way. A press only opens the list: nothing
 * runs until it is picked there, the most common included, which is first in
 * the person's order. Each line keeps its state in place: Run; starting or
 * fetching; where it answers, with Stop; or what went wrong, with its way out.
 * What runs comes first, in an order fixed as the list opens, so nothing moves
 * under the pointer. A long list opens on a field to find in: the arrows
 * move, Enter runs, opens or tries again. Adding something to run and the
 * whole list sit at its foot. With nothing known to run, it offers the ways
 * to say what runs.
 */

/** Who said how something runs: worked out from its repository, or kept by the person, the coordinator or another agent. */
export type RunFrom = 'repository' | 'person' | 'coordinator' | 'agent'

/** The ways to add something to run. */
export type AddWay = 'type' | 'scripts' | 'ask'

/** Its run where the button runs, as it stands. */
export interface RunTargetRun {
  /**
   * fetching: Althar fetches the branch or pull request it runs on; unfetched:
   * it couldn't; starting: before it says where it answers, or that it runs;
   * ended: by itself, or stopped.
   */
  state: 'fetching' | 'unfetched' | 'starting' | 'running' | 'ended'
  /** Where it answers: localhost:5290. */
  url?: string
  /** How long it has run, or when it ended or failed: 12m, 3m ago. */
  since?: string
  /** How it ended by itself: its exit code, null where unknown. */
  code?: number | null
  /** It was stopped, not ended by itself. */
  stopped?: boolean
  /** Why it couldn't be fetched, in the runtime's words. */
  why?: string
}

/** One of what the project runs, as the button lists it. */
export interface RunTarget {
  id: string
  /** What it is, in a word or two, where someone named it: Storybook. */
  name?: string
  /** What it runs: `bun --filter @althar/ui storybook`. */
  command: string
  from: RunFrom
  /** Its run here; none where it hasn't run, or the run was cleared. */
  run?: RunTargetRun
}

export interface RunButtonText {
  run: string
  /** The list's name. */
  label: string
  /** A line's own actions. */
  start: string
  stop: string
  again: string
  retry: string
  clear: string
  open: (url: string) => string
  starting: string
  fetching: string
  up: string
  finished: (since: string) => string
  stopped: (since: string) => string
  exited: (code: number | null) => string
  unfetched: string
  /** After Run: how many run, how many failed, one on its way. */
  live: (n: number) => string
  failed: (n: number) => string
  coming: string
  find: string
  none: (words: string) => string
  from: Record<RunFrom, string>
  add: string
  edit: string
  /** With nothing known to run. */
  emptyLabel: string
  emptyNote: string
  ask: string
  askAbout: string
  scripts: string
  scriptsAbout: string
  type: string
}

export const runButtonText: RunButtonText = {
  run: 'Run',
  label: 'What it runs',
  start: 'Run',
  stop: 'Stop',
  again: 'Run again',
  retry: 'Try again',
  clear: 'Clear',
  open: (url) => `Open ${url}`,
  starting: 'Starting…',
  fetching: 'Fetching…',
  up: 'Running',
  finished: (since) => `Finished ${since}`,
  stopped: (since) => `Stopped ${since}`,
  exited: (code) => (code === null ? 'Ended' : `Exited ${code}`),
  unfetched: 'Couldn’t fetch',
  live: (n) => (n === 1 ? '1 running' : `${n} running`),
  failed: (n) => (n === 1 ? '1 failed' : `${n} failed`),
  coming: 'Starting',
  find: 'Find something to run',
  none: (words) => `Nothing to run matches “${words}”`,
  from: {
    repository: 'Worked out from the repository',
    person: 'Added by you',
    coordinator: 'Added by the coordinator',
    agent: 'Kept by an agent',
  },
  add: 'Add something to run',
  edit: 'Edit the list',
  emptyLabel: 'Something to run',
  emptyNote: 'Althar runs it itself, with no agent, and shows where it answers.',
  ask: 'Ask the coordinator to work it out',
  askAbout: 'It reads the repository and keeps what is worth running.',
  scripts: 'Pick from package.json…',
  scriptsAbout: 'Any of the repository’s scripts.',
  type: 'Type a command…',
}

export interface RunButtonProps {
  /** What the project runs from here, in its order: the first is the most common. */
  targets: readonly RunTarget[]
  /** Runs one here, or again, or tries its fetch again. */
  onRun: (id: string) => void
  /** Stops its run here. */
  onStop: (id: string) => void
  /** Opens where its run answers, in the person's browser. */
  onOpen: (id: string) => void
  /** Clears what went wrong with its last run; without it, a failure stays until it runs again. */
  onClear?: (id: string) => void
  /** Adds something to run, one of three ways. */
  onAdd: (way: AddWay) => void
  /** Opens the whole list, to order, edit and remove. */
  onEdit: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<RunButtonText>
}

/** Cut for a line, which has room; the button's own text is short. */
const LONGEST = 80

/** A list long enough to want finding in. */
export const LONG = 8

/** Setup a one-line command does on the way, not what it runs: export, unset, cd, NAME=value on its own. */
const setup = (part: string) => /^(export|unset|cd|set|source|\.)\s/.test(part) || /^[A-Za-z_]\w*=\S*$/.test(part)

/** The parts of a one-liner, split on && ; and lines outside quotes; a || ends a part, since what follows it only runs on failure. */
function parts(command: string): string[] {
  const found: string[] = []
  let part = ''
  let quote: string | null = null
  let fallback = false
  const end = () => {
    if (part.trim() !== '') found.push(part.trim())
    part = ''
    fallback = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    const two = command.slice(i, i + 2)
    if (c === '\\' && quote !== "'") {
      // An escaped character is just itself, a quote too.
      if (!fallback) part += command.slice(i, i + 2)
      i++
    } else if (quote !== null) {
      if (c === quote) quote = null
      if (!fallback) part += c
    } else if (c === '"' || c === "'") {
      quote = c
      if (!fallback) part += c
    } else if (two === '&&') {
      end()
      i++
    } else if (two === '||') {
      fallback = true
      i++
    } else if (c === ';' || c === '\n') end()
    else if (!fallback) part += c
  }
  end()
  return found
}

/**
 * A command in a few words: the last meaningful part of a chain, without its
 * exec and whatever it does only on failure, so `cd app && bun run dev`
 * says `bun run dev`. Not cut to a word: that is often only the runner.
 */
export function shortCommand(command: string): string {
  const all = parts(command).map((part) => part.replace(/^exec\s+/, ''))
  const last = all.findLast((part) => !setup(part)) ?? all.at(-1) ?? command.trim()
  return last.length > LONGEST ? `${last.slice(0, LONGEST - 1)}…` : last
}

/** What the list calls it: its name, else its command in a few words. */
export const labelOf = (target: RunTarget) => target.name ?? shortCommand(target.command)

/** It ended by itself, not well: a failure, until it runs again or is cleared. */
const crashed = (run: RunTargetRun) => run.state === 'ended' && run.stopped !== true && run.code !== 0

/** Its run went wrong: it couldn't be fetched, or it ended by itself, not well. */
export const failedRun = (run: RunTargetRun | undefined) => run !== undefined && (run.state === 'unfetched' || crashed(run))

/** On its way: fetching or starting. */
const coming = (run: RunTargetRun | undefined) => run?.state === 'fetching' || run?.state === 'starting'

/** It runs, or is on its way: listed first. */
const busy = (target: RunTarget) => target.run !== undefined && (target.run.state !== 'ended' || crashed(target.run))

/** What the button says after Run, problems first: how many failed; how many run; or that one is on its way. */
export const statusOf = (targets: readonly RunTarget[]) => {
  const failed = targets.filter((target) => failedRun(target.run)).length
  const live = targets.filter((target) => target.run?.state === 'running').length
  const on = targets.some((target) => coming(target.run))
  return { failed, live, coming: on }
}

/** What Enter does to a line: runs it, or again; opens where it answers; or tries its fetch again. Nothing while it is on its way. */
const primary = (target: RunTarget): 'run' | 'open' | null => {
  const run = target.run
  if (run === undefined || run.state === 'ended' || run.state === 'unfetched') return 'run'
  if (run.state === 'running' && run.url !== undefined) return 'open'
  return null
}

export function RunButton({
  targets,
  onRun,
  onStop,
  onOpen,
  onClear,
  onAdd,
  onEdit,
  open,
  defaultOpen,
  onOpenChange,
  text,
}: RunButtonProps) {
  const t = { ...runButtonText, ...text }
  const [opened, setOpened] = useControlled(open, defaultOpen ?? false, onOpenChange)
  const status = statusOf(targets)

  if (targets.length === 0)
    return (
      <Menu
        label={t.emptyLabel}
        align="end"
        width={320}
        open={opened}
        onOpenChange={setOpened}
        note={t.emptyNote}
        trigger={
          <Button size="small" icon="play" trailingIcon="chevronD" className={s.button}>
            {t.run}
          </Button>
        }
      >
        <MenuItem icon="agents" description={t.askAbout} onSelect={() => onAdd('ask')}>
          {t.ask}
        </MenuItem>
        <MenuItem icon="list" description={t.scriptsAbout} onSelect={() => onAdd('scripts')}>
          {t.scripts}
        </MenuItem>
        <MenuItem icon="terminal" onSelect={() => onAdd('type')}>
          {t.type}
        </MenuItem>
      </Menu>
    )

  // After Run, short, a failure first; each says the whole of it to a screen reader and on hover.
  const after =
    status.failed > 0 ? (
      <span className={cx(s.status, s.bad)} title={t.failed(status.failed)}>
        <Icon name="close" size={9} />
        <span aria-hidden="true">{status.failed}</span>
        <VisuallyHidden>{t.failed(status.failed)}</VisuallyHidden>
      </span>
    ) : status.live > 0 ? (
      <span className={s.status} title={t.live(status.live)}>
        <LiveDot />
        <span aria-hidden="true">{status.live}</span>
        <VisuallyHidden>{t.live(status.live)}</VisuallyHidden>
        {status.coming && <Spinner size="small" />}
      </span>
    ) : status.coming ? (
      <span className={s.status} title={t.coming}>
        <Spinner size="small" />
        <VisuallyHidden>{t.coming}</VisuallyHidden>
      </span>
    ) : null

  return (
    <Popover
      label={t.label}
      placement="below"
      align="end"
      width={480}
      padded={false}
      open={opened}
      onOpenChange={setOpened}
      trigger={
        <Button size="small" icon="play" trailingIcon="chevronD" className={s.button}>
          <span className={s.said}>
            {t.run}
            {after}
          </span>
        </Button>
      }
    >
      <RunList
        targets={targets}
        t={t}
        onRun={onRun}
        onStop={onStop}
        onOpen={onOpen}
        {...(onClear === undefined ? {} : { onClear })}
        onAdd={() => {
          setOpened(false)
          onAdd('type')
        }}
        onEdit={() => {
          setOpened(false)
          onEdit()
        }}
      />
    </Popover>
  )
}

/** The open list: mounted as it opens, so its order is fixed then. */
function RunList({
  targets,
  t,
  onRun,
  onStop,
  onOpen,
  onClear,
  onAdd,
  onEdit,
}: {
  targets: readonly RunTarget[]
  t: RunButtonText
  onRun: (id: string) => void
  onStop: (id: string) => void
  onOpen: (id: string) => void
  onClear?: (id: string) => void
  onAdd: () => void
  onEdit: () => void
}) {
  const [order] = useState(() => [...targets.filter(busy), ...targets.filter((target) => !busy(target))].map((target) => target.id))
  const long = targets.length > LONG
  const [words, setWords] = useState('')
  const [at, setAt] = useState(0)
  const typed = words.trim().toLowerCase()
  const place = (target: RunTarget) => {
    const n = order.indexOf(target.id)
    // One added while it is open goes last.
    return n === -1 ? order.length : n
  }
  const shown = [...targets]
    .sort((one, other) => place(one) - place(other))
    .filter((target) => typed === '' || `${target.name ?? ''} ${target.command}`.toLowerCase().includes(typed))
  const point = Math.min(at, Math.max(shown.length - 1, 0))

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') setAt(Math.min(point + 1, shown.length - 1))
    else if (event.key === 'ArrowUp') setAt(Math.max(point - 1, 0))
    else if (event.key === 'Enter') {
      const target = shown[point]
      const act = target === undefined ? null : primary(target)
      if (target !== undefined && act === 'run') onRun(target.id)
      if (target !== undefined && act === 'open') onOpen(target.id)
    } else return
    event.preventDefault()
  }

  return (
    <div className={cx(s.list, long && s.long)}>
      {long && (
        <div className={s.field}>
          <Icon name="search" size={13} className={s.quietGlyph} />
          <input
            // A long list opens on its field, the first the popover focuses: you arrive typing.
            value={words}
            placeholder={t.find}
            aria-label={t.find}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setWords(event.target.value)
              setAt(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      )}
      <div className={s.scroll}>
        <div className={s.lines}>
          {shown.map((target, n) => (
            <Line
              key={target.id}
              target={target}
              t={t}
              at={long && n === point}
              {...(long ? { onPoint: () => setAt(n) } : {})}
              onRun={() => onRun(target.id)}
              onStop={() => onStop(target.id)}
              onOpen={() => onOpen(target.id)}
              {...(onClear === undefined ? {} : { onClear: () => onClear(target.id) })}
            />
          ))}
          {shown.length === 0 && <p className={s.none}>{t.none(words.trim())}</p>}
        </div>
      </div>
      <div className={s.ways}>
        <ActionButton size="small" icon="plus" onClick={onAdd}>
          {t.add}
        </ActionButton>
        <ActionButton size="small" icon="list" onClick={onEdit}>
          {t.edit}
        </ActionButton>
      </div>
    </div>
  )
}

/** One thing it runs: Run; on its way; where it answers, how long, and Stop; or what went wrong and its way out. Its height is its state's, never the pointer's. */
function Line({
  target,
  t,
  at,
  onPoint,
  onRun,
  onStop,
  onOpen,
  onClear,
}: {
  target: RunTarget
  t: RunButtonText
  at: boolean
  onPoint?: () => void
  onRun: () => void
  onStop: () => void
  onOpen: () => void
  onClear?: () => void
}) {
  const name = labelOf(target)
  const run = target.run
  const clear =
    onClear === undefined ? null : (
      <ActionButton size="small" icon="close" aria-label={`${t.clear} ${name}`} title={t.clear} onClick={onClear} />
    )
  const row = (parts: {
    glyph: ReactNode
    state?: ReactNode
    since?: string
    acts?: ReactNode
    why?: ReactNode
    rest?: boolean
    failed?: boolean
  }) => (
    <div className={cx(s.row, parts.rest === true && s.rest, parts.failed === true && s.failedRow, at && s.at)} onMouseMove={onPoint}>
      <span className={s.glyph}>{parts.glyph}</span>
      <span className={s.name} title={target.command}>
        {name}
      </span>
      <span className={s.state}>{parts.state}</span>
      <span className={s.since}>{parts.since}</span>
      <span className={s.acts}>{parts.acts}</span>
      {parts.why !== undefined && <span className={s.why}>{parts.why}</span>}
    </div>
  )

  if (run?.state === 'unfetched')
    return row({
      failed: true,
      glyph: <Icon name="offline" size={12} className={s.bad} />,
      state: <span className={s.bad}>{t.unfetched}</span>,
      ...(run.since === undefined ? {} : { since: run.since }),
      acts: (
        <>
          <ActionButton size="small" onClick={onRun}>
            {t.retry}
          </ActionButton>
          {clear}
        </>
      ),
      ...(run.why === undefined ? {} : { why: <span title={run.why}>{run.why}</span> }),
    })
  if (run?.state === 'fetching' || run?.state === 'starting')
    return row({
      glyph: <Spinner size="small" />,
      state: <span className={s.quiet}>{run.state === 'fetching' ? t.fetching : t.starting}</span>,
      // A fetch can't be stopped; a start can.
      ...(run.state === 'starting'
        ? {
            acts: (
              <ActionButton size="small" aria-label={`${t.stop} ${name}`} onClick={onStop}>
                {t.stop}
              </ActionButton>
            ),
          }
        : {}),
    })
  if (run?.state === 'running')
    return row({
      glyph: <LiveDot />,
      state:
        run.url === undefined ? (
          <span className={s.quiet}>{t.up}</span>
        ) : (
          <LinkButton className={s.url} title={t.open(run.url)} onClick={onOpen}>
            {run.url}
            <Icon name="external" size={10} />
          </LinkButton>
        ),
      ...(run.since === undefined ? {} : { since: run.since }),
      acts: (
        <ActionButton size="small" aria-label={`${t.stop} ${name}`} onClick={onStop}>
          {t.stop}
        </ActionButton>
      ),
    })
  if (run !== undefined && crashed(run))
    return row({
      failed: true,
      glyph: <Icon name="close" size={11} className={s.bad} />,
      state: <span className={s.bad}>{t.exited(run.code ?? null)}</span>,
      ...(run.since === undefined ? {} : { since: run.since }),
      acts: (
        <>
          <ActionButton size="small" icon="play" onClick={onRun}>
            {t.again}
          </ActionButton>
          {clear}
        </>
      ),
    })
  return row({
    rest: true,
    glyph: <span className={s.hollow} />,
    state:
      run?.state === 'ended' ? (
        <span className={s.quiet}>{run.stopped === true ? t.stopped(run.since ?? '') : t.finished(run.since ?? '')}</span>
      ) : target.name !== undefined ? (
        <code className={s.command}>{shortCommand(target.command)}</code>
      ) : labelOf(target) === target.command.trim() ? undefined : (
        // Unnamed, its name is its command, cut: the whole of it beside, so two that end the same read apart.
        <code className={s.command}>{target.command}</code>
      ),
    acts: (
      <ActionButton size="small" icon="play" aria-label={`${t.start} ${name}`} onClick={onRun}>
        {t.start}
      </ActionButton>
    ),
  })
}
