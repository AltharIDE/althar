import type { Launch, ShownTerminal, WatchEvent } from '@althar/contracts'
import { TerminalSession } from '@althar/ui/terminal'

import { type Client, messageOf } from '../../data/client'
import type { Host } from '../../data/services'

/*
 * What a project's status line holds (decisions: workspaces-and-runs,
 * Terminals): the project's runs, its tasks' too, and its terminals, as the
 * runtime says them, with what the person did in this window shown at once
 * before the runtime answers: a terminal opened is there and takes keys in
 * the frame it is asked for, its shell started behind it at the size it was
 * drawn; one closed, or a run dismissed, is gone, and back with a line where
 * the runtime said no. Each terminal's session is the window's while the
 * terminal is open, so it is the same on the project's screen and its
 * tasks', and after a project's tab is left and come back to. Whether the
 * drawer is up, what it shows and how tall it is are the window's too.
 */

export type Choice = { readonly kind: 'run' | 'terminal'; readonly id: string }

export interface FootTerminal extends ShownTerminal {
  /** Opened in this window, its shell not started yet. */
  readonly opening: boolean
  /** Why its shell couldn't start, in words. */
  readonly failed?: string
}

export interface FootState {
  /** The project's runs, its tasks' too, but those dismissed here. */
  readonly launches: ReadonlyArray<Launch>
  readonly terminals: ReadonlyArray<FootTerminal>
  readonly raised: boolean
  readonly chosen: Choice | null
  readonly height: number
  /** A run or terminal that couldn't be closed, in words. */
  readonly problem: string | null
}

/** How tall the drawer is first, and the key its height is kept under in this window. */
export const HEIGHT = 340
const HEIGHT_KEY = 'althar:foot-height'

const keptHeight = () => {
  const kept = Number(globalThis.localStorage?.getItem(HEIGHT_KEY))
  return Number.isFinite(kept) && kept >= 160 ? kept : HEIGHT
}

/** How long a terminal the runtime answered for stands, though a list it said before it opened leaves it out. */
const ANSWERED_FOR = 3_000

/** A new terminal's id, the window's own, so it shows before the runtime has it. */
export const newTerminalId = (): string => `term_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`

/** The windows each terminal is drawn in, its writes in order, one at a time, and its sizes, once its shell has started. */
interface Attached {
  readonly session: TerminalSession
  ready: boolean
  waiting: string
  writing: boolean
  stop: () => void
}

export interface FootStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => FootState
  /** Raises the drawer on it, or, chosen already and up, lowers it. */
  readonly press: (choice: Choice) => void
  readonly show: (choice: Choice) => void
  readonly lower: () => void
  readonly setHeight: (height: number) => void
  /** Opens a terminal at once, shown in the drawer: in the run's folder, else the task's worktree, else the project's repository. */
  readonly openTerminal: (input: { readonly taskId: string | null; readonly launchId?: string; readonly where: string }) => string
  /** Closes it: a terminal and what runs in it; a run stopped, or one that ended cleared. */
  readonly dismiss: (choice: Choice) => void
  /** A terminal's session, made as it is first shown. */
  readonly sessionOf: (id: string) => TerminalSession
  /** Where a link pressed in a terminal opens: the screen on show says. */
  links: ((url: string) => void) | undefined
  readonly dismissProblem: () => void
}

const stores = new WeakMap<Client, Map<string, FootStore>>()

/** The project's store, one for the window's connection, started as it is first asked for. */
export const footStoreOf = (
  client: Client,
  feed: { listen: (listener: (event: WatchEvent) => void) => () => void },
  host: Host,
  projectId: string,
) => {
  let projects = stores.get(client)
  if (projects === undefined) {
    projects = new Map()
    stores.set(client, projects)
  }
  const there = projects.get(projectId)
  if (there !== undefined) return there
  const made = makeFootStore(client, feed, host, projectId)
  projects.set(projectId, made)
  return made
}

