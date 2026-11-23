import {
  type AgentModels,
  type AgentStatus,
  GOAL_ROUNDS,
  goalCommand,
  type Runnable,
  type SessionSummary,
  type ThreadGoal,
} from '@althar/contracts'
import type { CommandOption, ComposerCommand } from '@althar/ui'

import { type Choice, catalogOf, choiceOf, defaultEffortOf, effortName, infoOf, offersEffort } from './models'

/*
 * What a slash at the start of a composer offers, by screen: each command is
 * something the screen can already do with a press, said where it stands now
 * and done as it does it. TaskView and the project's conversation pick from
 * these what they can do at the moment (a task held for Ship has /ship, a
 * lead at work /interrupt); none of them is said to the agent.
 */

export const commandText = {
  goal: {
    does: 'Keep the lead working toward an objective',
    takes: (set: boolean) => (set ? 'a new objective' : 'what the lead should keep working toward'),
    title: 'Goal',
    notSet: 'Not set',
    what: `The lead keeps working toward it on its own, up to ${GOAL_ROUNDS} turns, until it’s done or stuck.`,
    status: { active: 'Active', paused: 'Paused', blocked: 'Blocked', complete: 'Complete', limited: 'Limit reached', waiting: 'Waiting' },
    turns: (status: string, rounds: number, limit: number) => `${status} · ${rounds} of ${limit} turns`,
    pause: 'Stop working toward it for now',
    resume: 'Go on working toward it',
    edit: 'Change the objective',
    clear: 'Remove the goal',
    set: 'Set the goal',
    replace: 'Replace the goal',
    save: 'Save the goal',
    elsewhere: 'In a task’s conversation',
  },
  model: { does: (owner: string) => `Change the ${owner}’s model`, takes: 'a model', current: 'Current' },
  compact: { does: 'Compact the conversation', full: (percent: number) => `${percent}% full` },
  interrupt: { does: (owner: string) => `Interrupt the ${owner}` },
  rename: { does: 'Rename the task', takes: 'a new title' },
  run: { does: 'Run the project', takes: 'what to run' },
  ship: {
    does: (reviewed: boolean) => (reviewed ? 'Review it and send it up' : 'Send it up'),
    commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
  },
  done: { does: 'Mark it done' },
  keep: { does: 'Keep it for later' },
  change: { does: 'Make it a change, with a review and a pull request' },
  board: { does: 'Move it to the board' },
  scratch: { does: 'Move it to Scratch' },
  aside: { does: 'Ask on the side', takes: 'what to ask', start: 'Start the aside' },
  clear: { does: 'Clear the conversation' },
}

const statusOf = (goal: ThreadGoal) => commandText.goal.status[goal.waiting ? 'waiting' : goal.status]

/**
 * /goal: the goal itself as it stands, what can be done to it, or what a new
 * objective does. What Enter does is the words TaskView reads (`/goal …`),
 * so a goal set by the command and one typed whole land the same way.
 */
export const goalCommandOf = (goal: ThreadGoal | null, onGoal: (body: string) => void): ComposerCommand => {
  const t = commandText.goal
  const body = (words: string) => `/goal ${words}`.trim()
  const options: CommandOption[] =
    goal === null
      ? []
      : [
          ...(goal.status === 'active'
            ? [{ name: 'pause', does: t.pause, icon: 'pause' as const, run: () => onGoal(body('pause')) }]
            : goal.status === 'complete'
              ? []
              : [{ name: 'resume', does: t.resume, icon: 'play' as const, run: () => onGoal(body('resume')) }]),
          { name: 'edit', does: t.edit, icon: 'pencil', fill: `edit ${goal.objective}` },
          { name: 'clear', does: t.clear, icon: 'close', run: () => onGoal(body('clear')) },
        ]
  return {
    name: 'goal',
    does: t.does,
    icon: 'goal',
    ...(goal === null ? {} : { now: statusOf(goal) }),
    takes: t.takes(goal !== null),
    options,
    detail:
      goal === null
        ? { title: t.title, now: t.notSet, note: t.what }
        : {
            title: t.title,
            now: t.turns(statusOf(goal), goal.rounds, goal.roundLimit),
            body: goal.objective,
            ...((goal.detail ?? goal.progress) === null ? {} : { note: (goal.detail ?? goal.progress)! }),
          },
    action: (words) => {
      const asked = goalCommand(body(words))
      switch (asked?.action) {
        case 'set':
          return goal === null ? t.set : t.replace
        case 'edit':
          return t.save
        case 'pause':
        case 'resume':
        case 'clear':
          return null
        default:
          return null
      }
    },
    run: (words) => onGoal(body(words)),
  }
}

/** /goal where there are no goals, the coordinator's conversation: listed, and said where it is done. */
export const goalElsewhere: ComposerCommand = {
  name: 'goal',
  does: commandText.goal.does,
  icon: 'goal',
  unavailable: commandText.goal.elsewhere,
  run: () => {},
}

