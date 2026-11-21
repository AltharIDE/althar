import { Schema } from 'effect'

export const GOAL_LENGTH = 4_000
export const GOAL_ROUNDS = 12

export const GoalControl = Schema.Union([
  Schema.Struct({ action: Schema.Literal('set'), objective: Schema.String }),
  Schema.Struct({ action: Schema.Literal('edit'), objective: Schema.String }),
  Schema.Struct({ action: Schema.Literal('pause') }),
  Schema.Struct({ action: Schema.Literal('resume') }),
  Schema.Struct({ action: Schema.Literal('clear') }),
])
export type GoalControl = typeof GoalControl.Type
export type GoalCommand = GoalControl | { readonly action: 'show' }

export const ThreadGoal = Schema.Struct({
  revision: Schema.Int,
  objective: Schema.String,
  status: Schema.Literals(['active', 'paused', 'blocked', 'complete', 'limited']),
  rounds: Schema.Int,
  roundLimit: Schema.Int,
  progress: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  waiting: Schema.Boolean,
})
export type ThreadGoal = typeof ThreadGoal.Type

const commandArgument = (text: string, command: string): string | undefined => {
  const separator = text[command.length]
  if (text.slice(0, command.length).toLowerCase() !== command || (separator !== undefined && separator.trim() !== '')) return undefined
  return text.slice(command.length).trim()
}

/** A command is the entire composer message. A slash inside ordinary text has no special meaning. */
export const goalCommand = (body: string): GoalCommand | undefined => {
  const argument = commandArgument(body.trim(), '/goal')
  if (argument === undefined) return undefined
  switch (argument.toLowerCase()) {
    case '':
      return { action: 'show' }
    case 'pause':
      return { action: 'pause' }
    case 'resume':
      return { action: 'resume' }
    case 'clear':
      return { action: 'clear' }
  }
  const edit = commandArgument(argument, 'edit')
  return edit === undefined || edit === '' ? { action: 'set', objective: argument } : { action: 'edit', objective: edit }
}

/** The same transition is used by the runtime and by the window's optimistic controls. */
export const nextGoal = (current: ThreadGoal | null, command: GoalControl): ThreadGoal | null => {
  switch (command.action) {
    case 'clear':
      return null
    case 'set':
      return {
        revision: (current?.revision ?? 0) + 1,
        objective: command.objective.trim(),
        status: 'active',
        rounds: 0,
        roundLimit: GOAL_ROUNDS,
        progress: null,
        detail: null,
        waiting: false,
      }
    case 'edit':
      if (current === null || current.objective === command.objective.trim()) return current
      return {
        ...current,
        revision: current.revision + 1,
        objective: command.objective.trim(),
        status: current.status === 'active' ? 'active' : 'paused',
        rounds: 0,
        progress: null,
        detail: null,
        waiting: false,
      }
    case 'pause':
      if (current?.status !== 'active') return current
      return { ...current, revision: current.revision + 1, status: 'paused', detail: null, waiting: false }
    case 'resume':
      if (current === null || current.status === 'active' || current.status === 'complete') return current
      return {
        ...current,
        revision: current.revision + 1,
        status: 'active',
        rounds: current.rounds >= current.roundLimit ? 0 : current.rounds,
        detail: null,
        waiting: false,
      }
  }
}
