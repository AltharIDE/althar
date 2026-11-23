import { useSyncExternalStore } from 'react'

import type { ThreadGoal } from '@althar/contracts'
import type { IconName } from '@althar/ui'

/*
 * The composer's commands, as every direction reads them: which there are in
 * each composer, what the words typed so far say (finding one, one picked
 * and what it takes, or none of them), and what Enter would do. Only /goal is
 * real; the rest are the commands to come, listed with "More" in the bar to
 * show how the list holds when there are several, and only listed.
 */

/** Where a composer is. Goals belong to a task's conversation: an aside and an artifact's chat are tasks too; the coordinator's isn't. */
export type Surface = 'task' | 'aside' | 'coordinator' | 'artifact'

export interface Command {
  readonly name: string
  readonly does: string
  readonly icon: IconName
  readonly where: ReadonlyArray<Surface>
  /** One of the commands to come: listed with "More", not wired. */
  readonly sample?: boolean
  /** Where things stand now, at its row's end: the goal's state, the model, how full the context is. */
  readonly now?: (goal: ThreadGoal | null) => string | null
  /** What it takes after its name, where nothing is typed yet. */
  readonly takes?: (goal: ThreadGoal | null) => string
}

export const STATUS: Record<ThreadGoal['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  complete: 'Complete',
  limited: 'Limit reached',
}

export const statusOf = (goal: ThreadGoal) => (goal.waiting ? 'Waiting' : STATUS[goal.status])

const TASKS: ReadonlyArray<Surface> = ['task', 'aside', 'artifact']

export const GOAL: Command = {
  name: 'goal',
  does: 'Keep the lead working toward an objective',
  icon: 'automation',
  where: TASKS,
  now: (goal) => (goal === null ? null : statusOf(goal)),
  takes: (goal) => (goal === null ? 'what the lead should keep working toward' : 'a new objective, or pause, edit, clear'),
}

const COMMANDS: ReadonlyArray<Command> = [
  GOAL,
  { name: 'model', does: 'Change the lead’s model', icon: 'agents', where: TASKS, sample: true, now: () => 'Opus 5.5 · High' },
  {
    name: 'compact',
    does: 'Compact the conversation',
    icon: 'compress',
    where: [...TASKS, 'coordinator'],
    sample: true,
    now: () => '48% full',
  },
  { name: 'review', does: 'Have the work reviewed', icon: 'check', where: ['task'], sample: true },
  { name: 'ship', does: 'Review it and send it up', icon: 'up', where: ['task'], sample: true },
  { name: 'hold', does: 'Hold the task where it is', icon: 'hold', where: ['task'], sample: true },
  { name: 'task', does: 'Make it a task', icon: 'plus', where: ['aside'], sample: true },
  { name: 'task', does: 'Start a task', icon: 'plus', where: ['coordinator'], sample: true },
  { name: 'aside', does: 'Ask on the side', icon: 'comment', where: ['task', 'coordinator'], sample: true },
]

/** The commands a composer offers: /goal where it applies, and with "More" the ones to come. */
export const commandsIn = (surface: Surface, more: boolean): ReadonlyArray<Command> =>
  COMMANDS.filter((one) => one.where.includes(surface) && (more || one.sample !== true))

/** What /goal takes once picked, where a goal is set: what can be done to it now. */
export interface Sub {
  readonly name: 'pause' | 'resume' | 'edit' | 'clear'
  readonly does: string
  readonly icon: IconName
}

const PAUSE: Sub = { name: 'pause', does: 'Stop working toward it for now', icon: 'pause' }
const RESUME: Sub = { name: 'resume', does: 'Go on working toward it', icon: 'play' }
const EDIT: Sub = { name: 'edit', does: 'Change the objective', icon: 'pencil' }
const CLEAR: Sub = { name: 'clear', does: 'Remove the goal', icon: 'close' }

export const subsOf = (goal: ThreadGoal | null): ReadonlyArray<Sub> => {
  if (goal === null) return []
  const toggle = goal.status === 'active' ? PAUSE : goal.status === 'complete' ? null : RESUME
  return [...(toggle === null ? [] : [toggle]), EDIT, CLEAR]
}

/** What Enter would do with the words as they are. */
export type Intent =
  | { readonly action: 'set'; readonly objective: string }
  | { readonly action: 'replace'; readonly objective: string }
  | { readonly action: 'edit'; readonly objective: string }
  | { readonly action: 'pause' | 'resume' | 'clear' | 'show' }
  /** Nothing to do yet: /goal with nothing after it and no goal, or edit with nothing after it. */
  | { readonly action: 'nothing' }
  | { readonly action: 'sample' }

