import type { IconName } from '@althar/ui'

import { type Blocker, commits, fileName, type Standing } from './standing'

/*
 * How each thing in the way is said, the same in every direction so only
 * the form differs: its glyph, its tone, a short word for a chip, a phrase
 * for a status line, and a sentence for a list. "Not on the PR" is the
 * sibling prototype's (unpushed commits as the focus) and the task screen's.
 */

/** live: someone else's move under way, cobalt with a dot. The rest are the kit's Fact tones. */
export type Tone = 'quiet' | 'ok' | 'warm' | 'danger' | 'live'

export interface Said {
  readonly icon: IconName | null
  readonly tone: Tone
  /** For a chip: a word or two. */
  readonly short: string
  /** For a status line. */
  readonly phrase: string
  /** For a list, or a chip's tooltip. */
  readonly sentence: string
}

const failedWho = (one: Extract<Blocker, { kind: 'failed' }>) =>
  one.failing.length === 1 ? `${one.failing[0]} failed` : `${one.failed} checks failed`

export const said = (one: Blocker): Said => {
  switch (one.kind) {
    case 'unpushed':
      return {
        icon: 'up',
        tone: 'warm',
        short: `${one.commits} to push`,
        phrase: `${commits(one.commits)} not on the PR`,
        sentence: `${commits(one.commits)} not on the PR yet`,
      }
    case 'conflict':
      return {
        icon: 'branch',
        tone: 'warm',
        short: 'Conflict',
        phrase: 'Conflicts with main',
        sentence: `Conflicts with main, in ${one.files.map(fileName).join(', ')}`,
      }
    case 'failed':
      return {
        icon: 'close',
        tone: 'danger',
        short: one.failed === 1 ? '1 failed' : `${one.failed} failed`,
        phrase: failedWho(one),
        sentence: `${failedWho(one)} (${one.total - one.failed} of ${one.total} passed)`,
      }
    case 'changes':
      return {
        icon: 'pencil',
        tone: 'warm',
        short: 'Changes asked',
        phrase: `Changes requested by ${one.by}`,
        sentence: `${one.by} requested changes`,
      }
    case 'draft':
      return { icon: 'pr', tone: 'quiet', short: 'Draft', phrase: 'Draft PR', sentence: 'The PR is still a draft' }
    case 'running':
      return {
        icon: null,
        tone: 'live',
        short: `${one.passed}/${one.total}`,
        phrase: `Checks running, ${one.passed} of ${one.total} passed`,
        sentence: `Checks running: ${one.passed} of ${one.total} passed, ${one.running} to go`,
      }
    case 'resolving':
      return {
        icon: null,
        tone: 'live',
        short: 'Resolving',
        phrase: 'The lead is resolving a conflict',
        sentence: `The lead is resolving the conflict with main, in ${one.files.map(fileName).join(', ')}`,
      }
    case 'behind':
      return {
        icon: 'down',
        tone: 'quiet',
        short: `${one.commits} behind`,
        phrase: `${commits(one.commits)} behind main`,
        sentence: `${commits(one.commits)} behind main; merges cleanly`,
      }
  }
}

/** All clear, as each form says it. */
export const clearOf = (standing: Standing): Said => ({
  icon: 'check',
  tone: 'ok',
  short: 'Checks',
  phrase:
    standing.checks === null
      ? 'No checks ran'
      : standing.checks.total === 1
        ? '1 check passed'
        : `All ${standing.checks.total} checks passed`,
  sentence: standing.checks === null ? 'Good to merge; no checks ran' : `Good to merge: all ${standing.checks.total} checks passed`,
})

/** The groups of direction C, and the word each gives a ready line on the home. */
export const groupWords = {
  merge: 'Good to merge',
  blocked: 'Blocked',
  waiting: 'Waiting',
} as const
