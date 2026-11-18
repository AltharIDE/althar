import { type KeyboardEvent, useRef, useState } from 'react'

import { Button, IconButton, RunCard, type RunCardProps, TaskFace as KitTaskFace, type TaskFaceProps, Terminal } from '@althar/ui'

import { cx, FailedMoves, FolderMenu, RunOutput } from './parts'
import { useLab } from './state'
import { openTerminal } from './terminal'
import { phaseOf, promptOf, type Run, useWorld, world } from './world'
import s from './directions.module.css'

/*
 * C · In the thread. A run lives where it was started: its card in the
 * conversation, what it prints unfolded under it while it starts and when it
 * fails, a press on its console folding it. The terminal is the composer's
 * other face: $ in an empty composer (or Ctrl+`) turns it into a prompt in a
 * folder of the project, and each command and what it printed go in the
 * thread as the person's, where the agent reads them on its next turn and
 * the rest of the team sees what was done. Escape, or Backspace on an empty
 * line, turns it back.
 */

/** The run's card, as the app draws it, with what it printed under it, in place, rather than in a console over it. */
export function ThreadRun({ run, card }: { run: Run; card: RunCardProps }) {
  useWorld()
  const phase = phaseOf(run)
  // Open as it starts, so it is seen to start, and when it failed, so why is there; a press folds it.
  const [open, setOpen] = useState(phase === 'starting' || phase === 'failed')
  return (
    <div className={cx(s.threadRun, open && s.unfolded)}>
      <RunCard {...card} outputOpen={false} onOutputOpenChange={(next) => next && setOpen(!open)} output={{ text: '' }} />
      {open && (
        <div className={s.unfold}>
          <RunOutput run={run} className={s.unfoldOut} />
          {phase === 'failed' && <FailedMoves run={run} onTerminal={() => openTerminal(run.folder)} className={s.unfoldMoves} />}
        </div>
      )}
    </div>
  )
}

/** A command the person typed in the conversation's terminal: theirs, as their words are, and what it printed under it. */
export function YouRan({ id }: { id: string }) {
  useWorld()
  const entry = world.entry(id)
  if (entry === undefined) return null
  return (
    <div className={s.ran}>
      <div className={s.ranSaid}>
        <span className={s.ranWhere}>{promptOf(entry.folder, entry.cwd)}</span>
        <code className={s.ranCommand}>
          <span className={s.ranSign}>$</span> {entry.command}
        </code>
      </div>
      {(entry.lines.length > 0 || entry.running) && (
        <div className={s.ranOut}>
          <Terminal
            lines={entry.lines}
            {...(entry.running ? { live: '' } : {})}
            {...(entry.exit !== null && entry.exit !== 0 && entry.exit !== 130 ? { exit: entry.exit } : {})}
          />
          {entry.running && (
            <Button size="small" variant="quiet" className={s.ranStop} onClick={() => world.interrupt(entry.id)}>
              Stop
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** The composer's terminal face: the folder, the prompt, and the line being typed; Enter runs it in the thread. */
function ShellLine() {
  const state = useWorld()
  const shell = state.shells.find((one) => one.inThread)
  const [typed, setTyped] = useState('')
  const [back, setBack] = useState<number | null>(null)
  if (shell === undefined) return null
  const running = shell.entries.find((one) => one.running)
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key === 'c') {
      event.preventDefault()
      if (running !== undefined) world.interrupt(running.id)
      else setTyped('')
    } else if (event.key === 'Escape' || (event.key === 'Backspace' && typed === '')) {
      event.preventDefault()
      world.setShellMode(false)
      queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('[data-lab-window] textarea')?.focus())
    } else if (event.key === 'Enter' && running === undefined) {
      event.preventDefault()
      world.exec(shell.id, typed)
      setTyped('')
      setBack(null)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const history = shell.history
      if (history.length === 0) return
      const at = back ?? history.length
      const next = event.key === 'ArrowUp' ? Math.max(0, at - 1) : Math.min(history.length, at + 1)
      setBack(next === history.length ? null : next)
      setTyped(next === history.length ? '' : (history[next] ?? ''))
    }
  }
  return (
    <div className={s.shellLine}>
      <FolderMenu folder={shell.folder} onPick={(folder) => world.threadShell(folder)} label="Where it runs" />
      <span className={s.shellSign} aria-hidden="true">
        $
      </span>
      <input
        className={s.shellInput}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer's own face: it takes the keys it was opened by
        autoFocus
        value={typed}
        aria-label={`Command in ${promptOf(shell.folder, shell.cwd)}`}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {running !== undefined ? (
        <Button size="small" variant="quiet" onClick={() => world.interrupt(running.id)}>
          Stop
        </Button>
      ) : (
        <IconButton
          icon="comment"
          label="Back to a message"
          kbd="esc"
          size="small"
          tooltipAlign="end"
          onClick={() => world.setShellMode(false)}
        />
      )}
    </div>
  )
}

/** The composer, with its terminal face in C: $ typed first turns it. The message's draft stays under it, kept. */
function ComposerWithShell({ composer }: { composer: TaskFaceProps['composer'] }) {
  const state = useWorld()
  const box = useRef<HTMLDivElement>(null)
  return (
    <>
      <div
        ref={box}
        hidden={state.shellMode}
        onKeyDownCapture={(event) => {
          const field = event.target
          if (event.key === '$' && field instanceof HTMLTextAreaElement && field.value === '') {
            event.preventDefault()
            world.setShellMode(true)
          }
        }}
      >
        {composer}
      </div>
      {state.shellMode && <ShellLine />}
    </>
  )
}

/** The kit's conversation face, as the project's screen takes it in the lab: in C, its composer has a terminal face. */
export function TaskFace(props: TaskFaceProps) {
  const { d } = useLab()
  if (d !== 'c') return <KitTaskFace {...props} />
  return <KitTaskFace {...props} composer={<ComposerWithShell composer={props.composer} />} />
}
