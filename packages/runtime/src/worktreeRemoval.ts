import { removeFully } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { git } from './git'

/** Removes a registered worktree, preserving locks and retrying a busy Windows folder through the filesystem. */
export const removeWorktree = (repository: string, path: string) =>
  git(repository, 'worktree', 'remove', path).pipe(
    Effect.catch((first) =>
      git(repository, 'worktree', 'remove', '--force', path).pipe(
        Effect.catch((forced) => {
          const locked = /cannot remove a locked working tree/i
          const busy = /permission denied|resource busy|directory not empty/i
          // Git may unregister the worktree despite failing to delete its folder. The forced attempt then
          // says it isn't a worktree; that is recoverable only after a filesystem failure on the first attempt.
          const partial = busy.test(first.stderr) && /is not a working tree/i.test(forced.stderr)
          return !locked.test(first.stderr) && !locked.test(forced.stderr) && (busy.test(forced.stderr) || partial)
            ? Effect.andThen(removeFully(path), git(repository, 'worktree', 'prune'))
            : Effect.fail(forced)
        }),
      ),
    ),
  )
