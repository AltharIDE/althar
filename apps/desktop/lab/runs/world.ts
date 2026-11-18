import { useSyncExternalStore } from 'react'

import { interpret, type Play } from './shell'
import { lab, type Scene } from './state'

/*
 * The lab's runtime: what the project runs and each run of it, starting,
 * printing, answering, failing or stopped; the terminals open, each in a
 * folder, with what was typed in it and what it printed; and where each
 * direction shows them (focus, open, the terminal's tab). Everything here is
 * made up and kept in the page. `structure` changes only when something the
 * app's own screens read changes (a run starts, answers, ends, goes; a
 * command typed in the conversation), so the app reads again only then; what
 * streams is read straight from here.
 */

export type Repository = 'althar' | 'althar-mobile'

/** A folder a terminal or a run is in: a repository at a place, the project's copy of its default branch or a task's worktree. */
export interface Folder {
  readonly repository: Repository
  readonly branch: string
  /** The task whose worktree it is; none for the project's own. */
  readonly task?: string
  /** Where it is on disk. */
  readonly path: string
}

export const projectFolder = (repository: Repository): Folder => ({
  repository,
  branch: 'main',
  path: `~/Projects/charrette-project/${repository}`,
})

export const taskFolder = (repository: Repository, task: string, slug: string): Folder => ({
  repository,
  branch: `althar/${slug}`,
  task,
  path: `~/Charrette/althar/${slug}/${repository}`,
})

/** The folders a terminal can open in: the project's repositories, and the worktrees of its tasks under way. */
export const FOLDERS: ReadonlyArray<Folder> = [
  projectFolder('althar'),
  projectFolder('althar-mobile'),
  taskFolder('althar', 'Cut a small change’s overhead', 'small-changes-fast'),
  taskFolder('althar-mobile', 'Board cards on the phone', 'board-cards-phone'),
]

type Step = { readonly after: number; readonly line?: string; readonly url?: string; readonly end?: number }

export interface Runnable {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly repository: Repository
  /** What a run of it prints, in time, and how it ends; `fixed` once its lockfile was brought up to date. */
  readonly script: (fixed: boolean) => ReadonlyArray<Step>
}

const SETUP = (n: number): Step[] => [
  { after: 120, line: '$ bun install --frozen-lockfile' },
  { after: 260, line: 'bun install v1.3.5 (1e86cebd)' },
  { after: 380, line: `Checked ${n} installs across ${n + 61} packages (no changes) [212.00ms]` },
]

