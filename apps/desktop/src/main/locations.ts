import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { defaultProfile, defaultWorktrees } from '@althar/runtime/locations'

/*
 * The profile and worktrees, as the command-line client has them, so both see
 * the same projects. A Flatpak's home is a fresh empty one each run, so there
 * the worktrees live beside the profile, where they last; every other way of
 * running — macOS, AppImage, deb, rpm — keeps them where the CLI does.
 */

export const locations = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
  exists: (path: string) => boolean = existsSync,
) => {
  const profile = defaultProfile(env, platform, home, exists)
  const worktrees = env.FLATPAK_ID === undefined ? defaultWorktrees(env, home, exists) : join(profile, 'worktrees')
  return { profile, worktrees }
}
