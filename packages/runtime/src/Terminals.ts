import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

import { Clock, Context, Effect, Layer, Queue, Schedule, Stream } from 'effect'

import { NotFound } from './errors'
import { Launches } from './Launches'
import { Live } from './Live'

/*
 * The person's own terminals ([decisions](../../../docs/decisions/workspaces-and-runs.md#terminals)): a shell in a pseudo-terminal, as an
 * editor's terminal is, in the folder a run ran in, a task's worktree or the
 * project's repository. Althar owns the process and nothing reads it: what it
 * prints goes to the window that attached, as it comes, in pieces gathered a
 * few milliseconds at a time, and the end of it is kept so a window that
 * attaches again (a reload, another project and back) shows it as it was. A
 * window that can't keep up holds the shell (the pty is paused), as an
 * editor's does, rather than Althar keeping all it printed. What runs in
 * front of the shell is read every second, for its name and to say that
 * closing it stops something. None outlives Althar: each is stopped as the
 * runtime stops, and a shell that ends well is gone, as it is in an editor.
 */

/** A terminal as a client shows it. */
export interface ShownTerminal {
  readonly id: string
  readonly projectId: string
  readonly taskId: string | null
  readonly launchId: string | null
  readonly folder: string
  /** Where it is, in words: the run's, the task's title, or the repository's name. */
  readonly where: string
  readonly title: string
  readonly busy: boolean
  readonly startedAt: string
  readonly exited: { readonly code: number } | null
}

export type TerminalChunk = { readonly _tag: 'Data'; readonly data: string } | { readonly _tag: 'Exit'; readonly code: number }

/** A pseudo-terminal's process, as node-pty gives it: what the service uses of it. */
export interface Pty {
  readonly pid: number
  /** What runs in front of the shell, by name: the shell's own where nothing else does. */
  readonly process: string
  onData(listener: (data: string) => void): unknown
  onExit(listener: (exit: { readonly exitCode: number; readonly signal?: number | undefined }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  kill(signal?: string): void
}

export interface PtyOptions {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly env: Record<string, string>
}

/** Starts a shell in a pseudo-terminal: node-pty's, or a test's own. */
export class PtySpawner extends Context.Service<
  PtySpawner,
  { readonly spawn: (file: string, args: ReadonlyArray<string>, options: PtyOptions) => Pty }
>()('@althar/runtime/PtySpawner') {
  static readonly node: Layer.Layer<PtySpawner> = Layer.sync(PtySpawner, () => PtySpawner.of({ spawn: nodeSpawn }))
}

interface NodePty {
  readonly spawn: (
    file: string,
    args: ReadonlyArray<string>,
    options: PtyOptions & { readonly name: string; readonly encoding: 'utf8' | null; readonly useConpty?: boolean },
  ) => Pty
}

let loaded: NodePty | undefined
/**
 * node-pty, loaded as a terminal first opens, not as Althar starts. Its
 * helper that starts the shell on macOS comes from the registry without
 * leave to run (node-pty 1.1.0's own packaging), so it is given that first;
 * the packaged app's has it already.
 */
const nodePty = (): NodePty => {
  if (loaded !== undefined) return loaded
  const require = createRequire(import.meta.url)
  const folder = dirname(require.resolve('node-pty/package.json'))
  if (process.platform !== 'win32')
    for (const at of [join(folder, 'prebuilds', `${process.platform}-${process.arch}`), join(folder, 'build', 'Release')]) {
      const helper = join(at, 'spawn-helper')
      try {
        const mode = statSync(helper).mode
        if ((mode & 0o111) === 0) chmodSync(helper, mode | 0o755)
      } catch {
        // Not here, or not ours to change: node-pty says so as the shell starts.
      }
    }
  loaded = require('node-pty') as NodePty
  return loaded
}

const nodeSpawn = (file: string, args: ReadonlyArray<string>, options: PtyOptions): Pty =>
  nodePty().spawn(file, args, { ...options, name: 'xterm-256color', encoding: 'utf8' })

/** The person's shell, as their system starts it: a login shell, so it has their PATH, as an editor's terminal does. */
export const shellOf = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): { readonly file: string; readonly args: ReadonlyArray<string> } => {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
  const own = env.SHELL
  if (own !== undefined && own !== '' && exists(own)) return { file: own, args: ['-l'] }
  return { file: platform === 'darwin' ? '/bin/zsh' : exists('/bin/bash') ? '/bin/bash' : '/bin/sh', args: ['-l'] }
}

/** What Althar's own processes are told that a shell of the person's shouldn't be. */
const OWN = /^(ELECTRON_|ALTHAR_|VSCODE_|CHROME_)|^(NODE_OPTIONS|NODE_CHANNEL_FD|ORIGINAL_XDG_CURRENT_DESKTOP)$/

/** The shell's environment: Althar's, less what is Althar's own, saying what kind of terminal it is. */
export const envOf = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, version: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !OWN.test(key)) out[key] = value
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  out.TERM_PROGRAM = 'Althar'
  out.TERM_PROGRAM_VERSION = version
  // An app started from the Dock has no language, and a shell with none prints anything past ASCII wrongly.
  if (platform !== 'win32' && (out.LANG === undefined || out.LANG === '')) out.LANG = 'en_US.UTF-8'
  return out
}