export type Parsed =
  | { readonly kind: 'none' }
  /** A slash and the start of a name: the commands it could be, best first. */
  | { readonly kind: 'finding'; readonly query: string; readonly matches: ReadonlyArray<Command> }
  /** A name no command here has: it goes as a message, as words. */
  | { readonly kind: 'unknown'; readonly name: string; readonly elsewhere: Surface | null }
  | {
      readonly kind: 'command'
      readonly command: Command
      /** The words after its name. */
      readonly rest: string
      /** What it takes that the words could be, while they are one word or none. */
      readonly subs: ReadonlyArray<Sub>
      readonly intent: Intent
    }

const NAME = /^\/(\S*)(\s?)([\s\S]*)$/

export const parse = (value: string, surface: Surface, more: boolean, goal: ThreadGoal | null): Parsed => {
  const typed = NAME.exec(value)
  if (typed === null) return { kind: 'none' }
  const name = (typed[1] ?? '').toLowerCase()
  const spaced = typed[2] !== ''
  const rest = typed[3] ?? ''
  const offered = commandsIn(surface, more)
  if (!spaced) {
    const starts = offered.filter((one) => one.name.startsWith(name))
    const within = offered.filter((one) => !one.name.startsWith(name) && (one.name.includes(name) || one.does.toLowerCase().includes(name)))
    const matches = [...starts, ...within]
    if (matches.length > 0) return { kind: 'finding', query: name, matches }
    return { kind: 'unknown', name, elsewhere: elsewhereOf(name, surface) }
  }
  const command = offered.find((one) => one.name === name)
  if (command === undefined) return { kind: 'unknown', name, elsewhere: elsewhereOf(name, surface) }
  if (command !== GOAL) return { kind: 'command', command, rest, subs: [], intent: { action: 'sample' } }
  return { kind: 'command', command, rest, ...goalOf(rest, goal) }
}

/** A command that is a task's, typed in the coordinator's composer: where it is. */
const elsewhereOf = (name: string, surface: Surface): Surface | null =>
  surface === 'coordinator' && GOAL.name.startsWith(name) && name.length > 1 ? 'task' : null

const goalOf = (rest: string, goal: ThreadGoal | null): { subs: ReadonlyArray<Sub>; intent: Intent } => {
  const words = rest.trim()
  const all = subsOf(goal)
  if (words === '') return { subs: all, intent: goal === null ? { action: 'nothing' } : { action: 'show' } }
  const [first = '', ...after] = words.split(/\s+/)
  const word = first.toLowerCase()
  const one = after.length === 0
  const subs = one ? all.filter((sub) => sub.name.startsWith(word)) : []
  const exact = all.find((sub) => sub.name === word)
  if (exact !== undefined && exact.name === 'edit') {
    const objective = words.slice(first.length).trim()
    return { subs: one ? subs : [], intent: objective === '' ? { action: 'nothing' } : { action: 'edit', objective } }
  }
  if (exact !== undefined && exact.name !== 'edit' && one) return { subs, intent: { action: exact.name } }
  return { subs, intent: goal === null ? { action: 'set', objective: words } : { action: 'replace', objective: words } }
}

/** What goes to the task's own handling (TaskView's goalCommand): the command as words. */
export const wordsOf = (intent: Intent, rest: string): string => {
  switch (intent.action) {
    case 'set':
    case 'replace':
      return `/goal ${intent.objective}`
    case 'edit':
      return `/goal edit ${intent.objective}`
    case 'pause':
    case 'resume':
    case 'clear':
      return `/goal ${intent.action}`
    case 'show':
      return '/goal'
    case 'nothing':
    case 'sample':
      return `/goal ${rest}`.trim()
  }
}

/** What Enter does, in a few words: a send button's label, a menu's last row. */
export const doesOf = (intent: Intent): string | null => {
  switch (intent.action) {
    case 'set':
      return 'Set the goal'
    case 'replace':
      return 'Replace the goal'
    case 'edit':
      return 'Save the goal'
    case 'pause':
      return 'Pause the goal'
    case 'resume':
      return 'Resume the goal'
    case 'clear':
      return 'Clear the goal'
    case 'show':
      return 'Show the goal'
    case 'nothing':
    case 'sample':
      return null
  }
}

/*
 * Whether the composer on show draws its goal itself (B's mode, D's panel):
 * the goal's own line over the composer steps aside meanwhile, so it isn't
 * said twice. One composer is on show at a time in the lab.
 */
let showing = false
const heard = new Set<() => void>()
export const goalShown = {
  set: (on: boolean) => {
    if (on === showing) return
    showing = on
    for (const listener of heard) listener()
  },
  subscribe: (listener: () => void) => {
    heard.add(listener)
    return () => heard.delete(listener)
  },
}
export const useGoalShown = () => useSyncExternalStore(goalShown.subscribe, () => showing)
