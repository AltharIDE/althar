import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import {
  Button,
  Icon,
  IconButton,
  isTerminalError,
  JumpToLatest,
  LinkButton,
  LiveDot,
  Menu,
  MenuItem,
  MenuSeparator,
  Spinner,
  Terminal,
  useStickToBottom,
} from '@althar/ui'

import { FOLDERS, type Folder, folderName, helpText, phaseOf, promptOf, type Run, type Shell, useWorld, world } from './world'
import s from './parts.module.css'

/** Class names, those given. */
export const cx = (...names: ReadonlyArray<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/*
 * What every direction draws a run and a terminal with: a run's mark and
 * state in words, what it printed (following its end), its ways out, and a
 * terminal to type in, in a folder that can be changed. Made of the kit's
 * own pieces; the terminal itself is the lab's, as the kit has none yet.
 */

export const text = {
  starting: 'Starting…',
  stopped: 'Stopped',
  finished: 'Finished',
  exited: (code: number | null) => (code === null ? 'Ended' : `Exited ${code}`),
  running: 'Running',
  stop: 'Stop',
  again: 'Run again',
  help: 'Help me fix it',
  terminalHere: 'Open a terminal here',
  terminal: 'Terminal',
  newTerminal: 'New terminal',
  close: 'Close',
  folder: 'Folder',
  inFolder: (name: string) => `Terminal in ${name}`,
  project: 'The project',
  tasks: 'Tasks’ worktrees',
  open: (url: string) => `Open ${url}`,
  copy: 'Copy command',
}

/** Where a run answers, as the app says it: the address without its scheme or a bare trailing slash. */
export const addressOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** A run's mark: on its way, running, failed, stopped or done. */
export function RunMark({ run }: { run: Run }) {
  const phase = phaseOf(run)
  return (
    <span className={s.mark} aria-hidden="true">
      {phase === 'starting' && <Spinner size="small" />}
      {phase === 'running' && <LiveDot />}
      {phase === 'failed' && <Icon name="close" size={11} className={s.bad} />}
      {phase === 'stopped' && <Icon name="square" size={10} className={s.faint} />}
      {phase === 'finished' && <Icon name="check" size={11} />}
    </span>
  )
}

/** How long, at a glance: 12m, 2h. */
export const sinceOf = (at: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

/** A run's state in words: on its way, where it answers, how long it has run, or how it ended. `inPress`: in a button already, its address is words, not a link. */
export function RunState({ run, short = false, inPress = false }: { run: Run; short?: boolean; inPress?: boolean }) {
  const phase = phaseOf(run)
  if (phase === 'starting') return <span className={s.quiet}>{text.starting}</span>
  if (phase === 'running')
    return run.url !== null && inPress ? (
      <span className={s.addressWords}>{addressOf(run.url)}</span>
    ) : run.url !== null ? (
      <LinkButton className={s.address} aria-label={text.open(addressOf(run.url))} onClick={() => window.open(run.url ?? '', '_blank')}>
        {addressOf(run.url)}
        {!short && <Icon name="external" size={10} />}
      </LinkButton>
    ) : (
      <span className={s.quiet}>
        {text.running}
        {!short && Date.now() - run.startedAt >= 60_000 && ` · ${sinceOf(run.startedAt)}`}
      </span>
    )
  if (phase === 'failed') return <span className={s.bad}>{text.exited(run.ended?.code ?? null)}</span>
  return <span className={s.quiet}>{phase === 'stopped' ? text.stopped : text.finished}</span>
}

/** What it printed, following its end as more comes; scrolled up, it stays put, and Latest goes back down. */
export function RunOutput({ run, className, tail }: { run: Run; className?: string; tail?: number }) {
  useWorld()
  const box = useRef<HTMLDivElement>(null)
  const { atBottom, toBottom } = useStickToBottom(box, 12)
  const lines = tail === undefined ? run.lines : run.lines.slice(-tail)
  useEffect(() => {
    if (atBottom) toBottom()
  }, [lines.length, atBottom, toBottom])
  const running = run.ended === null
  return (
    <div className={cx(s.printed, className)}>
      <div ref={box} className={s.scroll}>
        {/* Its setup and its command say themselves as they run; how it ended is in its head, not again here. */}
        <Terminal flush lines={lines} {...(running ? { live: '' } : {})} />
      </div>
      {!atBottom && <JumpToLatest onJump={toBottom} className={s.latest} />}
    </div>
  )
}

/** A run's own ways, in a row: Stop while it runs; Run again once it ended. */
export function RunMoves({ run }: { run: Run }) {
  return run.ended === null ? (
    <Button size="small" variant="quiet" onClick={() => world.stop(run.id)}>
      {text.stop}
    </Button>
  ) : (
    <Button size="small" icon="play" onClick={() => world.again(run.id)}>
      {text.again}
    </Button>
  )
}

/** The composer's field, as the app draws it: its textarea in the project's conversation. */
const composerField = () => document.querySelector<HTMLTextAreaElement>('[data-lab-window] textarea')

/** Help me fix it, as another task builds it: the run said to the agent in the composer, not sent, focused at its end. */
export const helpMeFix = (run: Run) => {
  const field = composerField()
  if (field === null) return
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  const was = field.value.trim()
  setter?.call(field, was === '' ? helpText(run) : `${was}\n\n${helpText(run)}`)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
  field.setSelectionRange(field.value.length, field.value.length)
}

/** A failed run's ways out, as a card's last row: a terminal where it ran, Run again, and Help me fix it. */
export function FailedMoves({
  run,
  onTerminal,
  onHelp = () => helpMeFix(run),
  className,
}: {
  run: Run
  /** Opens a terminal where it ran; without it, as where one is open beside it already, none. */
  onTerminal?: () => void
  /** Where Help me fix it says it: the composer on screen, by default. */
  onHelp?: () => void
  className?: string
}) {
  return (
    <div className={cx(s.moves, className)}>
      {onTerminal !== undefined && (
        <Button size="small" variant="quiet" icon="terminal" onClick={onTerminal}>
          {text.terminalHere}
        </Button>
      )}
      <span className={s.gap} />
      <Button size="small" icon="play" onClick={() => world.again(run.id)}>
        {text.again}
      </Button>
      <Button size="small" variant="signal" onClick={onHelp}>
        {text.help}
      </Button>
    </div>
  )
}

/** A folder, as a terminal's head says it: its repository, and where it is, a task's worktree or the project's own. */
export function FolderMenu({ folder, onPick, label = text.folder }: { folder: Folder; onPick: (folder: Folder) => void; label?: string }) {
  const project = FOLDERS.filter((one) => one.task === undefined)
  const tasks = FOLDERS.filter((one) => one.task !== undefined)
  return (
    <Menu
      label={label}
      width={320}
      trigger={
        <button type="button" className={s.folder} title={folder.path}>
          <Icon name="folder" size={12} className={s.faint} />
          <span className={s.folderName}>{folderName(folder)}</span>
          <span className={s.branch}>{folder.branch}</span>
          <Icon name="chevronD" size={10} className={s.faint} />
        </button>
      }
    >
      {project.map((one) => (
        <MenuItem key={one.path} icon="folder" hint={<code className={s.hint}>{one.branch}</code>} onSelect={() => onPick(one)}>
          {one.repository}
        </MenuItem>
      ))}
      <MenuSeparator />
      {tasks.map((one) => (
        <MenuItem
          key={one.path}
          icon="branch"
          description={<code className={s.hint}>{`${one.repository} · ${one.branch}`}</code>}
          onSelect={() => onPick(one)}
        >
          {one.task}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** The prompt, as the terminal says where it is: the folder and its branch, then the sign. */
function Prompt({ shell, folder = shell.folder, cwd = shell.cwd }: { shell: Shell; folder?: Folder; cwd?: string }) {
  return (
    <span className={s.prompt} aria-hidden="true">
      <span className={s.at}>{promptOf(folder, cwd)}</span> <span className={s.on}>{folder.branch}</span>{' '}
      <span className={s.sign}>$</span>{' '}
    </span>
  )
}

/**
 * A terminal: what was typed and what it printed, then the prompt and the
 * line being typed. Enter runs it; ↑ ↓ go through what was typed; Ctrl+C
 * stops what runs, Ctrl+L clears. Pressing anywhere in it types there.
 */
export function ShellView({ shell, className, autoFocus = true }: { shell: Shell; className?: string; autoFocus?: boolean }) {
  useWorld()
  const [typed, setTyped] = useState('')
  const [back, setBack] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { atBottom, toBottom } = useStickToBottom(box, 12)
  const entries = shell.entries.slice(shell.clearedAt)
  const running = entries.find((one) => one.running)
  const size = entries.reduce((n, one) => n + one.lines.length + 1, 0)
  useEffect(() => {
    if (atBottom) toBottom()
  }, [size, atBottom, toBottom])
  // Its line takes the keys as it opens, and again once what ran in it is done.
  const idle = running === undefined
  useEffect(() => {
    if (autoFocus && idle) input.current?.focus({ preventScroll: true })
  }, [autoFocus, shell.id, idle])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key === 'c') {
      event.preventDefault()
      if (running !== undefined) world.interrupt(running.id)
      else setTyped('')
      return
    }
    if (event.ctrlKey && event.key === 'l') {
      event.preventDefault()
      world.exec(shell.id, 'clear')
      return
    }
    if (event.key === 'Tab') event.preventDefault()
    if (running !== undefined) return
    if (event.key === 'Enter') {
      event.preventDefault()
      world.exec(shell.id, typed)
      setTyped('')
      setBack(null)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const history = shell.history
      if (history.length === 0) return
      const at = back === null ? history.length : back
      const next = event.key === 'ArrowUp' ? Math.max(0, at - 1) : Math.min(history.length, at + 1)
      setBack(next === history.length ? null : next)
      setTyped(next === history.length ? '' : (history[next] ?? ''))
    }
  }

  return (
    <div
      className={cx(s.shell, className)}
      onMouseUp={() => {
        // A press types there; a selection stays, to copy.
        if (window.getSelection()?.toString() === '') input.current?.focus({ preventScroll: true })
      }}
    >
      <div ref={box} className={s.scroll}>
        <pre className={s.out}>
          {entries.map((entry) => (
            <span key={entry.id} className={s.entry}>
              <span className={s.line}>
                <Prompt shell={shell} folder={entry.folder} cwd={entry.cwd} />
                <span className={s.typed}>{entry.command}</span>
                {'\n'}
              </span>
              {entry.lines.map((line, n) => (
                <span key={n} className={cx(s.line, isTerminalError(line) && s.err)}>
                  {line}
                  {'\n'}
                </span>
              ))}
            </span>
          ))}
          <span className={cx(s.line, s.here)} hidden={running !== undefined}>
            <Prompt shell={shell} />
            <input
              ref={input}
              className={s.input}
              value={typed}
              aria-label={text.inFolder(promptOf(shell.folder, shell.cwd))}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </span>
          {running !== undefined && (
            <span className={s.line}>
              <i className={s.cursor} aria-hidden="true" />
              {/* Ctrl+C still reaches it: the field stays, out of sight. */}
              <input className={s.hidden} aria-label={text.stop} onKeyDown={onKeyDown} autoFocus readOnly />
            </span>
          )}
        </pre>
      </div>
      {!atBottom && <JumpToLatest onJump={toBottom} className={s.latest} />}
    </div>
  )
}

/** A terminal's name, as a list of them says it: its repository, or the task whose worktree it is in; numbered where two share one. */
export const shellName = (shell: Shell, shells: ReadonlyArray<Shell>) => {
  const same = shells.filter((one) => one.folder.path === shell.folder.path)
  const n = same.indexOf(shell)
  const name = shell.folder.task ?? shell.folder.repository
  return same.length > 1 && n > 0 ? `${name} ${n + 1}` : name
}

/** Its name is a repository's, set as code; a task's title is words. */
export const shellNamedByFolder = (shell: Shell) => shell.folder.task === undefined

/** The folder a terminal opens in from Run: the repository of the run that last failed, else the project's first. */
export const terminalFolder = (): Folder => {
  const failed = world.get().runs.findLast((one) => phaseOf(one) === 'failed')
  return failed?.folder ?? FOLDERS[0]!
}

/** A close button for something in a row of them, shown when pointed at. */
export function CloseOne({ label, onClose }: { label: string; onClose: () => void }) {
  return <IconButton icon="close" label={label} size="small" className={s.closeOne} onClick={onClose} />
}

export const Gap = () => <span className={s.gap} />

export const Row = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx(s.row, className)}>{children}</div>
)

/**
 * The top edge of something raised from the window's foot, to drag it taller
 * or shorter; ↑ ↓ move it a step, and a double click puts it back. The kit's
 * ResizeHandle does a column's width; this is its height's.
 */
export function HeightEdge({
  value,
  min,
  max,
  onChange,
  onReset,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (height: number) => void
  onReset?: () => void
  label: string
}) {
  const drag = useRef<{ readonly y: number; readonly height: number } | null>(null)
  const clamp = (height: number) => Math.round(Math.min(Math.max(height, min), Math.max(min, max)))
  const end = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={clamp(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      tabIndex={0}
      className={s.heightEdge}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, height: value }
      }}
      onPointerMove={(event) => {
        const from = drag.current
        if (from !== null) onChange(clamp(from.height + from.y - event.clientY))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const by = event.key === 'ArrowUp' ? 16 : event.key === 'ArrowDown' ? -16 : 0
        if (by === 0) return
        event.preventDefault()
        onChange(clamp(value + by))
      }}
      onDoubleClick={onReset}
    />
  )
}
