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
import { type Focus, phaseOf, useWorld, world } from './world'
import s from './directions.module.css'

/*
 * B · Along the foot. A band along the window's foot, under the conversation
 * and the board alike, there only while something runs or ran, or a
 * terminal is open: each run with its mark and how it stands, each terminal
 * by its folder, New terminal at its end. Pressing one raises it over the
 * window's lower part, as an editor's panel; pressing it again lowers it. A
 * run raises it as it starts.
 */

const same = (one: Focus | null, other: Focus) => one !== null && one.kind === other.kind && one.id === other.id

export function Tray() {
  const { d } = useLab()
  const state = useWorld()
  const shells = state.shells.filter((one) => !one.inThread)
  if (d !== 'b' || (state.runs.length === 0 && shells.length === 0)) return null
  const focus =
    state.focus ??
    (state.runs[0] === undefined ? { kind: 'shell' as const, id: shells[0]!.id } : { kind: 'run' as const, id: state.runs[0].id })
  const run = focus.kind === 'run' ? world.run(focus.id) : undefined
  const shell = focus.kind === 'shell' ? world.shell(focus.id) : undefined
  const raised = state.open && (run !== undefined || shell !== undefined)
  const press = (one: Focus) => (raised && same(state.focus, one) ? world.hide() : world.show(one))
  const failed = run !== undefined && phaseOf(run) === 'failed'
  return (
    <section className={cx(s.tray, raised && s.raised)} aria-label="Runs and terminals">
      <div className={s.band}>
        <div className={s.trayTabs} role="tablist" aria-label="Runs and terminals">
          {state.runs.map((one) => {
            const at = { kind: 'run' as const, id: one.id }
            const phase = phaseOf(one)
            return (
              <span key={one.id} className={cx(s.trayTab, raised && same(state.focus, at) && s.chosen)}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={raised && same(state.focus, at)}
                  className={s.trayPress}
                  onClick={() => press(at)}
                >
                  <RunMark run={one} />
                  <span className={s.trayName}>{one.name}</span>
                  {(phase === 'failed' || phase === 'starting' || one.url !== null) && (
                    <span className={s.trayState}>
                      <RunState run={one} short />
                    </span>
                  )}
                </button>
                {one.ended !== null && <CloseOne label={`Clear ${one.name}`} onClose={() => world.clear(one.id)} />}
              </span>
            )
          })}
          {shells.map((one) => {
            const at = { kind: 'shell' as const, id: one.id }
            return (
              <span key={one.id} className={cx(s.trayTab, raised && same(state.focus, at) && s.chosen)}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={raised && same(state.focus, at)}
                  className={s.trayPress}
                  onClick={() => press(at)}
                >
                  <Icon name="terminal" size={13} className={s.faint} />
                  <span className={cx(s.trayName, shellNamedByFolder(one) && s.mono)}>{shellName(one, shells)}</span>
                </button>
                <CloseOne label="Close this terminal" onClose={() => world.closeShell(one.id)} />
              </span>
            )
          })}
        </div>
        <span className={s.trayEnd}>
          {raised && run !== undefined && !failed && (
            <>
              <RunMoves run={run} />
              <IconButton icon="terminal" label={text.terminalHere} size="small" onClick={() => openTerminal(run.folder)} />
            </>
          )}
          {raised && shell !== undefined && (
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
          <IconButton
            icon={raised ? 'chevronD' : 'chevronU'}
            label={raised ? 'Lower' : 'Raise'}
            size="small"
            tooltipAlign="end"
            onClick={() => (raised ? world.hide() : world.show(focus))}
          />
        </span>
      </div>
      {raised && (
        <div className={s.trayBody}>
          {run !== undefined && <RunOutput run={run} />}
          {run !== undefined && failed && <FailedMoves run={run} onTerminal={() => openTerminal(run.folder)} />}
          {shell !== undefined && <ShellView key={shell.id} shell={shell} />}
        </div>
      )}
    </section>
  )
}
