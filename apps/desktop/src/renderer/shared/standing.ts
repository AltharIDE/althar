import {
  type Blocker,
  type ChangeStanding as Standing,
  type ChangeSummary,
  foundWords,
  kindWords,
  type NextThing as Next,
  pushResolves,
  ranChecks,
  standingOf,
} from '@althar/contracts'
import type { IconName } from '@althar/ui'

// Where a change stands, and a ready task's word, are the one rule every place, the runtime's too, reads them by.
export {
  type Blocker,
  forShip,
  goingUp,
  isBlocked,
  personPushes,
  pushResolves,
  ranChecks,
  readyText,
  readyWordOf,
  standingOf,
  type ChangeStanding as Standing,
  type NextThing as Next,
} from '@althar/contracts'

/*
 * Where a ready change's open pull request stands (`standingOf`, in
 * contracts), in the window's words: the board's card says it as one line
 * with the one next thing at its end; the home's line, as its brief with
 * that thing as its button. Both say it in the same words, and both do the
 * person's own (push, merge) right there; the lead's (resolve, fix) the card
 * leaves to its task. Where the project's rules push the lead's commits on
 * their own (ADR-072), the card says why Althar held them.
 */

export const standingText = {
  commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
  parted: (short: string) => `Branch and ${short} have parted`,
  unpushed: (n: number, short: string) => `${standingText.commits(n)} not on the ${short}`,
  going: (n: number, short: string) => `${standingText.commits(n)} going up to the ${short}`,
  /** Commits to push that bring the branch up to date with the one the pull request conflicts with: pushing them clears the conflict. */
  pushResolves: (target: string | null) => `The push should resolve the conflict${target === null ? '' : ` with ${target}`}`,
  conflict: (target: string | null) => (target === null ? 'Has a merge conflict' : `Conflicts with ${target}`),
  failed: (failing: ReadonlyArray<string>, failed: number) =>
    failing.length === 1 ? `${failing[0]} failed` : failed === 1 ? '1 check failed' : `${failed} checks failed`,
  running: (passed: number, total: number) => `Checks running, ${passed} of ${total} passed`,
  cancelled: (cancelled: ReadonlyArray<string>) =>
    cancelled.length === 1 ? `${cancelled[0]} cancelled` : `${cancelled.length} checks cancelled`,
  passed: (n: number) => (n === 1 ? '1 check passed' : `All ${n} checks passed`),
  /** Some skipped, or said nothing: not all passed, though none is in the way. */
  soFar: (passed: number, total: number) => `${passed} of ${total} checks passed`,
  none: 'No checks ran',
  next: {
    merge: 'Accept and merge',
    push: (n: number) => (n === 1 ? 'Push 1 commit' : `Push ${n} commits`),
    resolve: 'Ask the lead to resolve it',
    fix: 'Ask the lead to fix it',
  },
  /** While a next thing done from where it is shown is under way. */
  doing: {
    merge: 'Merging',
    push: (n: number) => (n === 1 ? 'Pushing 1 commit' : `Pushing ${n} commits`),
  },
  /** After one failed: what happened, and the button that tries it again. */
  nextFailed: {
    merge: (why: string) => `Merge failed: ${why}`,
    push: (why: string) => `Push failed: ${why}`,
    ship: (why: string) => `Ship failed: ${why}`,
    fix_after_merge: (why: string) => `Fix it failed: ${why}`,
    again: 'Try again',
  },
  /** What a screen reader hears of the button for a next thing, naming the pull request it acts on. */
  label: {
    merge: (where: string) => `Accept and merge ${where}`,
    push: (n: number, where: string) => `${n === 1 ? 'Push 1 commit' : `Push ${n} commits`} to ${where}`,
    mergeAgain: (where: string) => `Try merging ${where} again`,
    pushAgain: (n: number, where: string) => `Try pushing ${n === 1 ? '1 commit' : `${n} commits`} to ${where} again`,
  },
}

/** A thing in the way, as a fact says it: its words, its glyph and its tone. */
export interface Said {
  readonly words: string
  readonly icon?: IconName
  readonly tone: 'quiet' | 'ok' | 'warm' | 'danger' | 'live'
}

export const saidOf = (blocker: Blocker, change: Pick<ChangeSummary, 'short'>): Said => {
  const t = standingText
  switch (blocker.kind) {
    case 'parted':
      return { words: t.parted(change.short), icon: 'branch', tone: 'warm' }
    case 'unpushed':
      return { words: blocker.held ?? t.unpushed(blocker.commits, change.short), icon: 'up', tone: 'warm' }
    case 'going':
      return { words: t.going(blocker.commits, change.short), icon: 'up', tone: 'live' }
    case 'shipping':
      return { words: shipText.commits(blocker.commits), icon: 'up', tone: 'warm' }
    case 'conflict':
      return { words: t.conflict(blocker.target), icon: 'branch', tone: 'warm' }
    case 'failed':
      return { words: t.failed(blocker.failing, blocker.failed), icon: 'close', tone: 'danger' }
    case 'running':
      return { words: t.running(blocker.passed, blocker.total), tone: 'live' }
    case 'cancelled':
      return { words: t.cancelled(blocker.cancelled), icon: 'stop', tone: 'warm' }
  }
}

