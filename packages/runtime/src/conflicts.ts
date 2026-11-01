import { Duration, Effect, Schema } from 'effect'

import { commitOf, git, gitOutcome } from './git'

/*
 * A lead resolving a conflict with its default branch on its own, where the
 * project's rules say to (docs/architecture/06, "Resolving a conflict"):
 * what Althar asks it, how it tells the lead resolved it, and what of its
 * work Althar may push. Found by merging here or said by a pull request's
 * host, a conflict is the lead's to resolve: it merges the branch it
 * conflicts with into its own, settles each conflict, runs the quick checks
 * and commits the merge before anything slow. When it is done, its turn over
 * and nothing it left running still going (leftRunning.ts, `stillBusy`),
 * Althar looks at the branch, not at what it said: the branch it conflicted
 * with is in it, nothing is left half merged, and no file it conflicted in
 * still has markers. One that isn't is asked once more, with why; then it is
 * the person's.
 *
 * What Althar pushes for it is the merge, made on the branch as the pull
 * request had it, with at most the one commit the lead makes on top of it to
 * fix what the full tests found; then, should the pull request's checks fail
 * on that, the one commit the lead makes on top of it when asked to fix
 * them. Anything else on the branch is the person's to push.
 */

/**
 * How many times the lead is asked before a conflict goes back to the person:
 * to resolve it, or to fix the checks that failed on what Althar pushed.
 */
export const ATTEMPTS = 2

/** How long a pull request may have no checks on what Althar pushed before none are taken to be coming. */
export const NO_CHECKS_AFTER = Duration.minutes(2)

/**
 * How long a round waits for a lead whose turn has ended but that is still
 * at work, such as on full test suites it left running, before it looks at
 * the branch as it is: a slow machine takes a while to run them.
 */
export const BUSY_UP_TO = Duration.minutes(45)

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

/** The pull request a round is on, by name: one merging here has none, so it is only ever asked of a round on one. */
export const changeOf = (place: Place) => place.change ?? 'the pull request'

/** Every file it conflicts in, as the lead is told. */
const list = (files: ReadonlyArray<string>) => files.join(', ')

/** The files it conflicts in, as the person reads it: the one by its path, or how many. */
const counted = (files: ReadonlyArray<string>) => (files.length === 1 ? (files[0] ?? '') : `${files.length} files`)

/** Where it conflicts, in a line: "main, in README.md", "main, in 4 files", or for several "the default branch in 2 repositories". */
export const whereLine = (conflicts: ReadonlyArray<Conflict>) =>
  conflicts.length === 1 && conflicts[0] !== undefined
    ? `${conflicts[0].branch}, in ${counted(conflicts[0].files)}`
    : `the default branch in ${conflicts.length} repositories`

const named = (files: ReadonlyArray<string>) => {
  const names = files.map((file) => file.slice(file.lastIndexOf('/') + 1))
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown
}

/** Where it conflicts, short for a card: files by name, three at most: "main in a.ts, b.ts and 3 more". */
export const shortWhereLine = (conflicts: ReadonlyArray<Conflict>) =>
  conflicts.length === 1 && conflicts[0] !== undefined
    ? `${conflicts[0].branch} in ${named(conflicts[0].files)}`
    : conflicts.map((one) => `${one.name}’s ${one.branch} in ${named(one.files)}`).join('; ')

/**
 * What the lead is asked. Merging here, the note the person sends with
 * "Ask the lead to resolve it" (the desktop's TaskView), in the same words;
 * for a pull request, the branch Althar fetched for it, and that Althar
 * pushes the merge. Either way, to commit the merge before anything slow and
 * before it ends its turn, and what to do when it can't. Asked once more
 * where all that was left was to commit the merge (`uncommitted`), it is
 * told so, rather than asked to resolve it again.
 */