export const RUNNABLES: ReadonlyArray<Runnable> = [
  {
    id: 'r_desktop',
    name: 'Desktop app',
    command: 'bun --filter @althar/desktop dev',
    repository: 'althar',
    script: () => [
      ...SETUP(1204),
      { after: 300, line: '$ bun --filter @althar/desktop dev' },
      { after: 400, line: '@althar/desktop dev: vite v7.1.4 building for development...' },
      { after: 700, line: '@althar/desktop dev: ✓ 2417 modules transformed.' },
      { after: 300, line: '@althar/desktop dev: main  dist/main.js  412.31 kB' },
      { after: 200, line: '@althar/desktop dev: preload  dist/preload.js  18.02 kB' },
      { after: 500, line: '@althar/desktop dev: Electron 39.2.0 started' },
    ],
  },
  {
    id: 'r_storybook',
    name: 'Storybook',
    command: 'bun --filter @althar/ui storybook',
    repository: 'althar',
    script: () => [
      ...SETUP(1204),
      { after: 300, line: '$ bun --filter @althar/ui storybook' },
      { after: 500, line: '@althar/ui storybook: storybook v9.1.2' },
      { after: 600, line: '@althar/ui storybook: info => Starting manager..' },
      { after: 800, line: '@althar/ui storybook: info => Starting preview..' },
      { after: 600, line: '@althar/ui storybook: ╭─────────────────────────────────────────────╮' },
      { after: 0, line: '@althar/ui storybook: │  Storybook 9.1.2 for react-vite started     │' },
      { after: 0, line: '@althar/ui storybook: │  Local:   http://localhost:6006/            │' },
      { after: 0, line: '@althar/ui storybook: ╰─────────────────────────────────────────────╯', url: 'http://localhost:6006/' },
    ],
  },
  {
    id: 'r_site',
    name: 'Site',
    command: 'bun run dev',
    repository: 'althar',
    script: () => [
      ...SETUP(1204),
      { after: 300, line: '$ vp dev --config apps/site/vite.config.ts' },
      { after: 700, line: '  VITE v7.1.4  ready in 412 ms' },
      { after: 100, line: '' },
      { after: 0, line: '  ➜  Local:   http://localhost:5320/', url: 'http://localhost:5320/' },
      { after: 0, line: '  ➜  press h + enter to show help' },
    ],
  },
  {
    id: 'r_ios',
    name: 'Mobile on iOS simulator',
    command: 'bun run ios',
    repository: 'althar-mobile',
    script: (fixed) =>
      fixed
        ? [
            ...SETUP(1148),
            { after: 300, line: '$ bun run ios' },
            { after: 200, line: '$ expo run:ios' },
            { after: 600, line: 'env: load .env' },
            { after: 300, line: '› Planning build' },
            { after: 900, line: '› Executing althar-mobile » Bundle React Native code and images' },
            { after: 1200, line: '› Build Succeeded' },
            { after: 400, line: '› Installing on iPhone 17 Pro' },
            { after: 600, line: '› Opening on iPhone 17 Pro (dev.althar.mobile)' },
            { after: 300, line: 'Logs for your project will appear below. Press Ctrl+C to exit.' },
          ]
        : [
            { after: 120, line: '$ bun install --frozen-lockfile' },
            { after: 260, line: 'bun install v1.3.5 (1e86cebd)' },
            { after: 500, line: 'Resolving dependencies' },
            { after: 700, line: 'Resolved, downloaded and extracted [1148]' },
            { after: 300, line: 'error: lockfile had changes, but lockfile is frozen' },
            { after: 0, line: 'note: try re-running without --frozen-lockfile and commit the updated lockfile', end: 1 },
          ],
  },
]

export interface Run {
  readonly id: string
  readonly runnableId: string
  readonly name: string
  readonly command: string
  readonly folder: Folder
  readonly startedAt: number
  url: string | null
  ended: { at: number; code: number | null; stopped: boolean; last: string | null } | null
  lines: string[]
}

export interface Entry {
  readonly id: string
  readonly command: string
  /** Where it ran, as the prompt said it. */
  readonly folder: Folder
  readonly cwd: string
  readonly at: number
  lines: string[]
  exit: number | null
  running: boolean
}

export interface Shell {
  readonly id: string
  folder: Folder
  /** Where in the folder it is, after a cd: '' at its top. */
  cwd: string
  entries: Entry[]
  history: string[]
  /** Lines cleared from view stay in the entries, but the view starts after them. */
  clearedAt: number
}

export type Focus = { readonly kind: 'run'; readonly id: string } | { readonly kind: 'shell'; readonly id: string }

/** The coordinator's thread, as the lab adds to it: a run's card where it was started. */
export type Said = { readonly kind: 'run'; readonly id: string; readonly at: number }

interface State {
  runs: Run[]
  shells: Shell[]
  said: Said[]
  /** The lockfile was brought up to date, in the folder the iOS run runs in. */
  fixed: boolean
  /** What a direction shows: the run or terminal open, and whether its place is open at all. */
  focus: Focus | null
  open: boolean
  /** B3: its panel over the whole of the project's screen, not only its foot. */
  whole: boolean
  /** D: the terminal's tab is among the window's, and has the window. */
  tab: { shown: boolean; current: boolean }
  /** D and B3: a terminal opened from a run, by the run, shown beside it. */
  pairs: Record<string, string>
}