/** Whether what runs in front is the shell itself: by its name, a login shell's with its dash. */
export const isShell = (front: string, shell: string) => {
  const name = basename(shell).replace(/\.exe$/i, '')
  const now = front.replace(/^-/, '').replace(/\.exe$/i, '')
  return now === '' || now === name
}

/** How much of what a terminal printed is kept, for a window that attaches again: about an editor's scrollback. */
export const KEPT = 1_000_000
/** How long what a terminal prints is gathered before it goes, and how much goes at once at most. */
const GATHER_MS = 4
const GATHER_MOST = 64 * 1024
/** How many pieces wait for a window before its terminal is held. */
const WAITING = 16

/** Keeps the end of what was printed, at most `most`, cut at a line's start so no escape is cut in two. */
export const keptOf = (pieces: Array<string>, size: number, most: number = KEPT): number => {
  let total = size
  while (pieces.length > 1 && total - (pieces[0]?.length ?? 0) >= most) total -= pieces.shift()?.length ?? 0
  const first = pieces[0]
  if (total > most && first !== undefined) {
    const from = first.length - (most - (total - first.length))
    const line = first.indexOf('\n', from)
    const kept = line === -1 ? '' : first.slice(line + 1)
    total += kept.length - first.length
    pieces[0] = kept
  }
  return total
}

interface Listener {
  readonly data: (data: string) => void
  readonly exit: (code: number) => void
}

interface Terminal {
  readonly id: string
  readonly projectId: string
  readonly taskId: string | null
  readonly launchId: string | null
  readonly folder: string
  readonly where: string
  readonly shell: string
  readonly pty: Pty
  readonly startedAt: string
  readonly printed: Array<string>
  size: number
  pending: string
  /** What it prints is being gathered: it goes once the gathering is up. */
  gathering: boolean
  readonly listeners: Set<Listener>
  /** How many windows can't keep up: while any can't, the shell is held. */
  held: number
  paused: boolean
  front: string
  exited: { readonly code: number } | null
}

export class Terminals extends Context.Service<
  Terminals,
  {
    /** Opens one by the id the client gave it, so the client shows it at once; one by that id already open is the one returned. */
    open(input: {
      readonly id: string
      readonly projectId: string
      readonly taskId: string | null
      readonly launchId?: string
      readonly cols: number
      readonly rows: number
    }): Effect.Effect<ShownTerminal, unknown>
    /** The project's terminals, in the order they opened. */
    ofProject(projectId: string): Effect.Effect<ReadonlyArray<ShownTerminal>>
    /** What it printed, kept to its end, then each piece as it comes, until it ends or is closed. */
    attach(id: string): Stream.Stream<TerminalChunk, NotFound>
    write(id: string, data: string): Effect.Effect<void, NotFound>
    resize(id: string, cols: number, rows: number): Effect.Effect<void, NotFound>
    /** Closes it: its shell, and whatever runs in it, stop. */
    close(id: string): Effect.Effect<void>
    /** Closes every terminal of the project, or only the task's: the project is removed, or the task settled. */
    closeAll(projectId: string, taskId?: string): Effect.Effect<void>
  }
