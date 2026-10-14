// Scrappy: what the page holds, shared by every path, so switching path keeps the screen and what happened on it.
import { useSyncExternalStore } from 'react'

import type { ProjectRulesView } from '@althar/contracts'

import { firstRules, PROMPTS } from './data'

export type Path = 'T' | 'A' | 'B' | 'C' | 'D' | 'BC'
export type View = 'rules' | 'task' | 'board'
export type Mode = ProjectRulesView['permissions']
/** D: how long allow everything lasts. */
export type Until = 'hour' | 'task' | 'off'
/** The page's starting points, as the address names them. */
export type Start = 'fresh' | 'task' | 'project' | 'ended'

export const PATHS: ReadonlyArray<{ readonly key: Path; readonly short: string; readonly name: string }> = [
  { key: 'T', short: 'Today', name: 'As it is' },
  { key: 'A', short: 'A', name: 'One switch' },
  { key: 'B', short: 'B', name: 'Modes, task chip' },
  { key: 'C', short: 'C', name: 'From the prompt' },
  { key: 'D', short: 'D', name: 'For a while' },
  { key: 'BC', short: 'B+C', name: 'Chip and prompt' },
]

export const VIEWS: ReadonlyArray<{ readonly key: View; readonly label: string; readonly hash: string }> = [
  { key: 'task', label: 'Task', hash: '#/threads/th1' },
  { key: 'rules', label: 'Rules', hash: '#/projects/p1/rules' },
  { key: 'board', label: 'Board', hash: '#/projects/p1?room=board' },
]

export const STARTS: ReadonlyArray<{ readonly key: Start; readonly label: string; readonly tip: string }> = [
  { key: 'fresh', label: '7 waiting', tip: 'The lead has asked seven things in a row, the deploy in front' },
  { key: 'task', label: 'Task: all', tip: 'This task allows everything, set from the prompt, its menu or its chip' },
  { key: 'project', label: 'Project: all', tip: 'meridian allows everything, set on its Rules page' },
  { key: 'ended', label: 'Ended', tip: 'D: allow everything ran out, and the task asks again' },
]

export interface State {
  readonly path: Path
  /** The project's rules, as the fake runtime keeps them: its mode is `permissions`. */
  readonly rules: ProjectRulesView
  /** What the project goes back to once its allow everything is off: A's switch, D's hour. */
  readonly before: Mode
  /** D: how long the project's allow everything lasts. */
  readonly projectUntil: { readonly until: 'hour' | 'off'; readonly endsAt: number | null } | null
  /** The task's own mode, over its project's; null goes by the project. */
  readonly taskMode: Mode | null
  /** D: how long the task's allow everything lasts. */
  readonly taskUntil: { readonly until: Until; readonly endsAt: number | null } | null
  /** The prompts still waiting, by id, in order. */
  readonly waiting: ReadonlyArray<string>
  /** What became of the prompts waiting when allow everything came on: allowed, or sent back to be spelled out. */
  readonly cleared: {
    readonly allowed: ReadonlyArray<string>
    readonly sentBack: ReadonlyArray<string>
    readonly by: 'task' | 'project'
  } | null
  /** D: allow everything ended, and the task asks again. */
  readonly ended: { readonly at: number; readonly allowed: number } | null
  /** B: the task's chip is open, as the card's way out opens it. */
  readonly chipOpen: boolean
  /** The task's menu is open, as A's way out opens it. */
  readonly menuOpen: boolean
}

const MINUTE = 60_000

const initial = (path: Path): State => ({
  path,
  rules: firstRules,
  before: firstRules.permissions,
  projectUntil: null,
  taskMode: null,
  taskUntil: null,
  waiting: PROMPTS.map((prompt) => prompt.id),
  cleared: null,
  ended: null,
  chipOpen: false,
  menuOpen: false,
})

let state: State = initial('B')
const listeners = new Set<() => void>()
/** What else hears a change: the fake runtime, which tells the app's cache to read again. */
const changed = new Set<(next: State, was: State) => void>()

const set = (next: State) => {
  const was = state
  state = next
  for (const listener of listeners) listener()
  for (const hear of changed) hear(next, was)
}

export const get = () => state
export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const onChange = (hear: (next: State, was: State) => void) => {
  changed.add(hear)
  return () => changed.delete(hear)
}
export const useProto = () => useSyncExternalStore(subscribe, get, get)

/* ——— What the state means ——— */

/** The mode the task works under: its own, else its project's. */
export const effectiveOf = (s: State): Mode => s.taskMode ?? s.rules.permissions
/** Nothing on the task waits for the person. */
export const unrestricted = (s: State) => effectiveOf(s) === 'allow'
/** Whether the project's Never names anything: then what Althar can't read is refused under allow everything, not allowed. */
export const neverNames = (rules: ProjectRulesView) => rules.never.length > 0 || rules.commands.some((rule) => rule.decision === 'never')

/** What allow everything does to the prompts waiting: each allowed, but what Althar can't read, which goes back to be spelled out while Never names anything. */
const clear = (s: State, by: 'task' | 'project', chosen?: string): State => {
  if (s.waiting.length === 0) return s
  const strict = neverNames(s.rules)
  const allowed = s.waiting.filter((id) => id === chosen || !(strict && PROMPTS.find((prompt) => prompt.id === id)?.unclear === true))
  const sentBack = s.waiting.filter((id) => !allowed.includes(id))
  return { ...s, waiting: [], cleared: { allowed, sentBack, by }, ended: null, chipOpen: false, menuOpen: false }
}