/** /compact, where the conversation has a context to compact, said as full as it is. */
export const compactCommandOf = (session: SessionSummary | null | undefined, onCompact: () => void): ComposerCommand | null => {
  const context = session?.context
  if (context == null || context.size <= 0) return null
  return {
    name: 'compact',
    does: commandText.compact.does,
    icon: 'compress',
    now: commandText.compact.full(Math.round((context.used / context.size) * 100)),
    run: onCompact,
  }
}

/** /interrupt, while the agent is at work. */
export const interruptCommandOf = (busy: boolean, owner: string, onInterrupt: () => void): ComposerCommand | null =>
  busy ? { name: 'interrupt', does: commandText.interrupt.does(owner), icon: 'square', run: onInterrupt } : null

/** A command that takes nothing: done as it is picked. */
export const pressOf = (name: string, does: string, icon: ComposerCommand['icon'], run: () => void, now?: string): ComposerCommand => ({
  name,
  does,
  icon,
  ...(now === undefined ? {} : { now }),
  run,
})

/** /rename, with the new title after it. */
export const renameCommandOf = (onRename: (title: string) => void): ComposerCommand => ({
  name: 'rename',
  does: commandText.rename.does,
  icon: 'pencil',
  takes: commandText.rename.takes,
  action: (words) => (words === '' ? null : commandText.rename.does),
  run: (words) => {
    if (words !== '') onRename(words)
  },
})

/** A word for a name to type: lower case, spaces as dashes. */
const typed = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')

/** /run: the project as it runs by default, or with several ways to run it, each to pick. */
export const runCommandOf = (runnables: ReadonlyArray<Runnable>, onRun: (runnableId: string | null) => void): ComposerCommand => {
  const named = runnables.filter((one) => !one.own)
  if (named.length === 0) return pressOf('run', commandText.run.does, 'play', () => onRun(null), runnables[0]?.command)
  return {
    name: 'run',
    does: commandText.run.does,
    icon: 'play',
    takes: commandText.run.takes,
    options: runnables.map((one) => ({
      name: typed(one.name ?? (one.own ? one.repository : one.command)),
      ...(one.name === null ? {} : { label: one.name }),
      does: one.own ? `${one.repository}’s own way to run` : one.command,
      run: () => onRun(one.id),
    })),
    run: () => {},
  }
}

/** /aside, with what to ask on the side. */
export const asideCommandOf = (onAsk: (words: string) => void): ComposerCommand => ({
  name: 'aside',
  does: commandText.aside.does,
  icon: 'comment',
  takes: commandText.aside.takes,
  action: (words) => (words === '' ? null : commandText.aside.start),
  run: (words) => {
    if (words !== '') onAsk(words)
  },
})

/**
 * /model: every model of every agent it offers, found by name, the current
 * one said; picked, it is chosen as the model picker chooses it, with the
 * person's default effort for it, or the one in use where it keeps it.
 */
export const modelCommandOf = (
  known: ReadonlyArray<AgentModels> | null | undefined,
  owner: string,
  agents: ReadonlyArray<AgentStatus>,
  value: Choice | null,
  onChange: (choice: Choice) => void,
): ComposerCommand | null => {
  if (value === null || agents.length === 0) return null
  const catalog = catalogOf(known ?? [], agents)
  if (catalog.models.length === 0) return null
  const current = infoOf(catalog, value)
  const effort = effortName(catalog, current.id, value.effort) ?? defaultEffortOf(catalog, current)
  const counts = new Map<string, number>()
  for (const info of catalog.models) counts.set(typed(info.name), (counts.get(typed(info.name)) ?? 0) + 1)
  const options = catalog.models.map((info): CommandOption => ({
    // The same model from two places is told apart by where it runs.
    name: (counts.get(typed(info.name)) ?? 0) > 1 && info.route !== undefined ? typed(`${info.name} ${info.route}`) : typed(info.name),
    label: info.name,
    does: info.route ?? info.via ?? '',
    ...(info.id === current.id ? { now: commandText.model.current } : {}),
    run: () => {
      const { agentId, model } = choiceOf(info.id)
      const kept = agentId === value.agentId && offersEffort(catalog, info.id, value.effort) ? value.effort : null
      onChange({ agentId, model, effort: catalog.defaults.get(info.id) ?? kept })
    },
  }))
  return {
    name: 'model',
    does: commandText.model.does(owner),
    icon: 'agents',
    now: effort === null ? current.name : `${current.name} · ${effort}`,
    takes: commandText.model.takes,
    options,
    run: () => {},
  }
}

/** The commands there are, without those that can't be done now. */
export const commandsOf = (...commands: ReadonlyArray<ComposerCommand | null | false>): ComposerCommand[] =>
  commands.filter((one): one is ComposerCommand => one !== null && one !== false)
