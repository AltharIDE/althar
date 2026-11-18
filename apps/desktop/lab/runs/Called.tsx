import { useEffect, useState } from 'react'

import { Icon, IconButton } from '@althar/ui'

import { same } from './Below'
import {
  CloseOne,
  cx,
  FailedMoves,
  FolderMenu,
  HeightEdge,
  helpMeFix,
  RunMark,
  RunMoves,
  RunOutput,
  RunState,
  shellName,
  shellNamedByFolder,
  ShellView,
  text,
} from './parts'
import { useLab } from './state'
import { openTerminal } from './terminal'
import { type Focus, phaseOf, type Run, useWorld, world } from './world'
import s from './directions.module.css'

/*
 * B3 · Only when called. Nothing at the foot at rest: no band, no line. Run
 * raises a panel there as it starts, as a run card's console, Run's Open a
 * terminal and Ctrl+` do; its chevron, or Ctrl+` again, puts it away, and
 * Run's count is what says something still runs. Up, it is a panel to work
 * in: what the project runs and its terminals listed down its side, the
 * chosen one big, and a terminal opened from a run beside it, so a failure
 * and its fix are side by side. Its top edge drags it taller, and it can take
 * the whole of the project's screen (D's room, without leaving).
 */

const HEIGHT = 380

/** Where the project's screen begins under its header: what the whole panel covers. */
const useScreenTop = (on: boolean) => {
  const [top, setTop] = useState(88)
  useEffect(() => {
    if (!on) return
    const frame = document.querySelector<HTMLElement>('[data-lab-window]')
    const headers = frame?.querySelectorAll<HTMLElement>('header[data-drag]')
    const header = headers?.[headers.length - 1]
    if (frame === null || frame === undefined || header === undefined) return
    const measure = () => setTop(header.getBoundingClientRect().bottom - frame.getBoundingClientRect().top)
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(frame)
    return () => seen.disconnect()
  }, [on])
  return top
}

/** One of the list's: a run by its mark, name and state, or a terminal by its folder; under a run, the terminal opened beside it. */
function Item({ at, chosen, nested = false }: { at: Focus; chosen: boolean; nested?: boolean }) {
  const state = useWorld()
  const run = at.kind === 'run' ? world.run(at.id) : undefined
  const shell = at.kind === 'shell' ? world.shell(at.id) : undefined
  if (run === undefined && shell === undefined) return null
  return (
    <span className={cx(s.listItem, chosen && s.chosen, nested && s.nested)}>
      <button
        type="button"
        className={s.listPress}
        aria-current={chosen || undefined}
        // A terminal beside a run shows with it.
        onClick={() =>
          world.show(nested ? { kind: 'run', id: Object.keys(state.pairs).find((one) => state.pairs[one] === at.id) ?? '' } : at)
        }
      >
        {run !== undefined && (
          <>
            <RunMark run={run} />
            <span className={s.listName}>{run.name}</span>
            {phaseOf(run) !== 'running' || run.url !== null ? (
              <span className={s.listState}>
                <RunState run={run} short inPress />
              </span>
            ) : null}
          </>
        )}
        {shell !== undefined && (
          <>
            <Icon name="terminal" size={12} className={s.faint} />
            <span className={cx(s.listName, shellNamedByFolder(shell) && s.mono)}>{shellName(shell, state.shells)}</span>
          </>
        )}
      </button>
      {run !== undefined && run.ended !== null && <CloseOne label={`Clear ${run.name}`} onClose={() => world.clear(run.id)} />}
      {shell !== undefined && <CloseOne label="Close this terminal" onClose={() => world.closeShell(shell.id)} />}
    </span>
  )
}

/** A run, big: what it printed, ending in a failed one's ways out. */
function RunPane({ run, paired, onHelp }: { run: Run; paired: boolean; onHelp: () => void }) {
  return (
    <div className={s.calledPane}>
      <RunOutput run={run} />
      {phaseOf(run) === 'failed' && (
        <FailedMoves run={run} {...(paired ? {} : { onTerminal: () => openTerminal(run.folder, run.id) })} onHelp={onHelp} />
      )}
    </div>
  )
}