let state: State
let structure = 0
let version = 0
let ids = 0
const timers = new Map<string, number[]>()
const listeners = new Set<() => void>()
const structural = new Set<() => void>()

const nextId = (prefix: string) => `${prefix}_${(ids += 1)}`

const emit = (shape = false) => {
  version += 1
  if (shape) {
    structure += 1
    for (const listener of structural) listener()
  }
  for (const listener of listeners) listener()
}

const later = (owner: string, after: number, act: () => void) => {
  const id = window.setTimeout(() => {
    timers.set(
      owner,
      (timers.get(owner) ?? []).filter((one) => one !== id),
    )
    act()
  }, after)
  timers.set(owner, [...(timers.get(owner) ?? []), id])
}

const cancel = (owner: string) => {
  for (const id of timers.get(owner) ?? []) window.clearTimeout(id)
  timers.delete(owner)
}

const runnableOf = (id: string) => RUNNABLES.find((one) => one.id === id)

/** A run, played through by its script from now: each line in its time, then where it answers, or how it ended. */
const play = (run: Run) => {
  const runnable = runnableOf(run.runnableId)
  if (runnable === undefined) return
  let wait = 0
  for (const step of runnable.script(state.fixed)) {
    wait += step.after
    later(run.id, wait, () => {
      if (step.line !== undefined) run.lines.push(step.line)
      if (step.url !== undefined) run.url = step.url
      if (step.end !== undefined)
        run.ended = {
          at: Date.now(),
          code: step.end,
          stopped: false,
          last: run.lines.findLast((one) => one.startsWith('error')) ?? run.lines.at(-1) ?? null,
        }
      emit(step.url !== undefined || step.end !== undefined)
    })
  }
}

/** A run already over or under way, as a scene opens on it: its script played to its end at once. */
const playedOut = (runnableId: string, minutesAgo: number, endedAgo: number | null): Run => {
  const runnable = runnableOf(runnableId)!
  const run: Run = {
    id: nextId('run'),
    runnableId,
    name: runnable.name,
    command: runnable.command,
    folder: projectFolder(runnable.repository),
    startedAt: Date.now() - minutesAgo * 60_000,
    url: null,
    ended: null,
    lines: [],
  }
  for (const step of runnable.script(false)) {
    if (step.line !== undefined) run.lines.push(step.line)
    if (step.url !== undefined) run.url = step.url
    if (step.end !== undefined)
      run.ended = {
        at: Date.now() - (endedAgo ?? 0) * 60_000,
        code: step.end,
        stopped: false,
        last: run.lines.findLast((one) => one.startsWith('error')) ?? null,
      }
  }
  return run
}

const newShell = (folder: Folder): Shell => ({
  id: nextId('sh'),
  folder,
  cwd: '',
  entries: [],
  history: [],
  clearedAt: 0,
})

/** The world a scene opens on. */
const seed = (scene: Scene): State => {
  for (const owner of timers.keys()) cancel(owner)
  const base: State = {
    runs: [],
    shells: [],
    said: [],
    fixed: false,
    focus: null,
    open: false,
    whole: false,
    tab: { shown: false, current: false },
    pairs: {},
  }
  if (scene === 'quiet') return base
  const storybook = playedOut('r_storybook', 12, null)
  const ios = playedOut('r_ios', 3, 2)
  const runs = [storybook, ios]
  const shells: Shell[] = []
  if (scene === 'many') {
    runs.unshift(playedOut('r_site', 40, null), playedOut('r_desktop', 6, null))
    shells.push(newShell(projectFolder('althar')), newShell(FOLDERS[2]!))
  }
  return {
    ...base,
    runs,
    shells,
    // D: what ran has its tab among the window's.
    tab: { shown: true, current: false },
    said: runs.map((run) => ({ kind: 'run', id: run.id, at: run.startedAt })),
  }
}

