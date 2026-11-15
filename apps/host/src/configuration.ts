import { isAbsolute, join, resolve } from 'node:path'

import { Effect, Schema } from 'effect'

import { HostError, storageFailure } from './errors'
import type { HostOptions } from './options'
import { privateDirectory, readPrivate, writePrivate } from './privateFiles'

const Configuration = Schema.Struct({ version: Schema.Literal(1), worktrees: Schema.String })

/** Stored paths win over defaults; an explicit change requires a stopped, deliberate migration. */
export const configuredHome = (options: HostOptions, initialize = false) =>
  Effect.tryPromise({
    try: async () => {
      const profile = await privateDirectory(options.profile, initialize)
      const path = join(profile, 'host.json')
      let stored = await readPrivate(path, 4096)
      if (stored === null) {
        if (!initialize)
          throw new HostError({ code: 'NotInitialized', message: 'This host has not been initialized. Run althar-host init first.' })
        const worktrees = await privateDirectory(options.worktrees, true)
        await writePrivate(path, JSON.stringify({ version: 1, worktrees }), false)
        stored = await readPrivate(path, 4096)
      }
      let config: typeof Configuration.Type
      try {
        config = Schema.decodeUnknownSync(Configuration)(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored ?? Buffer.alloc(0))),
        )
      } catch {
        throw new HostError({ code: 'InvalidConfig', message: 'The host configuration is invalid. Restore its original host.json.' })
      }
      if (
        !isAbsolute(config.worktrees) ||
        Array.from(config.worktrees).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      )
        throw new HostError({
          code: 'InvalidConfig',
          message: 'The stored worktree location must be an absolute path without control characters.',
        })
      if (options.worktreesExplicit && (await privateDirectory(options.worktrees)) !== config.worktrees)
        throw new HostError({
          code: 'InvalidConfig',
          message: 'This host already has a different worktree location. Migrate its workspaces explicitly before changing that location.',
        })
      // Missing disks and directories must not turn into a fresh, empty workspace location on restart.
      const worktrees = await privateDirectory(resolve(config.worktrees))
      return { ...options, profile, worktrees }
    },
    catch: storageFailure,
  })