export const noteFor = (
  conflicts: ReadonlyArray<Conflict>,
  place: Place,
  failure: string | null,
  uncommitted: ReadonlyArray<Conflict> = [],
) => {
  const [only] = conflicts
  const asked =
    conflicts.length === 1 && only !== undefined
      ? place.change === null
        ? `${only.branch} has moved on, and merging this task's branch into it conflicts in ${list(only.files)}. Bring the branch up to date: merge ${only.ref} into it, settle each conflict so both sides' changes hold, run the quick checks, and commit the merge.`
        : `${only.branch} has moved on, and ${place.change} conflicts with it in ${list(only.files)}. Bring the branch up to date: merge ${only.ref} into it, which Althar has fetched, settle each conflict so both sides' changes hold, run the quick checks, and commit the merge.`
      : `The default branches have moved on, and merging this task's branches into them conflicts: ${conflicts.map((one) => `in ${one.name}, ${one.branch} conflicts in ${list(one.files)}`).join('; ')}. Bring each branch up to date: merge its default branch into it, settle each conflict so both sides' changes hold, run the quick checks, and commit the merge.`
  const commitFirst =
    "Commit the merge as soon as the conflicts are settled and the quick checks pass, before you run the full test suites: don't end your turn with the merge uncommitted, or while you wait on something running in the background."
  const followUp =
    place.change === null
      ? 'If the full tests then find something, fix it in a follow-up commit on top of the merge.'
      : `If the full tests then find something, fix it in one follow-up commit on top of the merge, and commit nothing else on top of it: Althar pushes the merge and that fix to ${place.change}. Don't push it yourself.`
  // A rebase would rewrite what was pushed, and the pull request take no plain push of it.
  const merge = "Merge, don't rebase: a branch that was pushed can't be rewritten."
  const after = place.change === null ? "Then say it's ready to merge again." : ''
  const stuck =
    "If you can't settle a conflict, or the quick checks fail and you can't fix them, don't commit the merge: undo it with git merge --abort, and say why."
  // Everything is settled, and the merge only needs committing: say so plainly, not the whole ask again.
  if (failure !== null && uncommitted.length > 0) {
    const named = uncommitted.map((one) => one.name).join(' and ')
    const resolved =
      uncommitted.length > 1
        ? `Your merges in ${named} are resolved but not committed: commit each.`
        : `Your merge${conflicts.length === 1 ? '' : ` in ${named}`} is resolved but not committed: commit it.`
    return [
      resolved,
      "Don't end your turn with the merge uncommitted, or while you wait on something running in the background.",
      merge,
      followUp,
      after,
    ]
      .filter((part) => part !== '')
      .join(' ')
  }
  return [
    ...(failure === null ? [] : [`The conflict isn't resolved yet: ${failure} Try once more.`]),
    asked,
    merge,
    commitFirst,
    followUp,
    after,
    stuck,
  ]
    .filter((part) => part !== '')
    .join(' ')
}

/**
 * What the lead is asked when the pull request's checks fail on what Althar
 * pushed for it: in the words failed checks always come in, saying what
 * Althar pushes this time.
 */
export const fixNoteFor = (place: Place, failed: { readonly failing: ReadonlyArray<string>; readonly logs: ReadonlyArray<string> }) =>
  [
    `Checks failed on the merge Althar pushed to ${changeOf(place)}: ${failed.failing.join(', ')}.`,
    ...failed.logs,
    'Read more with read_checks: list jobs, read a tail or search, or compare ref main.',
    `Fix what broke and commit the fix as one commit on top of the merge, with nothing else: Althar pushes it to ${changeOf(place)} too. Don't push it yourself. If it isn't the task's to fix, commit nothing and say why.`,
  ].join('\n\n')

/** Why a repository's conflict isn't resolved, in a sentence; and whether all that is left is to commit the merge. */
export interface Unresolved {
  readonly why: string
  readonly uncommitted: boolean
}

