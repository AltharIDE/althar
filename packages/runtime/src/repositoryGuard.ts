import { parseNulPaths } from '@althar/skills'
import { Effect } from 'effect'

import { gitExactly, gitOutcome } from './git'

/** Where commits come from that are already off the machine, or came onto it from elsewhere: not the task's to answer for. */
const ELSEWHERE = ['--remotes', '--glob=refs/althar/base/*', '--glob=refs/althar/pushed/*', '--glob=refs/althar/pull-request/*']

/**
 * The paths a push would send that the task's own commits changed: those in `head` that no remote, nor the default
 * branch Althar merged in, nor what it pushed before, already has, past `base` and `ref` (the repository's default
 * branch) where they are found. A merge counts only for what its resolution changed against every parent, so files
 * that came in with the default branch are not the task's, while a protected file slipped into a resolution is. From
 * git with NUL separators and no quoting, a rename as its old and new paths, so a special character or a rename
 * cannot hide a protected path. With nothing found to stop at, every commit in the head counts, so that a push is held
 * rather than let through unseen.
 */
export const pathsPushed = (cwd: string, base: string | null, head: string, ref?: string) =>
  Effect.gen(function* () {
    const stops = yield* stopsOf(cwd, base, ref)
    const listed = yield* gitExactly(
      cwd,
      'log',
      '-z',
      '--format=',
      '--name-only',
      '--no-renames',
      '--diff-merges=dense-combined',
      head,
      '--not',
      ...ELSEWHERE,
      ...stops,
    )
    return [...new Set(parseNulPaths(listed))]
  })

/** The commits `base` and `ref` name, where they are found. */
const stopsOf = (cwd: string, base: string | null, ref?: string) =>
  Effect.gen(function* () {
    const stops: Array<string> = []
    for (const candidate of [base, ref]) {
      if (candidate === null || candidate === undefined) continue
      const found = yield* gitOutcome(cwd, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`)
      if (found.code === 0 && found.stdout !== '') stops.push(found.stdout)
    }
    return stops
  })

/**
 * Legacy call boundary for pushes. Skill and OpenSpec paths have no special
 * permission: they are ordinary repository files (ADR-097). Git's separate
 * irreversible guard still holds force pushes and protected branch moves.
 */
export const guardPush = (_input: {
  readonly projectId: string
  readonly taskId: string
  readonly remote: string
  readonly cwd: string
  readonly base: string | null
  /** The repository's default branch, for a workspace with no recorded base commit. */
  readonly ref?: string
  readonly head: string
}) => Effect.void
