import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** The profile's database, under the name Charrette gave it in a profile it left. */
export const databaseIn = (profile: string, exists: Exists = existsSync) =>
  either(join(profile, 'althar.sqlite'), join(profile, 'charrette.sqlite'), exists)
