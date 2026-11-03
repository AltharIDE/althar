import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'

import { GitFailed } from './errors'
import { branchExists, commitOf, currentBranch, git, uncommittedFiles } from './git'

/*
 * A Local task works in its repository's own checkout, where the person works
 * (ADR-086). Althar reads it before it takes it, and never switches it while
 * it has changes not committed: no stash, reset or clean, ever. What it does
 * to it is two switches: to the task's branch, made at the start it planned,
 * as the task takes it, and back to the branch it was on, as the task is
 * settled, where it is clean and still on the task's branch.
 */

/** A checkout as a task finds it: the branch it is on (null, detached), its head, its files not committed, and git's own work under way. */
export interface Checkout {
  readonly branch: string | null
  readonly head: string
  /** Files changed, new or deleted and not committed, ignored files aside: the person's work, which nothing switches under. */
  readonly uncommitted: ReadonlyArray<string>
  /** A merge, rebase, cherry-pick or revert the person is in the middle of, which counts as changes not committed. */
  readonly midway: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
}

/** git's own files for a step under way, by what it is. */
const MIDWAY = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
] as const

/** Reads a checkout without changing anything. */
export const readCheckout = (path: string): Effect.Effect<Checkout, GitFailed> =>
  Effect.gen(function* () {
    const head = yield* git(path, 'rev-parse', '--verify', 'HEAD')
    const branch = (yield* currentBranch(path)) ?? null
    const uncommitted = yield* uncommittedFiles(path)
    const gitDir = yield* git(path, 'rev-parse', '--absolute-git-dir')
    const midway = MIDWAY.find(([file]) => existsSync(join(gitDir, file)))?.[1] ?? null
    return { branch, head, uncommitted, midway }
  })

/** Whether a checkout may be switched: nothing not committed, and no step of git's under way. */
export const isClean = (checkout: Checkout) => checkout.uncommitted.length === 0 && checkout.midway === null

/** Why a checkout can't be taken as it is, for the person to answer: changes not committed, or a branch of the person's own. */
export type Holdup =
  | { readonly kind: 'changes'; readonly files: ReadonlyArray<string> }
  | { readonly kind: 'branch'; readonly branch: string }

/**
 * What stands between a task and the checkout: its changes not committed (and a step of git's under way, which counts as them),
 * else a branch other than the one tasks start from, which is the person's to give up; nothing, clean on it or detached at it.
 */
export const holdupOf = (checkout: Checkout, base: string, baseCommit: string): Holdup | null => {
  if (!isClean(checkout)) return { kind: 'changes', files: checkout.uncommitted }
  if (checkout.branch === base) return null
  if (checkout.branch === null) return checkout.head === baseCommit ? null : { kind: 'branch', branch: checkout.head.slice(0, 7) }
  return { kind: 'branch', branch: checkout.branch }
}

/** A free name for a branch: the planned one, else `-2`, `-3`… */
const freeBranch = (path: string, planned: string) =>
  Effect.gen(function* () {
    let branch = planned
    for (let n = 2; yield* branchExists(path, branch); n += 1) branch = `${planned}-${n}`
    return branch
  })

/**
 * Takes a clean checkout for a task: makes its branch at `start` and checks it out, with no upstream of its own, as a worktree's
 * is. Read again first, so changes made since it was read stop it. Returns the branch made and what the checkout was on, a
 * branch or, detached, a commit, which it goes back to.
 */
export const takeCheckout = (path: string, planned: string, start: string) =>
  Effect.gen(function* () {
    const before = yield* readCheckout(path)
    if (!isClean(before)) return yield* new GitFailed({ args: ['switch'], cwd: path, stderr: 'The checkout has changes not committed.' })
    const commit = yield* commitOf(path, start)
    const branch = yield* freeBranch(path, planned)
    yield* git(path, 'switch', '--quiet', '--no-track', '--create', branch, commit)
    return { branch, returnsTo: before.branch ?? before.head }
  })

/**
 * What giving a checkout back did: it is on the branch it was on again (`back`); the person had moved it themselves, so it is
 * left where they put it (`moved`); or it has changes not committed and stays on the task's branch until they are (`changes`).
 */
export type GiveBack = { readonly kind: 'back' | 'moved' } | { readonly kind: 'changes'; readonly files: ReadonlyArray<string> }

/** Puts a checkout back on what it was on before a task took it, where it is clean and still on the task's branch. */
export const giveBack = (path: string, taskBranch: string, returnsTo: string): Effect.Effect<GiveBack, GitFailed> =>
  Effect.gen(function* () {
    const now = yield* readCheckout(path)
    if (now.branch !== taskBranch) return { kind: 'moved' }
    if (!isClean(now)) return { kind: 'changes', files: now.uncommitted }
    const toBranch = yield* branchExists(path, returnsTo)
    if (toBranch) yield* git(path, 'switch', '--quiet', returnsTo)
    else yield* git(path, 'switch', '--quiet', '--detach', returnsTo)
    return { kind: 'back' }
  })