state = seed(lab.get().scene)

/** Plays a command in a terminal, as its interpreter says: what it prints in time, then how it ends, unless stopped. */
const perform = (shell: Shell, entry: Entry, played: Play) => {
  let wait = 0
  for (const step of played.steps) {
    wait += step.after
    later(entry.id, wait, () => {
      entry.lines.push(step.line)
      emit()
    })
  }
  if (played.exit === null) return
  later(entry.id, wait + 60, () => {
    entry.exit = played.exit
    entry.running = false
    played.effect?.(world)
    if (played.cwd !== undefined) shell.cwd = played.cwd
    if (played.folder !== undefined) shell.folder = played.folder
    emit()
  })
}

export const world = {
  get: () => state,
  version: () => version,
  structure: () => structure,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Only what the app's own screens read: a run starting, answering, ending or going, a command said in the thread. */
  onStructure: (listener: () => void) => {
    structural.add(listener)
    return () => structural.delete(listener)
  },
  reset: (scene: Scene) => {
    state = seed(scene)
    emit(true)
  },

  runnable: runnableOf,
  run: (id: string) => state.runs.find((one) => one.id === id),
  shell: (id: string) => state.shells.find((one) => one.id === id),
  entry: (id: string) => state.shells.flatMap((shell) => shell.entries).find((one) => one.id === id),

  /** Runs one, as the Run list or a card runs it: starting at once, its card in the conversation. */
  start: (runnableId: string): Run | undefined => {
    const runnable = runnableOf(runnableId)
    if (runnable === undefined) return undefined
    // One already going there goes on; one that ended is replaced.
    const going = state.runs.find((one) => one.runnableId === runnableId && one.ended === null)
    if (going !== undefined) return going
    const was = state.runs.find((one) => one.runnableId === runnableId)
    state.runs = state.runs.filter((one) => one.runnableId !== runnableId)
    const run: Run = {
      id: nextId('run'),
      runnableId,
      name: runnable.name,
      command: runnable.command,
      folder: projectFolder(runnable.repository),
      startedAt: Date.now(),
      url: null,
      ended: null,
      lines: [],
    }
    state.runs = [...state.runs, run]
    state.said = [...state.said, { kind: 'run', id: run.id, at: run.startedAt }]
    // Run again: the terminal opened beside the one it replaces stays beside it.
    const beside = was === undefined ? undefined : state.pairs[was.id]
    if (was !== undefined && beside !== undefined) {
      const { [was.id]: _, ...rest } = state.pairs
      state.pairs = { ...rest, [run.id]: beside }
    }
    play(run)
    const d = lab.get().d
    // Where the direction keeps a run, it shows there as it starts.
    if (d !== 'today' && d !== 'd') {
      state.focus = { kind: 'run', id: run.id }
      state.open = true
    }
    if (d === 'd') state.tab = { ...state.tab, shown: true }
    emit(true)
    return run
  },
  stop: (id: string) => {
    const run = world.run(id)
    if (run === undefined || run.ended !== null) return
    cancel(id)
    run.lines.push('^C')
    run.ended = { at: Date.now(), code: null, stopped: true, last: null }
    run.url = null
    emit(true)
  },
  again: (id: string) => {
    const run = world.run(id)
    if (run !== undefined) world.start(run.runnableId)
  },
  clear: (id: string) => {
    cancel(id)
    state.runs = state.runs.filter((one) => one.id !== id)
    if (state.focus?.kind === 'run' && state.focus.id === id) state.focus = null
    emit(true)
  },

  /** A new terminal, in a folder; with `beside`, the run it was opened by, for a tab that shows them side by side. */
  openShell: (folder: Folder, beside?: string): Shell => {
    const shell = newShell(folder)
    state.shells = [...state.shells, shell]
    if (beside !== undefined) state.pairs = { ...state.pairs, [beside]: shell.id }
    emit()
    return shell
  },
  closeShell: (id: string) => {
    const shell = world.shell(id)
    for (const entry of shell?.entries ?? []) cancel(entry.id)
    state.shells = state.shells.filter((one) => one.id !== id)
    state.pairs = Object.fromEntries(Object.entries(state.pairs).filter(([, one]) => one !== id))
    if (state.focus?.kind === 'shell' && state.focus.id === id) {
      const left = state.runs.at(-1) ?? null
      state.focus = left === null ? null : { kind: 'run', id: left.id }
      if (left === null && lab.get().d !== 'd') state.open = false
    }
    emit()
  },
  /** Types a command into a terminal and presses Enter. */
  exec: (shellId: string, typed: string) => {
    const shell = world.shell(shellId)
    if (shell === undefined) return
    const command = typed.trim()
    if (command !== '') shell.history = [...shell.history.filter((one) => one !== command), command]
    const played = interpret(shell, command, state.fixed)
    if (played.clear === true) {
      shell.clearedAt = shell.entries.length
      emit()
      return
    }
    if (played.close === true) {
      world.closeShell(shellId)
      return
    }
    const entry: Entry = {
      id: nextId('cmd'),
      command,
      folder: shell.folder,
      cwd: shell.cwd,
      at: Date.now(),
      lines: [],
      exit: null,
      running: true,
    }
    shell.entries = [...shell.entries, entry]
    emit()
    perform(shell, entry, played)
  },
  /** Ctrl+C on what runs in a terminal. */
  interrupt: (entryId: string) => {
    const entry = world.entry(entryId)
    if (entry === undefined || !entry.running) return
    cancel(entryId)
    entry.lines.push('^C')
    entry.exit = 130
    entry.running = false
    emit()
  },
  /** bun install brought the lockfile up to date: the next iOS run gets past it. */
  fix: () => {
    state.fixed = true
  },

  show: (focus: Focus) => {
    state.focus = focus
    state.open = true
    if (lab.get().d === 'd') state.tab = { shown: true, current: true }
    emit()
  },
  hide: () => {
    state.open = false
    state.whole = false
    emit()
  },
  /** B3: its panel over the whole project's screen, or back to its foot. */
  setWhole: (whole: boolean) => {
    state.whole = whole
    emit()
  },
  setOpen: (open: boolean) => {
    state.open = open
    emit()
  },
  /** D: the terminal's tab, shown among the window's, with the window or not. */
  tabTo: (current: boolean) => {
    state.tab = { shown: state.tab.shown || current, current }
    emit()
  },
  closeTab: () => {
    state.tab = { shown: false, current: false }
    emit()
  },
}

