import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import s from './RunButton.module.css'

/*
 * What a project runs, from the top of its screen or a task's bar (ADR-044):
 * one press runs its default, the first of the list, as the one Run button
 * did; while that runs, the button says where it answers and opens it. The
 * chevron lists everything it runs, those running first, checked, each with
 * where it answers or how it last ended, and the rest with what it runs,
 * where, and who said how; picking one starts or stops it, and the menu stays
 * open, so several start at once. After them, adding something more to run,
 * and the whole list to change. With nothing known to run, the button offers
 * the ways to say what runs.
 */

/** Who said how something runs: worked out from its repository, or kept by the person, the coordinator or another agent. */
export type RunFrom = 'repository' | 'person' | 'coordinator' | 'agent'

/** The ways to add something to run. */
export type AddWay = 'type' | 'scripts' | 'ask'

/** Its run here, as it stands. */
export interface RunTargetRun {
  /** starting: before it says where it answers, or that it runs; ended: by itself, or stopped. */
  state: 'starting' | 'running' | 'ended'
  /** Where it answers: localhost:5290. */
  url?: string
  /** How long it has run, or when it ended: 12m, 3m ago. */
  since?: string
  /** How it ended by itself: its exit code, null where unknown. */
  code?: number | null
  /** It was stopped, not ended by itself. */
  stopped?: boolean
}

/** One of what the project runs, as the button lists it. */
export interface RunTarget {
  id: string
  /** What it is, in a word or two, where someone named it: Storybook. */
  name?: string
  /** What it runs: `bun --filter @althar/ui storybook`. */
  command: string
  /** Where it runs from here, in a word: main, this task. */
  where: string
  from: RunFrom
  /** Its run here; none where it hasn't run, or the run was cleared. */
  run?: RunTargetRun
  /** It runs somewhere else now, seen from here: on main, at its address. */
  elsewhere?: { where: string; url?: string }
}

export interface RunButtonText {
  /** The main half, running the default. */
  run: (label: string) => string
  starting: (label: string) => string
  /** The chevron's name. */
  more: string
  /** The menu's name. */
  label: string
  running: string
  resting: string
  /** The heading over everything, while nothing runs. */
  all: string
  default: string
  startingHint: string
  from: Record<RunFrom, string>
  finished: (since: string) => string
  failed: (code: number | null, since: string) => string
  stopped: (since: string) => string
  elsewhere: (where: string, url?: string) => string
  add: string
  edit: string
  note: string
  /** With nothing known to run. */
  empty: string
  emptyLabel: string
  emptyNote: string
  ask: string
  askAbout: string
  scripts: string
  scriptsAbout: string
  type: string
}

export const runButtonText: RunButtonText = {
  run: (label) => `Run ${label}`,
  starting: (label) => `Starting ${label}…`,
  more: 'Everything to run',
  label: 'What it runs',
  running: 'Running',
  resting: 'Not running',
  all: 'Run',
  default: 'Default',
  startingHint: 'Starting…',
  from: {
    repository: 'Worked out from the repository',
    person: 'Added by you',
    coordinator: 'Added by the coordinator',
    agent: 'Kept by an agent',
  },
  finished: (since) => `Finished ${since}`,
  failed: (code, since) => `Failed ${since}${code === null ? '' : ` · exit ${code}`}`,
  stopped: (since) => `Stopped ${since}`,
  elsewhere: (where, url) => `Running ${where}${url === undefined ? '' : ` at ${url}`}`,
  add: 'Add something to run…',
  edit: 'Edit the list…',
  note: 'Checked ones are running. Pick one to start or stop it.',
  empty: 'Run',
  emptyLabel: 'Something to run',
  emptyNote: 'Althar runs it itself, with no agent, and shows where it answers.',
  ask: 'Ask the coordinator to work it out',
  askAbout: 'It reads the repository and keeps what is worth running.',
  scripts: 'Pick from package.json…',
  scriptsAbout: 'Any of the repository’s scripts.',
  type: 'Type a command…',
}

export interface RunButtonProps {
  /** What the project runs from here, in its order: the first is its default. */
  targets: readonly RunTarget[]
  /** Runs one here. */
  onRun: (id: string) => void
  /** Stops its run here. */
  onStop: (id: string) => void
  /** Opens where its run answers, in the person's browser. */
  onOpen: (id: string) => void
  /** Adds something to run, one of three ways. */
  onAdd: (way: AddWay) => void
  /** Opens the whole list, to order, edit and remove. */
  onEdit: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<RunButtonText>
}

/** Cut for a menu row, which has room; the button's own text is cut by its width, in the CSS. */
const LONGEST = 80

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

