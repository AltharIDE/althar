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
 * The task's change against its base at `head`, as `diff -U0` gives it with
 * no line numbers or blob names: where it sits in the file moves as the base
 * grows around it, what it changes doesn't. Undefined where git can't say.
 */
const changeAt = (path: string, tip: string, head: string) =>
  Effect.gen(function* () {
    const fork = yield* gitOutcome(path, 'merge-base', tip, head)
    if (fork.code !== 0 || fork.stdout === '') return undefined
    const diff = yield* gitOutcome(path, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U0', fork.stdout, head)
    if (diff.code !== 0) return undefined
    return diff.stdout
      .split('\n')
      .filter((line) => !line.startsWith('@@') && !line.startsWith('index '))
      .join('\n')
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
 * (`refs`), with nothing of the task's own: its change against its base is
 * the same as it was at `from` by any of the base's refs, or none of the
 * commits is its own (`ownCommits`). False where nothing says so, as where
 * git knows none of the refs.
 */
export const onlyBase = (path: string, from: string, head: string, refs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (from === head) return false
    const tips = yield* tipsOf(path, refs)
    if (tips.length === 0) return false
    for (const tip of tips) {
      const before = yield* changeAt(path, tip, from)
      const now = yield* changeAt(path, tip, head)
      if (before !== undefined && now !== undefined && before === now) return true
    }
    return (yield* ownCommits(path, from, head, tips)).length === 0
  })