/** What stands in the way of a repository's conflict being resolved; null where nothing does. */
export const unresolved = (worktree: string, conflict: Conflict) =>
  Effect.gen(function* () {
    // Half merged: git still has the merge under way, or files it couldn't merge.
    const merging = (yield* gitOutcome(worktree, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).code === 0
    const stillConflicted = (yield* git(worktree, '-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U')).split('\n')
    const unmerged = stillConflicted.filter((file) => file !== '')
    if (unmerged.length > 0)
      return { why: `${counted(unmerged)} still ${unmerged.length === 1 ? 'conflicts' : 'conflict'}.`, uncommitted: false }
    // Every file is settled; the merge only needs committing.
    if (merging) return { why: `The merge of ${conflict.ref} isn't committed.`, uncommitted: true }
    const head = yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
    if (head === '' || (yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', conflict.target, head)).code !== 0)
      return { why: `${conflict.ref} isn't merged into the branch.`, uncommitted: false }
    // Committed with its markers left in: the conflict is in the commit, not settled.
    const marked = yield* gitOutcome(worktree, 'grep', '-l', '-E', '^(<<<<<<<|>>>>>>>)( |$)', head, '--', ...conflict.files)
    const markers = marked.stdout
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.slice(line.indexOf(':') + 1))
    if (markers.length > 0)
      return {
        why: `${counted(markers)} still ${markers.length === 1 ? 'has' : 'have'} conflict markers in ${markers.length === 1 ? 'it' : 'them'}.`,
        uncommitted: false,
      }
    return null
  })

const linesOf = (text: string) => text.split('\n').filter((line) => line !== '')

/** A commit's parents. */
const parentsOf = (worktree: string, commit: string) =>
  Effect.map(git(worktree, 'rev-list', '--parents', '-n', '1', commit), (text) => linesOf(text).join(' ').split(' ').slice(1))

/**
 * What the branch has over `from`, up to `head`, when it is the resolution
 * alone: one merge, made on `from`, of the branch it conflicted with, and
 * nothing before it, with at most one commit after it, the fix for what the
 * full tests found, as the lead is asked and as a fix for the checks that
 * failed is (`onlyTheFix`). The merge alone is `merge`; with that fix,
 * `merge and fix`. A fix the quick checks needed is in the merge, as the
 * lead is asked. Anything else, such as more commits of other work after the
 * merge, or another branch merged in, isn't Althar's to push: null.
 */
export const onlyTheResolution = (worktree: string, conflict: Conflict, head: string) =>
  Effect.gen(function* () {
    const line = linesOf(yield* git(worktree, 'rev-list', '--first-parent', `${conflict.from}..${head}`))
    const merge = line[line.length - 1]
    if (line.length < 1 || line.length > 2 || line[0] !== head || merge === undefined) return null
    // The fix is a plain commit made on the merge.
    if (line.length === 2 && (yield* parentsOf(worktree, head)).join(' ') !== merge) return null
    const parents = yield* parentsOf(worktree, merge)
    if (parents.length !== 2 || parents[0] !== conflict.from) return null
    // What it merged is the branch it conflicted with, as fetched: nothing of its own.
    if ((yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', parents[1] ?? '', conflict.target)).code !== 0) return null
    // Nothing came in that isn't the merge, the fix, or in the branch it conflicted with.
    const brought = linesOf(yield* git(worktree, 'rev-list', `${conflict.from}..${head}`, '--not', conflict.target))
    if (brought.length !== line.length || !line.every((commit) => brought.includes(commit))) return null
    return line.length === 1 ? ('merge' as const) : ('merge and fix' as const)
  })

/**
 * Whether what the branch has over `base`, what Althar pushed, up to `head`
 * is the fix alone: one commit, made on it, as the lead is asked to fix the
 * checks that failed there. More than one, such as other work after the fix,
 * isn't Althar's to push.
 */
export const onlyTheFix = (worktree: string, base: string, head: string) =>
  Effect.gen(function* () {
    const all = linesOf(yield* git(worktree, 'rev-list', `${base}..${head}`))
    if (all.length !== 1 || all[0] !== head) return false
    const parents = yield* parentsOf(worktree, head)
    return parents.length === 1 && parents[0] === base
  })
