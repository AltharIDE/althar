import type { Launch } from '@althar/contracts'
import {
  Button,
  Icon,
  IconButton,
  Path,
  RunConsole,
  RunMark,
  type RunPhase,
  RunWords,
  StatusDrawer,
  type StatusItem,
  StatusLine,
} from '@althar/ui'
import { TerminalView } from '@althar/ui/terminal'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useServices } from '../../data/services'
import { useRunOutput } from '../../shared/RunOf'
import type { RunContent } from '../../shared/thread'
import { usePageOpener } from '../browser/opener'
import { type FootStore, type FootTerminal, footStoreOf } from './store'
import s from './Foot.module.css'

/*
 * The project's status line along the foot of its screen and its tasks'
 * (decisions: workspaces-and-runs, Terminals): there once the project runs
 * something or a terminal is open, so a screen where nothing runs is as it
 * was. A press raises the drawer on a run's output, with its ways (open,
 * stop, run again, help me fix it, a terminal where it ran), or on a
 * terminal. Ctrl+` opens a terminal, in the task's worktree on a task's
 * screen, else the project's repository, or raises the last one, or lowers
 * it; Ctrl+Shift+` always opens a new one, as in an editor.
 */

export const text = {
  label: 'Runs and terminals',
  drawer: 'Runs and terminals drawer',
  lower: 'Lower',
  open: (address: string) => `Open ${address}`,
  terminalHere: 'Open a terminal where it ran',
  help: 'Help me fix it',
  stop: 'Stop',
  again: 'Run again',
  newTerminal: 'New terminal',
  newTerminalHere: 'New terminal here',
}

/** The key that opens a terminal, as the window draws it. */
export const TERMINAL_KEY = 'Ctrl `'

/** How long a run that answers nowhere (an app's window) is taken as starting, then as running. */
const STARTING_FOR = 10_000

const phaseOf = (launch: Launch, now: number): RunPhase =>
  launch.ended !== null
    ? launch.ended.code === 0
      ? 'finished'
      : 'failed'
    : launch.url !== null || now - Date.parse(launch.startedAt) > STARTING_FOR
      ? 'up'
      : 'starting'

/** Each terminal by where it is, numbered where two are in the same place. */
export const terminalNames = (terminals: ReadonlyArray<Pick<FootTerminal, 'id' | 'where'>>): ReadonlyMap<string, string> => {
  const counted = new Map<string, number>()
  const names = new Map<string, string>()
  for (const one of terminals) {
    const n = (counted.get(one.where) ?? 0) + 1
    counted.set(one.where, n)
    names.set(one.id, n === 1 ? one.where : `${one.where} ${n}`)
  }
  return names
}

/** A run as its card says it, for Help me fix it. */
const fixOf = (launch: Launch): Pick<RunContent, 'name' | 'command' | 'ended'> => ({
  name: launch.label ?? null,
  command: launch.command,
  ended: launch.ended === null ? null : { at: launch.ended.at, code: launch.ended.code, stopped: false, last: null },
})

export interface FootProps {
  projectId: string
  /** The task whose screen it is: a new terminal opens in its worktree. */
  taskId: string | null
  /** Where a new terminal opens, in words: the task's title, or the project's repository. */
  where: string
  /** Puts a prompt about a failed run in the screen's composer, unsent. */
  onHelp: (run: Pick<RunContent, 'name' | 'command' | 'ended'>, output: () => Promise<string | undefined>) => void
  /** Runs it again where the screen keeps its card: whether it did; one it doesn't runs again from here, its card nowhere. */
  onRunAgain: (launch: Launch) => boolean
}

