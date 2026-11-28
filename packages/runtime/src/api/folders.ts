import type { ApiHandlers, StorageSize } from '@althar/contracts'
import { Effect } from 'effect'

import { RuntimeConfig } from '../Config'
import { storageSizes } from '../StorageSizes'
import { FolderCleanup } from '../FolderCleanup'
import type { ApiKit } from './kit'

/**
 * Finished tasks' folders on this computer and the storage Althar takes.
 * Cleaning them up, removing one, and when they go.
 */
export const foldersHandlers = ({ actorId, api }: ApiKit) =>
  Effect.gen(function* () {
    const cleanup = yield* FolderCleanup
    const config = yield* RuntimeConfig
    // What About › Storage measures: kept for the session, and stopped when the window gives up.
    const sizes =
      config.storage === undefined
        ? undefined
        : storageSizes({ profile: config.storage.profile, logs: config.storage.logs, worktrees: config.worktreeRoot })
    const sizesChanged = Effect.sync(() => sizes?.forget('worktrees'))
    return {
      SetFolderWait: ({ wait }) => api(cleanup.setWait(wait)),
      GetTaskFolders: () => api(cleanup.list),
      GetStorageSize: ({ place, refresh }) =>
        api(
          sizes === undefined
            ? Effect.succeed<StorageSize>({ state: 'failed' })
            : Effect.promise((signal) => sizes.size(place, refresh, signal).catch(() => ({ state: 'failed' }) as const)),
        ),
      // Folders removed (or some, before a failure): the task folders' kept size no longer holds.
      CleanUpFolders: () => api(cleanup.cleanUp(actorId).pipe(Effect.ensuring(sizesChanged))),
      RemoveTaskFolder: ({ taskId, seen }) => api(cleanup.remove(taskId, seen, actorId).pipe(Effect.ensuring(sizesChanged))),
    } satisfies Partial<ApiHandlers>
  })
