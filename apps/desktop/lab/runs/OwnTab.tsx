import { useEffect, useState } from 'react'

import { Button, Icon, IconButton, ProjectTabs as KitProjectTabs, type ProjectTabsProps } from '@althar/ui'

import {
  CloseOne,
  cx,
  FailedMoves,
  FolderMenu,
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
 * D · A tab of its own. The project's runs and terminals live in a tab of
 * their own after the projects', as a page docked there does: the window's,
 * as big as it is, and nowhere else. It shows in the tabs once something
 * runs or a terminal is opened, with how its runs stand on its mark; a run's
 * console, Run's Open a terminal and Ctrl+` take the window there. Each run
 * or terminal is one of the tab's own, and a terminal opened from a run
 * opens beside it, so its output and the fix are side by side.
 */

const TAB = 'lab-terminal'

/** The window's tabs, with the terminal's after the projects' (and the pages'), in D. */
export function ProjectTabs(props: ProjectTabsProps) {
  const { d } = useLab()
  const state = useWorld()
  if (d !== 'd' || !state.tab.shown) return <KitProjectTabs {...props} />
  const away = () => world.tabTo(false)
  const failed = state.runs.some((one) => phaseOf(one) === 'failed')
  return (
    <KitProjectTabs
      {...props}
      pages={[
        ...(props.pages ?? []).map((page) => ({ ...page, onSelect: () => (away(), page.onSelect()) })),
        {
          id: TAB,
          title: failed ? 'Terminal · 1 failed' : 'Terminal · althar',
          icon: 'terminal',
          current: state.tab.current,
          onSelect: () => world.tabTo(true),
          onClose: world.closeTab,
        },
      ]}
      current={state.tab.current ? (null as never) : props.current}
      onSelect={(id) => (away(), props.onSelect(id))}
      {...(props.onOpenHome === undefined ? {} : { onOpenHome: () => (away(), props.onOpenHome?.()) })}
    />
  )
}

const same = (one: Focus | null, other: Focus) => one !== null && one.kind === other.kind && one.id === other.id

/** A run's pane: its head with how it stands and its ways, and what it printed; a failed one ends in its ways out. */
function RunPane({ run, paired }: { run: Run; paired: boolean }) {
  const failed = phaseOf(run) === 'failed'
  return (
    <section className={s.pane} aria-label={run.name}>
      <div className={s.paneHead}>
        <RunMark run={run} />
        <span className={s.paneName}>{run.name}</span>
        <span className={s.headState}>
          <RunState run={run} />
        </span>
        <span className={s.gap} />
        {!failed && <RunMoves run={run} />}
        {!failed && !paired && (
          <IconButton icon="terminal" label={text.terminalHere} size="small" onClick={() => openTerminal(run.folder, run.id)} />
        )}
      </div>
      <RunOutput run={run} />
      {failed && (
        <FailedMoves
          run={run}
          {...(paired ? {} : { onTerminal: () => openTerminal(run.folder, run.id) })}
          // Help me fix it says it in the project's conversation: the window goes back there, to its composer.
          onHelp={() => {
            world.tabTo(false)
            setTimeout(() => helpMeFix(run), 60)
          }}
          className={s.paneMoves}
        />
      )}
    </section>
  )
}

/** The terminal's tab, over the window under its tabs: what is open there in a row, and the one chosen, whole. */
export function TabScreen() {
  const { d } = useLab()
  const state = useWorld()
  const [top, setTop] = useState(0)
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('[data-lab-window] header[data-drag]')
    if (bar === null) return
    const measure = () => setTop(bar.getBoundingClientRect().height)
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(bar)
    return () => seen.disconnect()
  }, [d, state.tab.current])
  if (d !== 'd' || !state.tab.current) return null
  const shells = state.shells
  const paired = new Set(Object.values(state.pairs))
  const loose = shells.filter((one) => !paired.has(one.id))
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
  return (
    <div className={s.screen} style={{ top }}>
      <div className={s.screenHead} role="tablist" aria-label="Runs and terminals">
        {state.runs.map((one) => {
          const at = { kind: 'run' as const, id: one.id }
          return (
            <span key={one.id} className={cx(s.screenTab, same(focus, at) && s.chosen)}>
              <button type="button" role="tab" aria-selected={same(focus, at)} className={s.trayPress} onClick={() => world.show(at)}>
                <RunMark run={one} />
                <span className={s.trayName}>{one.name}</span>
              </button>
              {one.ended !== null && <CloseOne label={`Clear ${one.name}`} onClose={() => world.clear(one.id)} />}
            </span>
          )
        })}
        {loose.map((one) => {
          const at = { kind: 'shell' as const, id: one.id }
          return (
            <span key={one.id} className={cx(s.screenTab, same(focus, at) && s.chosen)}>
              <button type="button" role="tab" aria-selected={same(focus, at)} className={s.trayPress} onClick={() => world.show(at)}>
                <Icon name="terminal" size={13} className={s.faint} />
                <span className={cx(s.trayName, shellNamedByFolder(one) && s.mono)}>{shellName(one, shells)}</span>
              </button>
              <CloseOne label="Close this terminal" onClose={() => world.closeShell(one.id)} />
            </span>
          )
        })}
        <IconButton
          icon="plus"
          label={text.newTerminal}
          kbd="Ctrl `"
          size="small"
          onClick={() => openTerminal(run?.folder ?? shell?.folder)}
        />
      </div>
      <div className={cx(s.screenBody, pair !== undefined && s.split)}>
        {run !== undefined && <RunPane run={run} paired={pair !== undefined} />}
        {run !== undefined && pair !== undefined && (
          <section className={s.pane} aria-label={text.terminal}>
            <div className={s.paneHead}>
              <Icon name="terminal" size={13} className={s.faint} />
              <FolderMenu folder={pair.folder} onPick={(folder) => world.openShell(folder, run.id)} />
              <span className={s.gap} />
              <IconButton icon="close" label="Close this terminal" size="small" onClick={() => world.closeShell(pair.id)} />
            </div>
            <ShellView key={pair.id} shell={pair} />
          </section>
        )}
        {shell !== undefined && (
          <section className={s.pane} aria-label={text.terminal}>
            <div className={s.paneHead}>
              <Icon name="terminal" size={13} className={s.faint} />
              <FolderMenu
                folder={shell.folder}
                onPick={(folder) => {
                  const next = world.openShell(folder)
                  world.show({ kind: 'shell', id: next.id })
                }}
              />
            </div>
            <ShellView key={shell.id} shell={shell} />
          </section>
        )}
        {run === undefined && shell === undefined && (
          <div className={s.screenEmpty}>
            <Icon name="terminal" size={20} className={s.faint} />
            <p>What althar runs, and the terminals you open, show here.</p>
            <Button size="small" icon="terminal" onClick={() => openTerminal()}>
              {text.newTerminal}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