export function Foot({ projectId, taskId, where, onHelp, onRunAgain }: FootProps) {
  const { client, feed, host } = useServices()
  const store = footStoreOf(client, feed, host, projectId)
  const state = useSyncExternalStore(store.subscribe, store.get)
  const opener = usePageOpener()
  const now = useNow(state.launches.some((launch) => launch.ended === null && launch.url === null))
  const foot = useRef<HTMLDivElement>(null)
  const room = useRoom(foot, state.raised)

  // A link pressed in a terminal opens where this screen opens a run's. A hidden screen runs no effects: the one on show says.
  useEffect(() => {
    store.links = (url) => opener.run(url)
  }, [store, opener])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || (event.key !== '`' && event.code !== 'Backquote')) return
      event.preventDefault()
      toggleTerminal(store, { taskId, where }, event.shiftKey)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [store, taskId, where])

  const names = terminalNames(state.terminals)
  const items: ReadonlyArray<StatusItem> = [
    ...state.launches.map((launch): StatusItem => {
      const phase = phaseOf(launch, now)
      return {
        kind: 'run',
        id: launch.id,
        name: launch.label ?? launch.command,
        phase,
        ...(launch.url === null ? {} : { url: launch.url }),
        ...(phase === 'failed' ? { code: launch.ended?.code ?? null } : {}),
      }
    }),
    ...state.terminals.map((one): StatusItem => ({
      kind: 'terminal',
      id: one.id,
      name: names.get(one.id) ?? one.where,
      ...(one.busy ? { busy: one.title } : {}),
      ...(one.exited === null ? {} : { code: one.exited.code }),
    })),
  ]
  if (items.length === 0) return null
  const chosenId = state.raised ? state.chosen?.id : undefined
  const run = state.chosen?.kind === 'run' ? state.launches.find((one) => one.id === state.chosen?.id) : undefined
  const terminal = state.chosen?.kind === 'terminal' ? state.terminals.find((one) => one.id === state.chosen?.id) : undefined
  return (
    <div ref={foot} className={s.foot}>
      {state.raised && (run !== undefined || terminal !== undefined) && (
        <StatusDrawer
          label={text.drawer}
          height={state.height}
          max={room}
          onHeight={store.setHeight}
          onLower={store.lower}
          title={
            run !== undefined ? (
              <RunTitle launch={run} phase={phaseOf(run, now)} />
            ) : terminal !== undefined ? (
              <TerminalTitle terminal={terminal} name={names.get(terminal.id) ?? terminal.where} />
            ) : null
          }
          actions={
            <>
              {run !== undefined && (
                <RunActions
                  launch={run}
                  phase={phaseOf(run, now)}
                  store={store}
                  onOpen={(url) => opener.run(url)}
                  onHelp={() => {
                    // The drawer covers the composer: down first, then the prompt there.
                    store.lower()
                    onHelp(fixOf(run), () => client.readLaunchOutput(run.id).then((read) => read.text))
                  }}
                  onRunAgain={() => {
                    if (!onRunAgain(run))
                      void client.runProject(projectId, run.taskId, null, ...(run.runnableId == null ? [] : [run.runnableId]))
                  }}
                />
              )}
              {terminal !== undefined && (
                <IconButton
                  icon="plus"
                  size="small"
                  label={text.newTerminalHere}
                  tooltip="above"
                  onClick={() =>
                    store.openTerminal({
                      taskId: terminal.taskId,
                      ...(terminal.launchId === null ? {} : { launchId: terminal.launchId }),
                      where: terminal.where,
                    })
                  }
                />
              )}
              <IconButton
                icon="chevronD"
                size="small"
                label={text.lower}
                kbd="Esc"
                tooltip="above"
                tooltipAlign="end"
                onClick={store.lower}
              />
            </>
          }
        >
          {run !== undefined && <RunBody key={run.id} launch={run} />}
          {terminal !== undefined && (
            <TerminalView key={terminal.id} session={store.sessionOf(terminal.id)} autoFocus className={s.terminal} />
          )}
        </StatusDrawer>
      )}
      <StatusLine
        items={items}
        {...(chosenId === undefined ? {} : { chosen: chosenId })}
        onPress={(id) => store.press({ kind: state.launches.some((one) => one.id === id) ? 'run' : 'terminal', id })}
        onDismiss={(id) => store.dismiss({ kind: state.launches.some((one) => one.id === id) ? 'run' : 'terminal', id })}
        onNewTerminal={() => store.openTerminal({ taskId, where })}
        newTerminalKbd={TERMINAL_KEY}
      />
    </div>
  )
}

