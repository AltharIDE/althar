import { Effect } from 'effect'

import { type Fork, forkOf, parentRemote } from './forks'
import { defaultBranch, namedRemotes } from './git'

/*
 * Where a task's work starts in a repository (ADR-093, DEV-171), as making
 * its worktree, its branches and its runs read it.
 */

/** The fork a repository's clone is here, read from its remotes; none where it has no clone here, or isn't one. */
export const forkAt = (path: string | null): Effect.Effect<Fork | null> =>
  path === null
    ? Effect.succeed(null)
    : namedRemotes(path).pipe(
        Effect.map(forkOf),
        Effect.orElseSucceed(() => null),
      )

/**
 * Where a task starts in a repository: the branch it works toward, else its
 * default branch; for a fork whose work goes to the repository it came from,
 * on that repository, its default branch there unless it works toward
 * another.
 */
export const startOf = (binding: {
  readonly repository: string
  readonly base: string | null
  readonly changeTarget: string | null
  readonly toward?: string | null
}) =>
  Effect.gen(function* () {
    // From the repository it was forked from, by whatever name the clone has it; one the clone hasn't as a remote, from origin.
    const upstream =
      binding.changeTarget === 'upstream' || binding.changeTarget === 'upstream_branch'
        ? parentRemote(yield* forkAt(binding.repository))
        : null
    const toward = binding.toward ?? null
    return upstream !== null
      ? { remote: upstream, base: toward ?? (yield* defaultBranch(binding.repository, upstream)) }
      : { remote: 'origin', base: toward ?? binding.base ?? 'main' }
  })