/* ——— What the person does ——— */

export const setPath = (path: Path) => set({ ...state, path, chipOpen: false, menuOpen: false })

/** The project's rules, changed from its Rules page or by a path's control there. */
export const changeRules = (change: Partial<ProjectRulesView>) => {
  const rules = { ...state.rules, ...change, revision: state.rules.revision + 1 }
  const to = rules.permissions
  const from = state.rules.permissions
  const before = to === 'allow' && from !== 'allow' ? from : state.before
  const next: State = { ...state, rules, before, ...(to === 'allow' ? {} : { projectUntil: null }) }
  set(to === 'allow' && from !== 'allow' && next.taskMode === null ? clear(next, 'project') : next)
}

export const setProjectMode = (permissions: Mode) => changeRules({ permissions })

/** A: the switch at the top of the rules; off goes back to the mode it was on before. */
export const setProjectAllow = (on: boolean) => setProjectMode(on ? 'allow' : state.before === 'allow' ? 'rules' : state.before)

/** D: allow everything in the project for a while, or off. */
export const setProjectUntil = (until: 'hour' | 'off' | null) => {
  if (until === null) {
    set({ ...state, projectUntil: null })
    return setProjectAllow(false)
  }
  set({ ...state, projectUntil: { until, endsAt: until === 'hour' ? Date.now() + 60 * MINUTE : null } })
  if (state.rules.permissions !== 'allow') setProjectAllow(true)
}

/** The task's own mode, or back to the project's with null. Allow everything clears what waits. */
export const setTaskMode = (mode: Mode | null) => {
  const next: State = { ...state, taskMode: mode, taskUntil: mode === 'allow' ? state.taskUntil : null, chipOpen: false, menuOpen: false }
  set(mode === 'allow' && effectiveOf(state) !== 'allow' ? clear(next, 'task') : next)
}

/** C: yes to this one, and stop asking on the task. */
export const stopAsking = (chosen: string) => {
  // After the card's own beat, as an answer would land.
  window.setTimeout(() => set(clear({ ...state, taskMode: 'allow', chipOpen: false, menuOpen: false }, 'task', chosen)), 520)
}

/** D: allow everything on the task for a while; from the card, this one is yes too. */
export const allowFor = (until: Until, chosen?: string) => {
  const go = () =>
    set(
      clear(
        { ...state, taskMode: 'allow', taskUntil: { until, endsAt: until === 'hour' ? Date.now() + 60 * MINUTE : null }, menuOpen: false },
        'task',
        chosen,
      ),
    )
  if (chosen === undefined) go()
  else window.setTimeout(go, 520)
}

/** D: it ends, by the clock or the person: the task asks again, and says what went ahead meanwhile. */
export const endNow = () =>
  set({ ...state, taskMode: null, taskUntil: null, ended: { at: Date.now(), allowed: 23 }, chipOpen: false, menuOpen: false })

/** Undo, from the line that says what cleared: the task, or its project, asks again, and what waited waits again. */
export const askAgain = () => {
  const project = state.cleared?.by === 'project' && state.rules.permissions === 'allow'
  const rules = project ? { ...state.rules, permissions: state.before, revision: state.rules.revision + 1 } : state.rules
  set({
    ...state,
    rules,
    projectUntil: project ? null : state.projectUntil,
    taskMode: null,
    taskUntil: null,
    waiting: PROMPTS.map((prompt) => prompt.id),
    cleared: null,
  })
}

/** One prompt answered on its card: it leaves once its card's motion is done. */
export const answered = (id: string) => {
  window.setTimeout(() => set({ ...state, waiting: state.waiting.filter((one) => one !== id) }), 680)
}

export const setChipOpen = (chipOpen: boolean) => set({ ...state, chipOpen })
export const setMenuOpen = (menuOpen: boolean) => set({ ...state, menuOpen })

/** A starting point, from the address or the bar: everything else as it first was. */
export const start = (at: Start, path: Path = state.path) => {
  const fresh = initial(path)
  switch (at) {
    case 'fresh':
      return set(fresh)
    case 'task':
      state = fresh
      if (path === 'D')
        return set(clear({ ...fresh, taskMode: 'allow', taskUntil: { until: 'hour', endsAt: Date.now() + 52 * MINUTE } }, 'task', 'p1'))
      return set(clear({ ...fresh, taskMode: 'allow' }, 'task', 'p1'))
    case 'project': {
      const rules = { ...fresh.rules, permissions: 'allow' as const, revision: fresh.rules.revision + 1 }
      return set(
        clear(
          { ...fresh, rules, ...(path === 'D' ? { projectUntil: { until: 'hour' as const, endsAt: Date.now() + 52 * MINUTE } } : {}) },
          'project',
        ),
      )
    }
    case 'ended':
      // It asks again: the next deploy waits for the person, under the line that says it ended.
      return set({ ...fresh, waiting: ['p1'], cleared: null, ended: { at: Date.now() - 2 * MINUTE, allowed: 23 } })
  }
}

/** Where the state stands, in the address's word for it. */
export const startOf = (s: State): Start =>
  s.ended !== null ? 'ended' : s.rules.permissions === 'allow' ? 'project' : s.taskMode === 'allow' ? 'task' : 'fresh'