>()('@althar/runtime/Terminals') {
  static readonly layer: Layer.Layer<Terminals, never, Launches | Live | PtySpawner> = Layer.effect(
    Terminals,
    Effect.gen(function* () {
      const launches = yield* Launches
      const live = yield* Live
      const spawner = yield* PtySpawner
      const terminals = new Map<string, Terminal>()
      const version = process.env.npm_package_version ?? '1'

      const shown = (term: Terminal): ShownTerminal => ({
        id: term.id,
        projectId: term.projectId,
        taskId: term.taskId,
        launchId: term.launchId,
        folder: term.folder,
        where: term.where,
        title: term.front === '' ? basename(term.shell).replace(/\.exe$/i, '') : term.front.replace(/^-/, ''),
        busy: term.exited === null && !isShell(term.front, term.shell),
        startedAt: term.startedAt,
        exited: term.exited,
      })
      const ofProject = (projectId: string) => [...terminals.values()].filter((term) => term.projectId === projectId).map(shown)
      const told = (projectId: string) => live.publish({ _tag: 'Terminals', projectId, terminals: ofProject(projectId) })

      /** Holds the shell while any window can't keep up, and lets it go once none is behind. */
      const hold = (term: Terminal, by: number) => {
        term.held = Math.max(0, term.held + by)
        const wanted = term.held > 0 && term.exited === null
        if (wanted === term.paused) return
        term.paused = wanted
        try {
          if (wanted) term.pty.pause()
          else term.pty.resume()
        } catch {
          // It ended in between: nothing to hold.
        }
      }

      /** What was gathered goes to each window, and is kept. */
      const flush = (term: Terminal) => {
        term.gathering = false
        const data = term.pending
        if (data === '') return
        term.pending = ''
        term.printed.push(data)
        term.size = keptOf(term.printed, term.size + data.length)
        for (const listener of term.listeners) listener.data(data)
      }

      const forget = (term: Terminal) => {
        flush(term)
        terminals.delete(term.id)
        for (const listener of [...term.listeners]) listener.exit(term.exited?.code ?? 0)
        term.listeners.clear()
      }

      const stop = (term: Terminal) => {
        forget(term)
        try {
          term.pty.kill()
        } catch {
          // It had ended.
        }
      }

      // Every terminal stops as the runtime does.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const term of terminals.values()) stop(term)
        }),
      )

      // What runs in front of each shell, read every second: its name, and whether closing it stops something.
      yield* Effect.forkScoped(
        Effect.repeat(
          Effect.gen(function* () {
            const changed = new Set<string>()
            for (const term of terminals.values()) {
              if (term.exited !== null) continue
              let front = term.front
              try {
                front = term.pty.process
              } catch {
                // Ended in between; its exit says so.
              }
              if (front !== term.front) {
                term.front = front
                changed.add(term.projectId)
              }
            }
            for (const projectId of changed) yield* told(projectId)
          }),
          Schedule.spaced('1 second'),
        ),
      )

      const open: Terminals['Service']['open'] = (input) =>
        Effect.gen(function* () {
          const there = terminals.get(input.id)
          if (there !== undefined) return shown(there)
          const { path: folder, where } = yield* launches.terminalFolder({
            projectId: input.projectId,
            taskId: input.taskId,
            ...(input.launchId === undefined ? {} : { launchId: input.launchId }),
          })
          // Opened twice at once: the first one stands.
          const raced = terminals.get(input.id)
          if (raced !== undefined) return shown(raced)
          const shell = shellOf(process.platform, process.env)
          const pty = yield* Effect.try({
            try: () =>
              spawner.spawn(shell.file, shell.args, {
                cwd: folder,
                cols: input.cols,
                rows: input.rows,
                env: envOf(process.env, process.platform, version),
              }),
            catch: (cause) =>
              new Error(`Althar couldn't start ${basename(shell.file)}: ${cause instanceof Error ? cause.message : String(cause)}`),
          })
          const term: Terminal = {
            id: input.id,
            projectId: input.projectId,
            taskId: input.taskId,
            launchId: input.launchId ?? null,
            folder,
            where,
            shell: shell.file,
            pty,
            startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            printed: [],
            size: 0,
            pending: '',
            gathering: false,
            listeners: new Set(),
            held: 0,
            paused: false,
            front: '',
            exited: null,
          }
          terminals.set(term.id, term)
          pty.onData((data) => {
            if (terminals.get(term.id) !== term) return
            term.pending += data
            if (term.pending.length >= GATHER_MOST) flush(term)
            else if (!term.gathering) {
              term.gathering = true
              Effect.runFork(
                Effect.andThen(
                  Effect.sleep(GATHER_MS),
                  Effect.sync(() => term.gathering && flush(term)),
                ),
              )
            }
          })
          pty.onExit(({ exitCode, signal }) => {
            if (terminals.get(term.id) !== term) return
            flush(term)
            term.exited = { code: exitCode }
            // Ended well, by `exit` or the last key, it is gone, as in an editor; not well, it stays to say how.
            if (exitCode === 0 && (signal === undefined || signal === 0)) forget(term)
            else {
              for (const listener of term.listeners) listener.exit(exitCode)
              term.listeners.clear()
            }
            Effect.runFork(told(term.projectId))
          })
          yield* told(term.projectId)
          return shown(term)
        })

      const attach = (id: string): Stream.Stream<TerminalChunk, NotFound> =>
        Stream.callback<TerminalChunk, NotFound>(
          (queue) =>
            Effect.gen(function* () {
              const term = terminals.get(id)
              if (term === undefined) return yield* Effect.fail(new NotFound({ kind: 'terminal', id }))
              flush(term)
              const kept = term.printed.join('')
              if (kept !== '') Queue.offerUnsafe(queue, { _tag: 'Data', data: kept })
              if (term.exited !== null) {
                Queue.offerUnsafe(queue, { _tag: 'Exit', code: term.exited.code })
                Queue.endUnsafe(queue)
                return
              }
              // What waits while this window is behind, in one piece, and how its shell ended, said after it.
              let behind = false
              let waiting = ''
              let ended: number | undefined
              const end = (code: number) => {
                Queue.offerUnsafe(queue, { _tag: 'Exit', code })
                Queue.endUnsafe(queue)
              }
              const send = (data: string): void => {
                if (behind) {
                  waiting += data
                  return
                }
                if (Queue.offerUnsafe(queue, { _tag: 'Data', data })) return
                behind = true
                hold(term, 1)
                Effect.runFork(
                  Effect.andThen(
                    Queue.offer(queue, { _tag: 'Data', data }),
                    Effect.sync(() => {
                      behind = false
                      hold(term, -1)
                      const more = waiting
                      waiting = ''
                      if (more !== '') send(more)
                      if (!behind && ended !== undefined) end(ended)
                    }),
                  ),
                )
              }
              const listener: Listener = {
                data: send,
                exit: (code) => {
                  if (behind) ended = code
                  else end(code)
                },
              }
              term.listeners.add(listener)
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  term.listeners.delete(listener)
                  if (behind) hold(term, -1)
                }),
              )
            }),
          { bufferSize: WAITING, strategy: 'suspend' },
        )

      const live_ = (id: string) =>
        Effect.suspend(() => {
          const term = terminals.get(id)
          return term === undefined ? Effect.fail(new NotFound({ kind: 'terminal', id })) : Effect.succeed(term)
        })

      return Terminals.of({
        open,
        ofProject: (projectId) => Effect.sync(() => ofProject(projectId)),
        attach,
        write: (id, data) =>
          Effect.flatMap(live_(id), (term) =>
            Effect.sync(() => {
              if (term.exited === null) term.pty.write(data)
            }),
          ),
        resize: (id, cols, rows) =>
          Effect.flatMap(live_(id), (term) =>
            Effect.sync(() => {
              if (term.exited !== null) return
              try {
                term.pty.resize(cols, rows)
              } catch {
                // It ended in between.
              }
            }),
          ),
        close: (id) =>
          Effect.suspend(() => {
            const term = terminals.get(id)
            if (term === undefined) return Effect.void
            stop(term)
            return told(term.projectId)
          }),
        closeAll: (projectId, taskId) =>
          Effect.suspend(() => {
            const gone = [...terminals.values()].filter(
              (term) => term.projectId === projectId && (taskId === undefined || term.taskId === taskId),
            )
            for (const term of gone) stop(term)
            return gone.length === 0 ? Effect.void : told(projectId)
          }),
      })
    }),
  )
}