/** What the idle button says after Run: its name, else (not where the repository's own way runs, which is just Run) its command in a few words. */
export const buttonLabelOf = (target: RunTarget) => target.name ?? (target.from === 'repository' ? undefined : shortCommand(target.command))

const live = (target: RunTarget) => target.run !== undefined && target.run.state !== 'ended'

/** How its last run ended, in a few words: Failed 8m ago · exit 1. */
const endedOf = (run: RunTargetRun, t: RunButtonText) => {
  const since = run.since ?? ''
  if (run.stopped === true) return t.stopped(since)
  return run.code === 0 ? t.finished(since) : t.failed(run.code ?? null, since)
}

export function RunButton({ targets, onRun, onStop, onOpen, onAdd, onEdit, open, defaultOpen, onOpenChange, text }: RunButtonProps) {
  const t = { ...runButtonText, ...text }
  const [opened, setOpened] = useControlled(open, defaultOpen ?? false, onOpenChange)
  const ways = (
    <>
      <MenuItem icon="agents" description={t.askAbout} onSelect={() => onAdd('ask')}>
        {t.ask}
      </MenuItem>
      <MenuItem icon="list" description={t.scriptsAbout} onSelect={() => onAdd('scripts')}>
        {t.scripts}
      </MenuItem>
      <MenuItem icon="terminal" onSelect={() => onAdd('type')}>
        {t.type}
      </MenuItem>
    </>
  )

  const [first] = targets
  if (first === undefined)
    return (
      <Menu
        label={t.emptyLabel}
        align="end"
        width={320}
        open={opened}
        onOpenChange={setOpened}
        note={t.emptyNote}
        trigger={
          <Button size="small" variant="quiet" icon="terminal" trailingIcon="chevronD">
            {t.empty}
          </Button>
        }
      >
        {ways}
      </Menu>
    )

  const item = (target: RunTarget) => {
    const run = target.run
    const on = live(target)
    const hint =
      run?.state === 'starting' ? t.startingHint : on && run?.url !== undefined ? run.url : target === first && !on ? t.default : undefined
    const about = [
      target.name === undefined && labelOf(target) === target.command ? null : target.command,
      target.where,
      run?.state === 'ended' ? endedOf(run, t) : null,
      on && run?.since !== undefined ? run.since : null,
      target.elsewhere === undefined ? null : t.elsewhere(target.elsewhere.where, target.elsewhere.url),
      run === undefined && target.elsewhere === undefined ? t.from[target.from] : null,
    ]
      .filter((part) => part !== null)
      .join(' · ')
    return (
      <MenuCheckboxItem
        key={target.id}
        checked={on}
        onCheckedChange={() => (on ? onStop(target.id) : onRun(target.id))}
        keepOpen
        {...(hint === undefined ? {} : { hint })}
        description={about}
      >
        {labelOf(target)}
      </MenuCheckboxItem>
    )
  }
  const running = targets.filter(live)
  const resting = targets.filter((target) => !live(target))

  // The main half: runs the default; while it runs, says where it answers and opens it, or, with no address, opens the list.
  // Whatever it says is cut with an ellipsis, so it never crowds the title beside it; the full command is its tooltip.
  const run = first.run
  // Once it runs it says what runs, so it is not mistaken for the Running pill, even where it was just Run.
  const label = buttonLabelOf(first)
  const what = labelOf(first)
  const cut = (words: string) => <span className={s.text}>{words}</span>
  const main =
    run?.state === 'starting'
      ? { children: cut(t.starting(what)), busy: true }
      : run?.state === 'running'
        ? {
            children: (
              <span className={s.live}>
                <LiveDot />
                {cut([what, run.url].filter((part) => part !== undefined).join(' · '))}
              </span>
            ),
            onClick: () => (run.url === undefined ? setOpened(true) : onOpen(first.id)),
          }
        : { children: cut(label === undefined ? t.empty : t.run(label)), icon: 'terminal' as const, onClick: () => onRun(first.id) }

  return (
    <SplitButton
      size="small"
      className={s.split}
      moreLabel={t.more}
      title={first.command}
      {...main}
      menu={(trigger) => (
        <Menu label={t.label} align="end" width={440} open={opened} onOpenChange={setOpened} trigger={trigger} note={t.note}>
          {running.length > 0 && <MenuGroup label={t.running}>{running.map(item)}</MenuGroup>}
          {resting.length > 0 && <MenuGroup label={running.length > 0 ? t.resting : t.all}>{resting.map(item)}</MenuGroup>}
          <MenuSeparator />
          <MenuItem icon="plus" onSelect={() => onAdd('type')}>
            {t.add}
          </MenuItem>
          <MenuItem icon="list" onSelect={onEdit}>
            {t.edit}
          </MenuItem>
        </Menu>
      )}
    />
  )
}
