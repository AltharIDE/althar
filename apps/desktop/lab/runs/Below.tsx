import { Icon, IconButton } from '@althar/ui'

import {
  CloseOne,
  cx,
  FailedMoves,
  FolderMenu,
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
import { type Focus, phaseOf, type Run, type Shell, useWorld, world } from './world'
import s from './directions.module.css'

/*
 * B · Along the foot. A band along the window's foot, under the conversation
 * and the board alike, there only while something runs or ran, or a
 * terminal is open: each run with its mark and how it stands, each terminal
 * by its folder, New terminal at its end. Pressing one raises it over the
 * window's lower part, as an editor's panel; pressing it again lowers it. A
 * run raises it as it starts.
 *
 * Its pieces are the spin-offs' too (1–3): what the foot shows and which one
 * is chosen, its row of runs and terminals, its end, and what a raised one
 * shows.
 */

export const same = (one: Focus | null, other: Focus) => one !== null && one.kind === other.kind && one.id === other.id

export interface Foot {
  readonly runs: ReadonlyArray<Run>
  readonly shells: ReadonlyArray<Shell>
  /** The one chosen: the last one shown, else the first run, else the first terminal. */
  readonly focus: Focus
  readonly run: Run | undefined
  readonly shell: Shell | undefined
  readonly raised: boolean
  readonly failed: boolean
  /** A press on one: raises it, or lowers it where it is up already. */
  readonly press: (one: Focus) => void
}

/** What the foot shows, read again as the world changes; none while nothing runs, ran or is open. */
export function useFoot(): Foot | null {
  const state = useWorld()
  const shells = state.shells
  if (state.runs.length === 0 && shells.length === 0) return null
  const focus: Focus =
    state.focus ?? (state.runs[0] === undefined ? { kind: 'shell', id: shells[0]!.id } : { kind: 'run', id: state.runs[0].id })
  const run = focus.kind === 'run' ? world.run(focus.id) : undefined
  const shell = focus.kind === 'shell' ? world.shell(focus.id) : undefined
  const raised = state.open && (run !== undefined || shell !== undefined)
  return {
    runs: state.runs,
    shells,
    focus,
    run,
    shell,
    raised,
    failed: run !== undefined && phaseOf(run) === 'failed',
    press: (one) => (raised && same(state.focus, one) ? world.hide() : world.show(one)),
  }
}

/** Its runs and terminals in a row, as tabs: each run with its mark and, where it says something, how it stands. */
export function FootTabs({ foot, className }: { foot: Foot; className?: string }) {
  const chosen = (at: Focus) => foot.raised && same(foot.focus, at)
  return (
    <div className={cx(s.trayTabs, className)} role="tablist" aria-label="Runs and terminals">
      {foot.runs.map((one) => {
        const at = { kind: 'run' as const, id: one.id }
        const phase = phaseOf(one)
        return (
          <span key={one.id} className={cx(s.trayTab, chosen(at) && s.chosen)}>
            <button type="button" role="tab" aria-selected={chosen(at)} className={s.trayPress} onClick={() => foot.press(at)}>
              <RunMark run={one} />
              <span className={s.trayName}>{one.name}</span>
              {(phase === 'failed' || phase === 'starting' || one.url !== null) && (
                <span className={cx(s.trayState, phase === 'running' && s.trayAddress)}>
                  <RunState run={one} short inPress />
                </span>
              )}
            </button>
            {one.ended !== null && <CloseOne label={`Clear ${one.name}`} onClose={() => world.clear(one.id)} />}
          </span>
        )
      })}
      {foot.shells.map((one) => {
        const at = { kind: 'shell' as const, id: one.id }
        return (
          <span key={one.id} className={cx(s.trayTab, chosen(at) && s.chosen)}>
            <button type="button" role="tab" aria-selected={chosen(at)} className={s.trayPress} onClick={() => foot.press(at)}>
              <Icon name="terminal" size={13} className={s.faint} />
              <span className={cx(s.trayName, shellNamedByFolder(one) && s.mono)}>{shellName(one, foot.shells)}</span>
            </button>
            <CloseOne label="Close this terminal" onClose={() => world.closeShell(one.id)} />
          </span>
        )
      })}
    </div>
  )
}

/** Its end: the chosen run's ways or the terminal's folder (unless its head says it already), New terminal, and Raise or Lower. */
export function FootEnd({ foot, lower = 'toggle', folder = true }: { foot: Foot; lower?: 'toggle' | 'close'; folder?: boolean }) {
  const { raised, run, shell, failed } = foot
  return (
    <span className={s.trayEnd}>
      {raised && run !== undefined && !failed && (
        <>
          <RunMoves run={run} />
          <IconButton icon="terminal" label={text.terminalHere} size="small" onClick={() => openTerminal(run.folder)} />
        </>
      )}
      {raised && shell !== undefined && folder && (
        <FolderMenu
          folder={shell.folder}
          onPick={(folder) => {
            const next = world.openShell(folder)
            world.show({ kind: 'shell', id: next.id })
          }}
        />
      )}
      <IconButton
        icon="plus"
        label={text.newTerminal}
        kbd="Ctrl `"
        size="small"
        onClick={() => openTerminal(run?.folder ?? shell?.folder)}
      />
      {lower === 'close' ? (
        <IconButton icon="chevronD" label="Lower" kbd="esc" size="small" tooltipAlign="end" onClick={world.hide} />
      ) : (
        <IconButton
          icon={raised ? 'chevronD' : 'chevronU'}
          label={raised ? 'Lower' : 'Raise'}
          size="small"
          tooltipAlign="end"
          onClick={() => (raised ? world.hide() : world.show(foot.focus))}
        />
      )}
    </span>
  )
}

/** The chosen one, as a raised one's head names it: a run by its mark, name and state; a terminal by its folder, to change. */
export function FootTitle({ foot }: { foot: Foot }) {
  const { run, shell } = foot
  return (
    <span className={s.footTitle}>
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
    </span>
  )
}

/** What a raised one shows: a run's output, ending in a failed one's ways out, or the terminal, headed by its folder where the band has no room for it. */
export function FootBody({ foot, onHelp, folderHead = false }: { foot: Foot; onHelp?: (run: Run) => void; folderHead?: boolean }) {
  const { run, shell, failed } = foot
  return (
    <div className={s.trayBody}>
      {run !== undefined && <RunOutput run={run} />}
      {run !== undefined && failed && (
        <FailedMoves
          run={run}
          onTerminal={() => openTerminal(run.folder)}
          {...(onHelp === undefined ? {} : { onHelp: () => onHelp(run) })}
        />
      )}
      {shell !== undefined && folderHead && (
        <div className={s.bodyHead}>
          <FolderMenu
            folder={shell.folder}
            onPick={(folder) => {
              const next = world.openShell(folder)
              world.show({ kind: 'shell', id: next.id })
            }}
          />
        </div>
      )}
      {shell !== undefined && <ShellView key={shell.id} shell={shell} />}
    </div>
  )
}

export function Tray() {
  const { d } = useLab()
  const foot = useFoot()
  if (d !== 'b' || foot === null) return null
  return (
    <section className={cx(s.tray, foot.raised && s.raised)} aria-label="Runs and terminals">
      <div className={s.band}>
        <FootTabs foot={foot} />
        <FootEnd foot={foot} />
      </div>
      {foot.raised && <FootBody foot={foot} />}
    </section>
  )
}
