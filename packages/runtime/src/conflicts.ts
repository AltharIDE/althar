import { Effect, Schema } from 'effect'

import { commitOf, git, gitOutcome } from './git'

/*
 * A lead resolving a conflict with its default branch on its own, where the
 * project's rules say to (docs/architecture/06, "Resolving a conflict"):
 * what Althar asks it, how it tells the lead resolved it, and what of its
 * work Althar may push. Found by merging here or said by a pull request's
 * host, a conflict is the lead's to resolve: it merges the branch it
 * conflicts with into its own, settles each conflict, runs the checks and
 * commits. When its turn ends Althar looks at the branch, not at what it
 * said: the branch it conflicted with is in it, nothing is left half merged,
 * and no file it conflicted in still has markers. One that isn't is asked
 * once more, with why; then it is the person's.
 */

/** How many times the lead is asked before a conflict goes back to the person. */
export const ATTEMPTS = 2

/** What conflicts in one of the task's repositories, and where things stood as the lead was asked. */
export const Conflict = Schema.Struct({
  /** The repository, by its slug, and by its name. */
  repository: Schema.String,
  name: Schema.String,
  /** The branch it conflicts with, and what the lead merges for it: `main` here, `origin/main` for a pull request. */
  branch: Schema.String,
  ref: Schema.String,
  /** Where that branch was, and the task's own, when the lead was asked. */
  target: Schema.String,
  from: Schema.String,
  /** For a pull request: what its host had of the branch then. */
  pushed: Schema.optional(Schema.NullOr(Schema.String)),
  files: Schema.Array(Schema.String),
})
export type Conflict = typeof Conflict.Type

export const Conflicts = Schema.Array(Conflict)

/** Where the task's branches were when a round ended, by repository. */
export const Ended = Schema.Array(Schema.Struct({ repository: Schema.String, head: Schema.String }))
export type Ended = typeof Ended.Type

/** What a round is about, for its words: the pull request it is on (`PR #1`), or none for merging here. */
export interface Place {
  readonly change: string | null
}

const list = (files: ReadonlyArray<string>) => files.join(', ')

/** Where it conflicts, in a line: "main, in README.md", or for several "web’s develop, in README.md; api’s main, in a.ts". */
export const whereLine = (conflicts: ReadonlyArray<Conflict>) =>
  conflicts.length === 1 && conflicts[0] !== undefined
    ? `${conflicts[0].branch}, in ${list(conflicts[0].files)}`
    : conflicts.map((one) => `${one.name}’s ${one.branch}, in ${list(one.files)}`).join('; ')

/**
 * What the lead is asked. Merging here, the note the person sends with
 * "Ask the lead to resolve it" (the desktop's TaskView), in the same words;
 * for a pull request, the branch Althar fetched for it, and that Althar
 * pushes the merge. Either way, what to do when it can't.
 */
export const noteFor = (conflicts: ReadonlyArray<Conflict>, place: Place, failure: string | null) => {
  const [only] = conflicts
  const asked =
    conflicts.length === 1 && only !== undefined
      ? place.change === null
        ? `${only.branch} has moved on, and merging this task's branch into it conflicts in ${list(only.files)}. Bring the branch up to date: merge ${only.ref} into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge.`
        : `${only.branch} has moved on, and ${place.change} conflicts with it in ${list(only.files)}. Bring the branch up to date: merge ${only.ref} into it, which Althar has fetched, settle each conflict so both sides' changes hold, run the checks, and commit the merge.`
      : `The default branches have moved on, and merging this task's branches into them conflicts: ${conflicts.map((one) => `in ${one.name}, ${one.branch} conflicts in ${list(one.files)}`).join('; ')}. Bring each branch up to date: merge its default branch into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge.`
  const after =
    place.change === null
      ? "Then say it's ready to merge again."
      : `Althar pushes the merge to ${place.change} once it is committed, with any fix the checks needed: don't push it yourself.`
  const stuck =
    "If you can't settle a conflict, or the checks fail and you can't fix them, don't commit the merge: undo it with git merge --abort, and say why."
  return [...(failure === null ? [] : [`The conflict isn't resolved yet: ${failure} Try once more.`]), asked, after, stuck].join(' ')
}

/** Why a repository's conflict isn't resolved, in a sentence; null where it is. */
export const unresolved = (worktree: string, conflict: Conflict) =>
  Effect.gen(function* () {
    // Half merged: git still has the merge under way, or files it couldn't merge.
    const merging = (yield* gitOutcome(worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).code === 0
    const stillConflicted = (yield* git(worktree, '-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U')).split('\n')
    const unmerged = stillConflicted.filter((file) => file !== '')
    if (unmerged.length > 0) return `${list(unmerged)} still ${unmerged.length === 1 ? 'conflicts' : 'conflict'}.`
    if (merging) return `The merge of ${conflict.ref} isn't committed.`
    const head = yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
    if (head === '' || (yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', conflict.target, head)).code !== 0)
      return `${conflict.ref} isn't merged into the branch.`
    // Committed with its markers left in: the conflict is in the commit, not settled.
    const marked = yield* gitOutcome(worktree, 'grep', '-l', '-E', '^(<<<<<<<|>>>>>>>)( |$)', head, '--', ...conflict.files)
    const markers = marked.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.slice(line.indexOf(':') + 1))
    if (markers.length > 0)
      return `${list(markers)} still ${markers.length === 1 ? 'has' : 'have'} conflict markers in ${markers.length === 1 ? 'it' : 'them'}.`
    return null
  })

/**
 * Whether what the branch has over `from`, up to `head`, is the resolution
 * alone: the merge of the branch it conflicted with, made on `from`, then
 * any commits on top of it, such as a fix the checks needed. Anything else,
 * such as a commit of other work before the merge, or another branch merged
 * in, isn't Althar's to push.
 */
export const onlyTheResolution = (worktree: string, conflict: Conflict, head: string) =>
  Effect.gen(function* () {
    const lines = (text: string) => text.split('\n').filter((line) => line !== '')
    const line = lines(yield* git(worktree, 'rev-list', '--first-parent', '--reverse', `${conflict.from}..${head}`))
    const [merge, ...after] = line
    if (merge === undefined) return false
    const parents = lines(yield* git(worktree, 'rev-list', '--parents', '-n', '1', merge))
      .join(' ')
      .split(' ')
      .slice(1)
    if (parents.length !== 2 || parents[0] !== conflict.from) return false
    // What it merged is the branch it conflicted with, as fetched: nothing of its own.
    if ((yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', parents[1] ?? '', conflict.target)).code !== 0) return false
    // The commits after it are the branch's own line alone, with no other merge.
    for (const commit of after) {
      const count = lines(yield* git(worktree, 'rev-list', '--parents', '-n', '1', commit))
        .join(' ')
        .split(' ').length
      if (count !== 2) return false
    }
    // Nothing came in that isn't on the line or in the branch it conflicted with.
    const brought = lines(yield* git(worktree, 'rev-list', `${conflict.from}..${head}`, '--not', conflict.target))
    return brought.every((commit) => line.includes(commit))
  })
