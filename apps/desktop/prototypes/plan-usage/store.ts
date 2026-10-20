// Scrappy: what the page shows, in one place the bar sets and the seams read: the direction, the scenario, the project's usage-limit rule, and the screen.
import { useSyncExternalStore } from 'react'

export type Direction = 'N' | 'A' | 'B' | 'C'
/** How much is left: every account above half, Codex's five hours nearly gone, or Claude Code Work's week gone. */
export type Level = 'plenty' | 'nearly' | 'out'
/** The project's usage-limit rule: move the step elsewhere, wait for the reset, or ask. */
export type Rule = 'move' | 'wait' | 'ask'
export type Screen = 'home' | 'board' | 'talk' | 'task' | 'picker' | 'accounts'

export interface State {
  readonly d: Direction
  readonly level: Level
  /** Two accounts each for Claude Code and Codex, rather than one. */
  readonly several: boolean
  /** GitHub Copilot, Junie and Mistral Vibe signed in too, with no usage to read. */
  readonly silent: boolean
  readonly rule: Rule
  readonly screen: Screen
}

export const DIRECTIONS: ReadonlyArray<{ readonly key: Direction; readonly short: string; readonly name: string }> = [
  { key: 'N', short: 'Ninemate’s', name: 'as built' },
  { key: 'A', short: 'A', name: 'Quiet chip in the bar' },
  { key: 'B', short: 'B', name: 'Beside the models' },
  { key: 'C', short: 'C', name: 'Home and Accounts' },
]

export const LEVELS: ReadonlyArray<{ readonly value: Level; readonly label: string; readonly tip: string }> = [
  { value: 'plenty', label: 'Plenty left', tip: 'Every account has more than half of every window left' },
  { value: 'nearly', label: 'One window nearly out', tip: 'Codex’s five hours at 3% left, until 14:00; the rest fine' },
  { value: 'out', label: 'An account out', tip: 'Claude Code Work at 0% of its week, until Monday 09:00; its work moved' },
]

export const RULES: ReadonlyArray<{ readonly value: Rule; readonly label: string; readonly tip: string }> = [
  { value: 'move', label: 'Move', tip: 'The project’s usage-limit rule: move the step to an agent with room' },
  { value: 'wait', label: 'Wait', tip: 'The project’s usage-limit rule: wait for the reset' },
  { value: 'ask', label: 'Ask', tip: 'The project’s usage-limit rule: ask the person' },
]

export const SCREENS: ReadonlyArray<{ readonly value: Screen; readonly label: string; readonly tip: string }> = [
  { value: 'home', label: 'Home', tip: 'The home, across every project' },
  { value: 'board', label: 'Board', tip: 'The project’s board' },
  { value: 'talk', label: 'Talk', tip: 'The coordinator’s Talk room' },
  { value: 'task', label: 'Task', tip: 'The task the steering touched' },
  { value: 'picker', label: 'Model picker', tip: 'That task, its composer’s model picker open' },
  { value: 'accounts', label: 'Accounts', tip: 'Settings › Agents: each agent’s accounts' },
]

const listeners = new Set<() => void>()
let state: State = { d: 'N', level: 'nearly', several: false, silent: false, rule: 'move', screen: 'board' }

export const get = (): State => state
export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const set = (next: Partial<State>) => {
  const changed = (Object.keys(next) as Array<keyof State>).some((key) => next[key] !== state[key])
  if (!changed) return
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export const useProto = (): State => useSyncExternalStore(subscribe, get)