export type World = typeof world

/** The world, read again on every change: for what streams. */
export const useWorld = () => {
  useSyncExternalStore(world.subscribe, world.version)
  return world.get()
}

/** A run's state, in a word, as its head says it. */
export const phaseOf = (run: Run): 'starting' | 'running' | 'failed' | 'stopped' | 'finished' =>
  run.ended === null
    ? run.url === null && Date.now() - run.startedAt < 9000 && !run.lines.some((one) => one.startsWith('›') || one.includes('started'))
      ? 'starting'
      : 'running'
    : run.ended.stopped
      ? 'stopped'
      : run.ended.code === 0
        ? 'finished'
        : 'failed'

/** A folder by name, as a terminal's prompt says it. */
export const folderName = (folder: Folder) => folder.repository

/** The prompt's place: the folder, and a path within it after a cd. */
export const promptOf = (folder: Folder, cwd: string) => (cwd === '' ? folder.repository : `${folder.repository}/${cwd}`)

/** What a failed run is said as, for the agent: the run, how it ended, and the end of what it printed. */
export const helpText = (run: Run) =>
  `${run.name} exited ${run.ended?.code ?? ''} on ${run.folder.branch}. It printed:\n\n\`\`\`\n${run.lines.slice(-4).join('\n')}\n\`\`\`\n\nHelp me fix it.`
