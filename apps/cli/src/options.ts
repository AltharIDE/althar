import { homedir } from 'node:os'
import { join } from 'node:path'

/*
 * The command line: which folder to open, the task to start, the agent to
 * start it on, and where the profile and worktrees live.
 */

export interface Options {
  readonly folder: string
  readonly task: string
  readonly agent: string
  readonly model?: string
  readonly profile: string
  readonly worktrees: string
}

export const USAGE = `Usage: charrette <folder> --task "<title>" [--agent claude-code|codex|opencode] [--model <id>]
                 [--profile <dir>] [--worktrees <dir>]

Opens <folder> as a project, starts the task in a worktree of its own, and
starts its agent. Then type to talk to the agent; /help lists the commands.`

/** Where Charrette keeps its profile on this platform, unless told otherwise. */
export const defaultProfile = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home = homedir()) => {
  if (env.CHARRETTE_PROFILE !== undefined && env.CHARRETTE_PROFILE !== '') return env.CHARRETTE_PROFILE
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Charrette')
  return join(env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '' ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'charrette')
}

/** Where task worktrees go (ADR-006), unless told otherwise. */
export const defaultWorktrees = (env: NodeJS.ProcessEnv, home = homedir()) =>
  env.CHARRETTE_WORKTREES !== undefined && env.CHARRETTE_WORKTREES !== '' ? env.CHARRETTE_WORKTREES : join(home, 'Charrette')

/** Reads the arguments, or says what is wrong with them. */
export const parseOptions = (
  args: ReadonlyArray<string>,
  defaults: { readonly profile: string; readonly worktrees: string },
): { readonly options: Options } | { readonly error: string } => {
  const flags = new Map<string, string>()
  const positional: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg.startsWith('--')) {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value.` }
      flags.set(arg.slice(2), value)
      index += 1
    } else {
      positional.push(arg)
    }
  }
  const unknown = [...flags.keys()].find((flag) => !['task', 'agent', 'model', 'profile', 'worktrees'].includes(flag))
  if (unknown !== undefined) return { error: `There is no --${unknown} option.` }
  const [folder, ...extra] = positional
  if (folder === undefined) return { error: 'Name the folder to open.' }
  if (extra.length > 0) return { error: `One folder at a time; also got ${extra.join(', ')}.` }
  const task = flags.get('task')
  if (task === undefined || task.trim() === '') return { error: 'Give the task a title with --task.' }
  const model = flags.get('model')
  return {
    options: {
      folder,
      task: task.trim(),
      agent: flags.get('agent') ?? 'claude-code',
      ...(model === undefined ? {} : { model }),
      profile: flags.get('profile') ?? defaults.profile,
      worktrees: flags.get('worktrees') ?? defaults.worktrees,
    },
  }
}
