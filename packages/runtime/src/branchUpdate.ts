import type { ChangeRequest, PushTarget } from '@althar/connectors'
import { Effect } from 'effect'

import { commitOf, fetchRefs, git, gitOutcome, PUSHED, pushTo } from './git'

/*
 * Bringing a pull request's branch up to date with its target where the
 * host has no call for it (GitLab, Bitbucket Cloud and Data Center), for the
 * merge line (ADR-081, task 5): Althar's own merge of the target in, made
 * without a working tree in the project's repository on this computer, and
 * pushed plainly, never forced, so a push someone made meanwhile refuses it.
 * Never a rebase, and never an outside author's fork.
 *
 * TODO(bring-a-pr-s-branch-up-to-date-with-main): ADR-081's task 6 brings
 * `update_branch` for the coordinator and leads, forks included; this is the
 * minimal step the merge line needs until then, and it replaces it.
 */

/** What bringing a branch up to date did. */
export type BranchUpdate =
  /** Pushed: the merge commit its branch is at now. */
  | { readonly kind: 'pushed'; readonly head: string }
  /** It has its target's head already. */
  | { readonly kind: 'current' }
  /** Its branch isn't at the head read: read it again. */
  | { readonly kind: 'moved' }
  /** The merge conflicts, in these files. */
  | { readonly kind: 'conflicts'; readonly files: ReadonlyArray<string> }
  /** Althar can't from here, and why, in a few words. */
  | { readonly kind: 'cannot'; readonly reason: string }

const cannot = (reason: string): BranchUpdate => ({ kind: 'cannot', reason })

/** Merges `change`'s target into its branch in the repository at `root`, and pushes it to `target`, at the head read. */
export const mergeTargetIn = (root: string, target: PushTarget, change: ChangeRequest) =>
  Effect.gen(function* () {
    if (change.headSha === null) return cannot('it has no commits')
    if (change.headRepository !== undefined && change.headRepository !== null) return cannot('its branch is on a fork')
    const refs = `refs/althar/merge-line/${change.number}`
    const fetched = yield* fetchRefs(root, target, [
      { from: `refs/heads/${change.source}`, into: `${refs}/head` },
      { from: `refs/heads/${change.target}`, into: `${refs}/target` },
    ])
    if (!fetched) return cannot('its branches couldn’t be fetched')
    const head = yield* commitOf(root, `${refs}/head`)
    if (head !== change.headSha) return { kind: 'moved' } satisfies BranchUpdate
    const tip = yield* commitOf(root, `${refs}/target`)
    if ((yield* gitOutcome(root, 'merge-base', '--is-ancestor', tip, head)).code === 0) return { kind: 'current' } satisfies BranchUpdate
    const merged = yield* gitOutcome(root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', head, tip)
    const [tree, ...rest] = merged.stdout.split('\n')
    if (merged.code === 1) return { kind: 'conflicts', files: rest.filter((line) => line !== '') } satisfies BranchUpdate
    if (merged.code !== 0 || tree === undefined || tree === '') return cannot('git couldn’t merge it here')
    const made = yield* git(root, 'commit-tree', tree, '-p', head, '-p', tip, '-m', `Merge branch '${change.target}' into ${change.source}`)
    // Plainly: a push someone made since the fetch isn't a fast-forward from here, and is refused.
    const pushed = yield* pushTo(root, target, `merge-line/${change.number}`, made, undefined, change.source).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    return pushed ? ({ kind: 'pushed', head: made } satisfies BranchUpdate) : ({ kind: 'moved' } satisfies BranchUpdate)
  }).pipe(
    // The refs it fetched into and pushed from go: nothing of it is left in the person's repository.
    Effect.ensuring(
      Effect.forEach(
        [
          `refs/althar/merge-line/${change.number}/head`,
          `refs/althar/merge-line/${change.number}/target`,
          `${PUSHED}merge-line/${change.number}`,
        ],
        (ref) => Effect.ignore(git(root, 'update-ref', '-d', ref)),
      ),
    ),
    Effect.catchTag('GitFailed', () => Effect.succeed(cannot('git couldn’t merge it here'))),
  )
