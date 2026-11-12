import { Effect } from 'effect'

import { gitOutcome } from './git'

/*
 * Commits that only bring a task's base branch in, as a merge of main that
 * settles no conflict does, are never the task's work: they start no review
 * and no round, and go up to its open pull request as they are. New work is
 * measured by the task's change against its base, from where its branch
 * forks off it, not by counting commits since the pull request's head: a
 * merge of main brings a dozen commits and none of them is the task's. A
 * merge that settled a conflict, or any commit of the task's own, is its work,
 * as before. Where git can't say, it is the task's work too, as before.
 */

/** Each of the base branch's refs this Mac has, as a commit, once: as Althar fetched it, as the worktree started, its own. */
const tipsOf = (path: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const tips: Array<string> = []
    for (const ref of refs) {
      const found = yield* gitOutcome(path, 'rev-parse', '--verify', '-q', `${ref}^{commit}`)
      if (found.code === 0 && found.stdout !== '' && !tips.includes(found.stdout)) tips.push(found.stdout)
    }
    return tips
  })

/**
 * Whether `head` is exactly `from` with the base brought in, as of `tip`:
 * its tree is git's clean merge of `from` and the base commit the branch now
 * forks from. The task's change against its base is then what it was,
 * carried over by git and nothing more. Trees, not diffs: a changed binary,
 * or an edit moved between two like lines, makes another tree. False where
 * the merge wouldn't be clean or git can't say.
 */
const carriedOver = (path: string, from: string, head: string, tip: string) =>
  Effect.gen(function* () {
    const fork = yield* gitOutcome(path, 'merge-base', tip, head)
    if (fork.code !== 0 || fork.stdout === '') return false
    const made = yield* gitOutcome(path, 'merge-tree', '--write-tree', '--no-messages', from, fork.stdout)
    if (made.code !== 0) return false
    const tree = yield* gitOutcome(path, 'rev-parse', '--verify', '-q', `${head}^{tree}`)
    return tree.code === 0 && made.stdout.split('\n')[0] === tree.stdout
  })

/** Whether a merge commit is git's own clean merge of its two parents: it settled no conflict and added nothing. */
const cleanMerge = (path: string, merge: string) =>
  Effect.gen(function* () {
    const parents = (yield* gitOutcome(path, 'rev-list', '--parents', '-n', '1', merge)).stdout.split(' ').slice(1)
    if (parents.length !== 2) return false
    const made = yield* gitOutcome(path, 'merge-tree', '--write-tree', '--no-messages', ...parents)
    if (made.code !== 0) return false
    const tree = yield* gitOutcome(path, 'rev-parse', '--verify', '-q', `${merge}^{tree}`)
    return tree.code === 0 && made.stdout.split('\n')[0] === tree.stdout
  })

/**
 * Of the commits from `from` to `head`, the task's own: those the base
 * branch doesn't have, by hash or by patch (one cherry-picked there counts as
 * its), and merges that aren't git's clean merge of their parents, as one
 * that settled a conflict. `refs` are the base branch's refs; a commit counts
 * only where none has it. With no ref git knows, every commit counts.
 */
export const ownCommits = (path: string, from: string, head: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const tips = yield* tipsOf(path, refs)
    const listed = yield* gitOutcome(path, 'rev-list', '--no-merges', `${from}..${head}`)
    let own = new Set(listed.stdout.split('\n').filter((line) => line !== ''))
    for (const tip of tips) {
      const lacks = yield* gitOutcome(path, 'rev-list', '--no-merges', '--right-only', '--cherry-pick', `${tip}...${head}`, `^${from}`)
      if (lacks.code !== 0) continue
      const missing = new Set(lacks.stdout.split('\n').filter((line) => line !== ''))
      own = new Set([...own].filter((commit) => missing.has(commit)))
    }
    const merges = (yield* gitOutcome(path, 'rev-list', '--merges', `${from}..${head}`)).stdout.split('\n').filter((line) => line !== '')
    const settled: Array<string> = []
    for (const merge of merges) if (!(yield* cleanMerge(path, merge))) settled.push(merge)
    return [...own, ...settled]
  })

/**
 * Whether the commits from `from` to `head` only bring the base branch in
 * (`refs`), with nothing of the task's own: `head` is git's clean merge of
 * `from` and the base it now forks from, by any of the base's refs
 * (`carriedOver`), or none of the commits is its own (`ownCommits`). False where nothing says so, as where
 * git knows none of the refs.
 */
export const onlyBase = (path: string, from: string, head: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (from === head) return false
    const tips = yield* tipsOf(path, refs)
    if (tips.length === 0) return false
    for (const tip of tips) if (yield* carriedOver(path, from, head, tip)) return true
    return (yield* ownCommits(path, from, head, tips)).length === 0
  })
