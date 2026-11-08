import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/*
 * Where Althar keeps a person's profile and their tasks' worktrees, unless
 * told otherwise, and the database in a profile. Until October 2026 Althar
 * was called Charrette. Where Charrette's folders are on this machine and
 * Althar's aren't, Charrette's are used as they are: the profile holds paths
 * inside both, such as accounts' homes and worktrees, so moving them would
 * break what it holds.
 */

type Exists = (path: string) => boolean

/** What the environment says, where it says anything. */
const given = (env: NodeJS.ProcessEnv, name: string) => (env[name] === '' ? undefined : env[name])

/** Althar's folder, or the one Charrette left where only that one is there. */
const either = (path: string, former: string, exists: Exists) => (!exists(path) && exists(former) ? former : path)

/** Where the profile is on this platform, unless told otherwise. */
export const defaultProfile = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home = homedir(), exists: Exists = existsSync) => {
  const told = given(env, 'ALTHAR_PROFILE')
  if (told !== undefined) return told
  if (platform === 'darwin') {
    const data = join(home, 'Library', 'Application Support')
    return either(join(data, 'Althar'), join(data, 'Charrette'), exists)
  }
  const data = given(env, 'XDG_DATA_HOME') ?? join(home, '.local', 'share')
  return either(join(data, 'althar'), join(data, 'charrette'), exists)
}

/** Where task worktrees go (ADR-006), unless told otherwise. */
export const defaultWorktrees = (env: NodeJS.ProcessEnv, home = homedir(), exists: Exists = existsSync) =>
  given(env, 'ALTHAR_WORKTREES') ?? either(join(home, 'Althar'), join(home, 'Charrette'), exists)

/**
 * The folder the person chose for new tasks' folders in the app's Settings, as the app keeps it: `worktrees` in the profile's
 * desktop.json, beside its other preferences. The command line shares the profile, so it reads the same choice. Null where none is
 * chosen, or the file can't be read.
 */
export const chosenWorktrees = (profile: string, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): string | null => {
  try {
    const kept: unknown = JSON.parse(read(join(profile, 'desktop.json')))
    const chosen = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>).worktrees : undefined
    return typeof chosen === 'string' && isAbsolute(chosen) ? chosen : null
  } catch {
    return null
  }
}

/** Who decided where new tasks' folders go. */
export type WorktreesFrom = 'environment' | 'setting' | 'default'

/**
 * Where new tasks' worktrees go, and who decided, in order: ALTHAR_WORKTREES where the environment sets it, the folder the person
 * chose in Settings, else `fallback`, where the platform keeps them. Worktrees already made stay where they are: the store holds their paths.
 */
export const worktreesFrom = (
  env: NodeJS.ProcessEnv,
  chosen: string | null,
  fallback: string,
): { readonly folder: string; readonly from: WorktreesFrom } => {
  const told = given(env, 'ALTHAR_WORKTREES')
  if (told !== undefined) return { folder: told, from: 'environment' }
  if (chosen !== null) return { folder: chosen, from: 'setting' }
  return { folder: fallback, from: 'default' }
}

/** Whether a chosen folder can take new tasks' folders now: a folder that is there and can be written, so a drive not connected is never made. */
export const usableNow = (folder: string): boolean => {
  try {
    if (!statSync(folder).isDirectory()) return false
    accessSync(folder, constants.W_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The profile's database, under the name Charrette gave it in a profile it left. */
export const databaseIn = (profile: string, exists: Exists = existsSync) =>
  either(join(profile, 'althar.sqlite'), join(profile, 'charrette.sqlite'), exists)

/** Where the store copies itself before an update migrates it: the newest three copies. */
export const backupsIn = (profile: string) => join(profile, 'backups')

/** The folders under home a coordinator's sandboxed command may read (ADR-058): toolchains, never a folder that holds a key. A task folder can't be inside one. */
export const TOOLCHAINS = [
  '.bun',
  '.nvm',
  '.volta',
  '.fnm',
  '.local/share/fnm',
  '.local/share/mise',
  '.asdf',
  '.deno',
  '.cargo/bin',
  '.rustup',
  '.pyenv',
  '.local/bin',
  '.gitconfig',
]