/**
 * Ctrl+`: a new terminal where there is none here; else the last one,
 * raised, or, raised already, lowered. With Shift, a new one always.
 */
export const toggleTerminal = (store: FootStore, at: { readonly taskId: string | null; readonly where: string }, fresh: boolean) => {
  const state = store.get()
  const last = state.terminals.at(-1)
  if (fresh || last === undefined) return void store.openTerminal(at)
  if (state.raised && state.chosen?.kind === 'terminal') return store.lower()
  store.show({ kind: 'terminal', id: last.id })
}

function RunTitle({ launch, phase }: { launch: Launch; phase: RunPhase }) {
  const item = {
    kind: 'run' as const,
    id: launch.id,
    name: launch.label ?? launch.command,
    phase,
    ...(launch.url === null ? {} : { url: launch.url }),
    ...(phase === 'failed' ? { code: launch.ended?.code ?? null } : {}),
  }
  return (
    <>
      <RunMark phase={phase} />
      <span className={s.name}>{item.name}</span>
      <span className={s.state}>
        <RunWords item={item} />
      </span>
      <span className={s.where} title={launch.where}>
        {launch.branch ?? launch.where}
      </span>
    </>
  )
}

function RunActions({
  launch,
  phase,
  store,
  onOpen,
  onHelp,
  onRunAgain,
}: {
  launch: Launch
  phase: RunPhase
  store: FootStore
  onOpen: (url: string) => void
  onHelp: () => void
  onRunAgain: () => void
}) {
  const url = launch.url
  return (
    <>
      {phase === 'up' && url !== null && (
        <IconButton
          icon="external"
          size="small"
          label={text.open(url.replace(/^https?:\/\//, ''))}
          tooltip="above"
          onClick={() => onOpen(url)}
        />
      )}
      <IconButton
        icon="terminal"
        size="small"
        label={text.terminalHere}
        tooltip="above"
        onClick={() => store.openTerminal({ taskId: launch.taskId, launchId: launch.id, where: launch.branch ?? launch.where })}
      />
      {phase === 'failed' && (
        <Button size="small" variant="quiet" icon="agents" onClick={onHelp}>
          {text.help}
        </Button>
      )}
      {launch.ended === null ? (
        <Button size="small" variant="quiet" onClick={() => store.dismiss({ kind: 'run', id: launch.id })}>
          {text.stop}
        </Button>
      ) : (
        // A branch's run fetches it afresh to run again, which its card in the thread does.
        launch.branch == null && (
          <Button size="small" onClick={onRunAgain}>
            {text.again}
          </Button>
        )
      )}
    </>
  )
}

function RunBody({ launch }: { launch: Launch }) {
  const running = launch.ended === null
  const output = useRunOutput(launch.id, true, running)
  return (
    <RunConsole
      command={launch.command}
      output={output}
      running={running}
      exit={launch.ended !== null && launch.ended.code !== 0 ? (launch.ended.code ?? undefined) : undefined}
      fill
      className={s.console}
    />
  )
}

function TerminalTitle({ terminal, name }: { terminal: FootTerminal; name: string }) {
  return (
    <>
      <Icon name="terminal" size={13} className={s.faint} />
      <span className={s.name}>{name}</span>
      {terminal.busy && <span className={s.state}>{terminal.title}</span>}
      {terminal.folder !== '' && (
        <span className={s.path} title={terminal.folder}>
          <Path path={terminal.folder} />
        </span>
      )}
    </>
  )
}

/** The time, every second while a run that answers nowhere may still be starting; else as it was last read. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const every = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(every)
  }, [ticking])
  return now
}

/** How tall the drawer may be: the screen it is in, less its header and the line. */
function useRoom(foot: React.RefObject<HTMLDivElement | null>, raised: boolean) {
  const [room, setRoom] = useState(600)
  useLayoutEffect(() => {
    const screen = foot.current?.parentElement
    if (!raised || screen === null || screen === undefined) return
    const measure = () => setRoom(Math.max(160, screen.clientHeight - 110))
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(screen)
    return () => seen.disconnect()
  }, [foot, raised])
  return room
}