export const makeFootStore = (
  client: Client,
  feed: { listen: (listener: (event: WatchEvent) => void) => () => void },
  host: Pick<Host, 'paste' | 'pathOfFile'>,
  projectId: string,
): FootStore => {
  let state: FootState = { launches: [], terminals: [], raised: false, chosen: null, height: keptHeight(), problem: null }
  const listeners = new Set<() => void>()
  const set = (next: Partial<FootState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  // As the runtime says them, and what this window did before it said so.
  let launches: ReadonlyArray<Launch> = []
  let terminals: ReadonlyArray<ShownTerminal> = []
  const opening = new Map<string, FootTerminal>()
  /** Opened here and answered, by when: a list the runtime said before it opened, heard after, doesn't drop it. */
  const answered = new Map<string, { readonly at: number; readonly shown: ShownTerminal }>()
  const gone = new Set<string>()
  const attached = new Map<string, Attached>()

  const shownLaunches = () => launches.filter((launch) => !gone.has(launch.id))
  const shownTerminals = (): ReadonlyArray<FootTerminal> => {
    const known = new Set(terminals.map((one) => one.id))
    return [
      ...terminals.filter((one) => !gone.has(one.id)).map((one) => ({ ...one, opening: false })),
      ...[...opening.values()].filter((one) => !known.has(one.id) && !gone.has(one.id)),
    ]
  }
  /** What is chosen, while it is there; where it went, the next one along, else the drawer lowers. */
  const settle = () => {
    const next = { launches: shownLaunches(), terminals: shownTerminals() }
    const chosen = state.chosen
    const there =
      chosen === null ||
      (chosen.kind === 'run' ? next.launches.some((one) => one.id === chosen.id) : next.terminals.some((one) => one.id === chosen.id))
    if (there) return set(next)
    const along: Choice | null =
      next.terminals.at(-1) !== undefined
        ? { kind: 'terminal', id: next.terminals.at(-1)!.id }
        : next.launches.at(-1) !== undefined
          ? { kind: 'run', id: next.launches.at(-1)!.id }
          : null
    set({ ...next, chosen: along, raised: state.raised && along !== null })
  }

  const forget = (id: string) => {
    const one = attached.get(id)
    attached.delete(id)
    opening.delete(id)
    one?.stop()
    one?.session.dispose()
  }

  const pump = (id: string) => {
    const one = attached.get(id)
    if (one === undefined || !one.ready || one.writing || one.waiting === '') return
    const data = one.waiting
    one.waiting = ''
    one.writing = true
    void client
      .writeTerminal(id, data)
      .catch(() => {})
      .finally(() => {
        one.writing = false
        pump(id)
      })
  }

  /** Its output, from what it printed so far, drawn as it comes. */
  const listen = (id: string, one: Attached) => {
    one.stop = client.attachTerminal(
      id,
      (chunk) => {
        if (chunk._tag === 'Data') one.session.write(chunk.data)
        else one.session.write(`\r\n\x1b[2m[exited ${chunk.code}]\x1b[0m\r\n`)
      },
      () => {},
    )
  }

  const sessionOf = (id: string): TerminalSession => {
    const there = attached.get(id)
    if (there !== undefined) return there.session
    const session = new TerminalSession({
      onData: (data) => {
        const one = attached.get(id)
        if (one === undefined) return
        one.waiting += data
        pump(id)
      },
      onResize: (cols, rows) => {
        if (attached.get(id)?.ready === true) void client.resizeTerminal(id, cols, rows).catch(() => {})
      },
      onLink: (url) => store.links?.(url),
      ...(host.paste === undefined ? {} : { onPaste: host.paste }),
      ...(host.pathOfFile === undefined ? {} : { pathOf: host.pathOfFile }),
    })
    const one: Attached = { session, ready: !opening.has(id), waiting: '', writing: false, stop: () => {} }
    attached.set(id, one)
    // One the runtime has already: what it printed, then on as it prints.
    if (one.ready) listen(id, one)
    return session
  }

  // What the runtime said as it changed is newer than a first read that lands after it.
  const heard = { launches: false, terminals: false }
  const refresh = (event: WatchEvent) => {
    if (event._tag === 'Launches' && event.projectId === projectId) {
      heard.launches = true
      launches = event.launches
      settle()
    } else if (event._tag === 'Terminals' && event.projectId === projectId) {
      heard.terminals = true
      const listed = new Set(event.terminals.map((one) => one.id))
      const now = Date.now()
      for (const [id, { at }] of answered) if (listed.has(id) || now - at > ANSWERED_FOR) answered.delete(id)
      terminals = [...event.terminals, ...[...answered.values()].map((one) => one.shown)]
      const open = new Set(terminals.map((one) => one.id))
      // Gone in the runtime, as a shell ends well: gone here too, but one still opening.
      for (const id of [...attached.keys()]) if (!open.has(id) && !opening.has(id)) forget(id)
      for (const id of gone) if (!open.has(id) && !opening.has(id)) gone.delete(id)
      settle()
    }
  }
  feed.listen(refresh)
  void client.listLaunches(projectId).then(
    (read) => {
      if (heard.launches) return
      launches = read
      settle()
    },
    () => {},
  )
  void client.listTerminals(projectId).then(
    (read) => {
      if (heard.terminals) return
      terminals = [...read, ...[...answered.values()].map((one) => one.shown).filter((one) => !read.some((known) => known.id === one.id))]
      settle()
    },
    () => {},
  )

  const store: FootStore = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: () => state,
    press: (choice) => {
      const same = state.chosen?.kind === choice.kind && state.chosen.id === choice.id
      set(same && state.raised ? { raised: false } : { raised: true, chosen: choice })
    },
    show: (choice) => set({ raised: true, chosen: choice }),
    lower: () => set({ raised: false }),
    setHeight: (height) => {
      globalThis.localStorage?.setItem(HEIGHT_KEY, String(Math.round(height)))
      set({ height })
    },
    openTerminal: ({ taskId, launchId, where }) => {
      const id = newTerminalId()
      opening.set(id, {
        id,
        projectId,
        taskId,
        launchId: launchId ?? null,
        folder: '',
        where,
        title: '',
        busy: false,
        startedAt: new Date().toISOString(),
        exited: null,
        opening: true,
      })
      const session = sessionOf(id)
      set({ terminals: shownTerminals(), raised: true, chosen: { kind: 'terminal', id } })
      // Its shell starts at the size it was drawn at, or a terminal's usual where it isn't drawn soon.
      const drawn = Promise.race([session.drawn, new Promise<void>((resolve) => setTimeout(resolve, 400))])
      void drawn.then(async () => {
        try {
          const shown = await client.openTerminal({
            id,
            projectId,
            taskId,
            ...(launchId === undefined ? {} : { launchId }),
            cols: Math.max(2, session.cols),
            rows: Math.max(2, session.rows),
          })
          const one = attached.get(id)
          if (one === undefined) return void client.closeTerminal(id).catch(() => {})
          one.ready = true
          opening.delete(id)
          if (!terminals.some((known) => known.id === id)) {
            terminals = [...terminals, shown]
            answered.set(id, { at: Date.now(), shown })
          }
          listen(id, one)
          if (session.cols !== 0) void client.resizeTerminal(id, session.cols, session.rows).catch(() => {})
          pump(id)
          settle()
        } catch (failure) {
          const said = messageOf(failure)
          const was = opening.get(id)
          if (was !== undefined) opening.set(id, { ...was, failed: said, exited: { code: 1 } })
          session.write(`\x1b[31m${said}\x1b[0m\r\n`)
          settle()
        }
      })
      return id
    },
    dismiss: (choice) => {
      gone.add(choice.id)
      if (choice.kind === 'terminal') {
        const failedHere = opening.get(choice.id)?.failed !== undefined
        forget(choice.id)
        settle()
        if (!failedHere) void client.closeTerminal(choice.id).catch(() => {})
        return
      }
      const run = launches.find((one) => one.id === choice.id)
      settle()
      const closing = run?.ended === null ? client.stopLaunch(choice.id) : client.clearLaunch(choice.id)
      closing.catch((failure: unknown) => {
        gone.delete(choice.id)
        set({ problem: messageOf(failure) })
        settle()
      })
    },
    sessionOf,
    links: undefined,
    dismissProblem: () => set({ problem: null }),
  }
  return store
}