export function CalledPanel() {
  const { d } = useLab()
  const state = useWorld()
  const [height, setHeight] = useState(HEIGHT)
  const shown = d === 'b3' && state.open
  const top = useScreenTop(shown && state.whole)
  if (!shown) return null
  const paired = new Set(Object.values(state.pairs))
  const loose = state.shells.filter((one) => !paired.has(one.id))
  const focus: Focus | null =
    state.focus ??
    (state.runs[0] !== undefined
      ? { kind: 'run', id: state.runs[0].id }
      : loose[0] !== undefined
        ? { kind: 'shell', id: loose[0].id }
        : null)
  const run = focus?.kind === 'run' ? world.run(focus.id) : undefined
  const pair = run === undefined ? undefined : world.shell(state.pairs[run.id] ?? '')
  const shell = focus?.kind === 'shell' ? world.shell(focus.id) : undefined
  const failed = run !== undefined && phaseOf(run) === 'failed'
  const onHelp = (one: Run) => () => {
    // The composer is in the conversation, under the whole panel: back to the foot, then the run said there.
    world.setWhole(false)
    helpMeFix(one)
  }
  return (
    <section className={cx(s.called, state.whole && s.whole)} style={state.whole ? { top } : { height }} aria-label="Runs and terminals">
      {!state.whole && (
        <HeightEdge value={height} min={200} max={640} onChange={setHeight} onReset={() => setHeight(HEIGHT)} label="Height of the panel" />
      )}
      <div className={s.calledHead}>
        {run !== undefined && (
          <>
            <RunMark run={run} />
            <span className={s.paneName}>{run.name}</span>
            <span className={s.headState}>
              <RunState run={run} />
            </span>
          </>
        )}
        {shell !== undefined && (
          <>
            <Icon name="terminal" size={13} className={s.faint} />
            <FolderMenu
              folder={shell.folder}
              onPick={(folder) => {
                const next = world.openShell(folder)
                world.show({ kind: 'shell', id: next.id })
              }}
            />
          </>
        )}
        <span className={s.gap} />
        {run !== undefined && !failed && <RunMoves run={run} />}
        {run !== undefined && !failed && pair === undefined && (
          <IconButton icon="terminal" label={text.terminalHere} size="small" onClick={() => openTerminal(run.folder, run.id)} />
        )}
        <IconButton
          icon={state.whole ? 'compress' : 'expand'}
          label={state.whole ? 'Back to the foot' : 'The whole screen'}
          size="small"
          onClick={() => world.setWhole(!state.whole)}
        />
        <IconButton icon="chevronD" label="Put away" kbd="Ctrl `" size="small" tooltipAlign="end" onClick={world.hide} />
      </div>
      <div className={s.calledBody}>
        <div className={cx(s.calledMain, pair !== undefined && s.split)}>
          {run !== undefined && <RunPane run={run} paired={pair !== undefined} onHelp={onHelp(run)} />}
          {run !== undefined && pair !== undefined && (
            <div className={cx(s.calledPane, s.besideRun)}>
              <div className={s.calledPaneHead}>
                <Icon name="terminal" size={12} className={s.faint} />
                <FolderMenu folder={pair.folder} onPick={(folder) => world.openShell(folder, run.id)} />
                <span className={s.gap} />
                <IconButton icon="close" label="Close this terminal" size="small" onClick={() => world.closeShell(pair.id)} />
              </div>
              <ShellView key={pair.id} shell={pair} />
            </div>
          )}
          {shell !== undefined && (
            <div className={s.calledPane}>
              <ShellView key={shell.id} shell={shell} />
            </div>
          )}
        </div>
        <nav className={s.calledList} aria-label="Runs and terminals">
          {state.runs.map((one) => {
            const beside = state.pairs[one.id]
            return (
              <span key={one.id} className={s.listGroup}>
                <Item at={{ kind: 'run', id: one.id }} chosen={same(focus, { kind: 'run', id: one.id })} />
                {beside !== undefined && <Item at={{ kind: 'shell', id: beside }} chosen={false} nested />}
              </span>
            )
          })}
          {loose.map((one) => (
            <Item key={one.id} at={{ kind: 'shell', id: one.id }} chosen={same(focus, { kind: 'shell', id: one.id })} />
          ))}
          <button type="button" className={cx(s.listPress, s.listNew)} onClick={() => openTerminal(run?.folder ?? shell?.folder)}>
            <Icon name="plus" size={12} />
            <span className={s.listName}>{text.newTerminal}</span>
          </button>
        </nav>
      </div>
    </section>
  )
}