/** Nothing in the way: how its checks went, green only where every one passed, or that none ran. */
export const clearOf = (change: Pick<ChangeSummary, 'checks'>): Said => {
  const checks = change.checks
  const ran = checks === null ? null : ranChecks(checks)
  if (ran === null || ran.total === 0) return { words: standingText.none, tone: 'quiet' }
  return ran.passed === ran.total
    ? { words: standingText.passed(ran.total), icon: 'check', tone: 'ok' }
    : { words: standingText.soFar(ran.passed, ran.total), tone: 'quiet' }
}

/** How facts read, top to bottom: what blocks, then what to do, then what is fine or on its way. */
const readOrder: Record<Blocker['kind'], number> = {
  parted: 0,
  conflict: 0,
  failed: 0,
  cancelled: 0,
  unpushed: 1,
  shipping: 1,
  going: 2,
  running: 2,
}

/**
 * What stands, as facts: what blocks first (a conflict, failed checks), then
 * checks running, or, where nothing is in the way, how its checks went.
 * Commits to push aren't a fact of their own, as the button that pushes them
 * says their count, unless Althar held them where it pushes a lead's commits
 * on its own: then why (ADR-072). Only that pushing clears a conflict is said,
 * in place of it. Where they were all that was in the way, how the checks
 * went stands.
 */
export const factsOf = (change: ChangeSummary, standing: Standing = standingOf(change)): ReadonlyArray<Said> => {
  const together = pushResolves(standing)
  const facts = standing.blockers
    .filter((one) => one.kind !== 'unpushed' || one.held !== null)
    .sort((a, b) => readOrder[a.kind] - readOrder[b.kind])
    .map((one): Said => {
      if (together && one.kind === 'conflict') return { words: standingText.pushResolves(one.target), icon: 'up', tone: 'warm' }
      return saidOf(one, change)
    })
  return facts.length === 0 ? [clearOf(change)] : facts
}

/** Whether the next thing is the person's own, done from where it is shown: pushing, merging and shipping. The others are the lead's, and open the task. */
export type DoneHere = Extract<Next, { kind: 'merge' | 'push' | 'ship' | 'fix_after_merge' }>

export const doneHere = (next: Next): next is DoneHere =>
  next.kind === 'merge' || next.kind === 'push' || next.kind === 'ship' || next.kind === 'fix_after_merge'

/** The next thing while it is under way. */
export const doingWords = (next: DoneHere): string =>
  next.kind === 'merge'
    ? standingText.doing.merge
    : next.kind === 'ship'
      ? shipText.shipping
      : next.kind === 'fix_after_merge'
        ? afterMergeText.fixing
        : standingText.doing.push(next.commits)

/** The next thing's button, for a screen reader: what it does and to which pull request; or, after it failed, that it tries again. */
export const labelWords = (next: DoneHere, where: string, failed = false): string => {
  const t = standingText.label
  if (next.kind === 'ship') return failed ? shipText.again(next.commits) : shipText.label(next.commits)
  if (next.kind === 'fix_after_merge') return afterMergeText.fixHint(next.words)
  return next.kind === 'merge'
    ? failed
      ? t.mergeAgain(where)
      : t.merge(where)
    : failed
      ? t.pushAgain(next.commits, where)
      : t.push(next.commits, where)
}

/** The next thing, in its words. */
export const nextWords = (next: Next): string => {
  const t = standingText.next
  switch (next.kind) {
    case 'merge':
      return t.merge
    case 'push':
      return t.push(next.commits)
    case 'ship':
      return shipText.ship
    case 'resolve':
      return t.resolve
    case 'fix':
      return t.fix
    case 'fix_after_merge':
      return afterMergeText.fix
  }
}

/**
 * What waits on a task's branch for Ship (a task is a conversation plus
 * parts, "A tweak waits for Ship"), as its card, its header and Needs you
 * say it: how many commits, and Ship, which reviews them where the plan has a
 * reviewer before the work ships, and then sends them up.
 */
export const shipText = {
  word: kindWords.notShipped,
  commits: (n: number) => `${standingText.commits(n)} not shipped`,
  ship: 'Ship',
  shipping: 'Shipping',
  failed: (why: string) => `Ship failed: ${why}`,
  label: (n: number) => `Ship ${standingText.commits(n)}`,
  /** What Ship does, on hover: its review reads them first, where the plan has a reviewer, and then they go up. */
  hint: (n: number, reviewed: boolean) =>
    reviewed ? `Its review reads ${standingText.commits(n)} first, then they go up` : `${standingText.commits(n)} go up`,
  again: (n: number) => `Try shipping ${standingText.commits(n)} again`,
}

/**
 * A review after a merge, in the same task (a task is a conversation plus
 * parts): what it found waits on the person, for the change that merged, as
 * its card, its header and Needs you say it, with Fix it and Leave it.
 */
export const afterMergeText = {
  word: foundWords,
  /** Under the word, which already says what it found: which merge it was about. */
  after: (words: string) => `After ${words} merged`,
  sentence: (n: number, words: string) => `Review found ${n} after ${words} merged`,
  fix: 'Fix it',
  fixing: 'Fixing',
  /** What Fix it does, on hover. */
  fixHint: (words: string) => `The lead fixes them, and its fix goes up as a new pull request after ${words}`,
  leave: 'Leave it',
  leaving: 'Leaving',
  leaveHint: 'Close the findings: they stay in the thread',
}
