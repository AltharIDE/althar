import { IconButton, Icon, Menu, MenuItem, MenuSeparator, SidePanel } from '@althar/ui'

import { cx, FailedMoves, FolderMenu, RunMark, RunMoves, RunOutput, RunState, shellName, ShellView, text } from './parts'
import { openTerminal } from './terminal'
import { phaseOf, useWorld, world } from './world'
import s from './directions.module.css'

/*
 * A · Beside. A run opens on the conversation's workbench as it starts,
 * where a file or the run's page opens (over the board, beside it): its
 * name and state, then what it prints, following its end. A failed one ends
 * in its ways out. A terminal opens there too, in a folder of the project;
 * the name at the head is a menu of every run and terminal, as the
 * conversation's bar is of the asides. Closed, they go on; Run says so.
 */

export function BesidePanel() {
  const state = useWorld()
  const focus = state.focus
  const run = focus?.kind === 'run' ? world.run(focus.id) : undefined
  const shell = focus?.kind === 'shell' ? world.shell(focus.id) : undefined
  const shells = state.shells.filter((one) => !one.inThread)
  const failed = run !== undefined && phaseOf(run) === 'failed'
  return (
    <SidePanel
      label={text.terminal}
      className={s.besidePanel}
      onClose={world.hide}
      head={
        <span className={s.besideHead}>
          <Menu
            label="Runs and terminals"
            width={320}
            trigger={
              <button type="button" className={s.switcher}>
                {run !== undefined ? <RunMark run={run} /> : <Icon name="terminal" size={13} className={s.faint} />}
                <span className={s.switcherName}>{run?.name ?? text.terminal}</span>
                <Icon name="chevronD" size={11} className={s.faint} />
              </button>
            }
          >
            {state.runs.map((one) => (
              <MenuItem
                key={one.id}
                lead={<RunMark run={one} />}
                hint={<RunState run={one} short />}
                onSelect={() => world.show({ kind: 'run', id: one.id })}
              >
                {one.name}
              </MenuItem>
            ))}
            {state.runs.length > 0 && <MenuSeparator />}
            {shells.map((one) => (
              <MenuItem
                key={one.id}
                icon="terminal"
                hint={<code>{one.folder.branch}</code>}
                onSelect={() => world.show({ kind: 'shell', id: one.id })}
              >
                {shellName(one, shells)}
              </MenuItem>
            ))}
            <MenuItem icon="plus" kbd="Ctrl `" onSelect={() => openTerminal(run?.folder ?? shell?.folder)}>
              {text.newTerminal}
            </MenuItem>
            {shell !== undefined && (
              <MenuItem icon="close" tone="danger" quiet onSelect={() => world.closeShell(shell.id)}>
                Close this terminal
              </MenuItem>
            )}
          </Menu>
          {run !== undefined && (
            <span className={s.headState}>
              <RunState run={run} />
            </span>
          )}
          {shell !== undefined && (
            <FolderMenu
              folder={shell.folder}
              onPick={(folder) => {
                const next = world.openShell(folder)
                world.show({ kind: 'shell', id: next.id })
              }}
            />
          )}
        </span>
      }
      actions={
        run !== undefined ? (
          <>
            {!failed && <RunMoves run={run} />}
            {!failed && (
              <IconButton icon="terminal" label={text.terminalHere} size="small" tooltip="below" onClick={() => openTerminal(run.folder)} />
            )}
          </>
        ) : null
      }
    >
      <div className={cx(s.besideBody)}>
        {run !== undefined && <RunOutput run={run} />}
        {run !== undefined && failed && <FailedMoves run={run} onTerminal={() => openTerminal(run.folder)} />}
        {shell !== undefined && <ShellView key={shell.id} shell={shell} />}
      </div>
    </SidePanel>
  )
}
