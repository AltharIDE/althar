import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { defaultProfile, defaultWorktrees } from '@althar/runtime/locations'

/*
 * The profile and worktrees, as the command-line client has them, so both see
 * the same projects. A Flatpak's home is a fresh empty one each run, so there
 * the worktrees live beside the profile, where they last; every other way of
 * running — macOS, AppImage, deb, rpm — keeps them where the CLI does.
 *
 * Where new tasks' worktrees go is, in order: ALTHAR_WORKTREES where the
 * environment sets it, the folder the person chose in Settings, else where
 * the platform keeps them. Worktrees already made stay where they are: the
 * store holds their paths.
 */

/** Who decided where task folders go. */
export type TaskFolderFrom = 'environment' | 'setting' | 'default'

export const taskFolder = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  exists: (path: string) => boolean = existsSync,
  chosen: string | null = null,
): { readonly profile: string; readonly folder: string; readonly from: TaskFolderFrom } => {
  const profile = defaultProfile(env, platform, home, exists)
  if (env.ALTHAR_WORKTREES !== undefined && env.ALTHAR_WORKTREES !== '')
    return { profile, folder: env.ALTHAR_WORKTREES, from: 'environment' }
  if (chosen !== null) return { profile, folder: chosen, from: 'setting' }
  const folder = env.FLATPAK_ID === undefined ? defaultWorktrees(env, home, exists) : join(profile, 'worktrees')
  return { profile, folder, from: 'default' }
}

export const locations = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  exists: (path: string) => boolean = existsSync,
  chosen: string | null = null,
) => {
  const { profile, folder } = taskFolder(env, platform, home, exists, chosen)
  return { profile, worktrees: folder }
}
