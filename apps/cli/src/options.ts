import { chosenWorktrees, usableNow, worktreesFrom } from '@althar/runtime/locations'

/*
 * The command line: which folder to open, the task to start, the agent to
 * start it on, and where the profile and worktrees live. Without --worktrees,
 * new tasks' folders go where the app's Settings says, for the profile used
 * (taskFolders), as the app's do.
 */

export interface Options {
  readonly folder: string
  readonly task: string
  readonly agent: string
  readonly model?: string
  readonly profile: string
  readonly worktrees: string
}

export const USAGE = `Usage: althar <folder> --task "<title>" [--agent claude-code|codex|opencode] [--model <id>]
                 [--profile <dir>] [--worktrees <dir>]

Opens <folder> as a project, starts the task in a worktree of its own, and
starts its agent. Then type to talk to the agent; /help lists the commands.`

export { defaultProfile, defaultWorktrees } from '@althar/runtime/locations'

/**
 * Where new tasks' folders go, for a profile, as the app has it (`worktreesFrom`): ALTHAR_WORKTREES, else the folder chosen in its
 * Settings, else the default. A chosen folder that can't be used now, such as a drive not connected, is never made: the default stands
 * in, and `unusable` says which it was.
 */
export const taskFolders = (
  env: NodeJS.ProcessEnv,
  profile: string,
  fallback: string,
  chosen: (profile: string) => string | null = chosenWorktrees,
  usable: (folder: string) => boolean = usableNow,
): { readonly folder: string; readonly unusable?: string } => {
  const now = worktreesFrom(env, chosen(profile), fallback)
  return now.from === 'setting' && !usable(now.folder) ? { folder: fallback, unusable: now.folder } : { folder: now.folder }
}

/** Reads the arguments, or says what is wrong with them. Where new tasks' folders go, unless --worktrees says, is asked of the profile used. */
export const parseOptions = (
  args: ReadonlyArray<string>,
  defaults: { readonly profile: string; readonly worktrees: (profile: string) => string },
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
  const profile = flags.get('profile') ?? defaults.profile
  return {
    options: {
      folder,
      task: task.trim(),
      agent: flags.get('agent') ?? 'claude-code',
      ...(model === undefined ? {} : { model }),
      profile,
      worktrees: flags.get('worktrees') ?? defaults.worktrees(profile),
    },
  }
}
