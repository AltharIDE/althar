import type { ChangeSummary } from '@althar/contracts'
import { type BoardCardProps, Button, type NeedLineProps, TaskStatus } from '@althar/ui'
import { createContext, type ReactNode, useContext } from 'react'

import { BlockerList, Chips, Dev91, Go, partStyles as s, StatusLine, statusWords, Tell } from './parts'
import { fileName, type Standing, stopping } from './standing'
import { clearOf, groupWords, said } from './words'

/*
 * The directions. Each says what a ready card on the board and a ready line
 * on the home become, given what stands between the change and merging it;
 * the app builds both as it does today (readyCardOf, needLineOf), and the
 * direction changes the props the kit's BoardCard and NeedLine are given.
 */

export type Key = 'today' | 'a' | 'b' | 'c' | 'd' | 'e'

export interface Direction {
  readonly key: Key
  /** The shots' letter: T for today. */
  readonly letter: string
  readonly name: string
  readonly gist: string
  /** How it handles checks that are still running. */
  readonly running: string
  /** What the runtime and the card's data would need. */
  readonly needs: string
  readonly card?: (props: BoardCardProps, standing: Standing) => BoardCardProps
  readonly line?: (props: NeedLineProps, standing: Standing, change: ChangeSummary) => NeedLineProps
  /** Needs you's ready cards in groups: good to merge, blocked, waiting. */
  readonly grouped?: boolean
  /** The home's ready lines in that order too. */
  readonly sorted?: boolean
}

/** The change as the home's line names it: althar #150. */
const named = (change: ChangeSummary) =>
  `${change.repository.slice(change.repository.lastIndexOf('/') + 1)} ${change.prefix}${change.number}`
const size = (change: ChangeSummary) =>
  change.additions === null || change.deletions === null ? null : `+${change.additions} −${change.deletions}`
const brief = (...parts: ReadonlyArray<string | null>) => parts.filter((part) => part !== null && part !== '').join(' · ')

/** The one next thing, as a button on the home's line. */
const nextButton = (standing: Standing, open: (() => void) | undefined): ReactNode => {
  const { next } = standing
  const button = (
    <Button
      size="small"
      {...(next.kind === 'merge' || next.kind === 'push' ? { variant: 'signal' as const } : {})}
      {...(open === undefined ? {} : { onClick: open })}
    >
      {next.label}
    </Button>
  )
  return next.kind === 'auto' ? <Dev91>{button}</Dev91> : button
}

const today: Direction = {
  key: 'today',
  letter: 'T',
  name: 'Today',
  gist: 'Main as it is: the card says Ready to accept, and one fact about its checks. A conflict, unpushed commits, a draft or a review asking for changes don’t reach the card; a conflict the lead resolves moves the task back to Running.',
  running: 'Says “2 of 5 checks passed”, in grey, like any other fact.',
  needs: '—',
}

const a: Direction = {
  key: 'a',
  letter: 'A',
  name: 'A · A status line and the next thing to do',
  gist: 'The foot of the card says, in one line, everything that stands, the most pressing first in its colour. At its end, where the old accept card said Review, the one next thing to do: Push 2 commits, Ask the lead to fix it, Accept and merge. On the home that becomes the line’s button.',
  running:
    'Stays in place and stays quiet: a cobalt dot and “Checks running, 2 of 5 passed”. Its next thing is DEV-91’s Merge when checks pass.',
  needs:
    'conflict (with lead resolving) on the card; changes requested and behind main from the host; a ready task staying ready while its lead resolves. The home’s buttons need the push and merge commands the dock already has.',
  card: (props, standing) => ({
    ...props,
    foot: (
      <>
        <StatusLine standing={standing} />
        {standing.next.kind !== 'none' && <Go dev91={standing.next.kind === 'auto'}>{standing.next.label}</Go>}
      </>
    ),
  }),
  line: (props, standing, change) => ({
    ...props,
    brief: brief(named(change), statusWords(standing)),
    actions: nextButton(standing, props.onOpen),
  }),
}

const b: Direction = {
  key: 'b',
  letter: 'B',
  name: 'B · Chips, green when clear',
  gist: 'Three small chips on every ready card, always in the same place: Checks, Main, Push. Green when clear, cobalt while running, warm when it needs a hand, red when it failed. Draft, a review asking for changes and behind main add a chip only when they stand. Each chip says the whole of it on hover.',
  running: 'The checks chip turns cobalt with a dot and counts: 2/5. The card stays where it is.',
  needs: 'The same facts as A. Nothing new to press.',
  card: (props, standing) => ({
    ...props,
    foot: (
      <>
        <Chips standing={standing} />
        {standing.next.kind === 'auto' && <Go dev91>{standing.next.label}</Go>}
      </>
    ),
  }),
  line: (props, standing, change) => ({
    ...props,
    brief: (
      <span className={s.line}>
        <span>{named(change)}</span>
        <Chips standing={standing} />
      </span>
    ),
  }),
}

const c: Direction = {
  key: 'c',
  letter: 'C',
  name: 'C · Needs you, sorted by readiness',
  gist: 'Ready cards gather in three groups under Needs you: Good to merge first, then Blocked (something only you can clear), then Waiting (checks running, or the lead resolving a conflict), faded and smaller, at the bottom. Each card says its one reason. The home sorts its ready lines the same way, its kind word the group.',
  running:
    'Waits in a group at the bottom, faded, without its PR chip, until the checks end; then it moves up to Good to merge or Blocked.',
  needs: 'The same facts as A, and the lane sorting them; the home’s count would leave out what’s waiting.',
  grouped: true,
  sorted: true,
  card: (props, standing) => {
    const [first, ...rest] = stopping(standing)
    const waiting = standing.group === 'waiting'
    const clear = clearOf(standing)
    return {
      ...props,
      // Waiting, it is a title and its reason: what it is doesn't matter until it is the person's.
      ...(waiting ? { object: undefined, className: s.faded } : {}),
      foot: (
        <>
          {first === undefined ? <Tell said={clear} words={clear.phrase} /> : <Tell said={said(first)} words={said(first).phrase} />}
          {rest.length > 0 && <span>+{rest.length} more</span>}
          {standing.next.kind === 'auto' && <Go dev91>{standing.next.label}</Go>}
        </>
      ),
    }
  },
  line: (props, standing, change) => {
    const [first] = stopping(standing)
    return {
      ...props,
      kind: groupWords[standing.group],
      brief: brief(named(change), first === undefined ? clearOf(standing).phrase : said(first).phrase),
      ...(standing.group === 'waiting' ? { className: s.faded } : {}),
    }
  },
}

const d: Direction = {
  key: 'd',
  letter: 'D',
  name: 'D · A list of what blocks, only when something does',
  gist: 'With nothing in the way the card says one green line: Good to merge. When something blocks, a short list takes its place, a row each, in plain sentences: “2 commits not on the PR yet”, “harness / verify failed (4 of 5 passed)”. The home’s line says “Good to merge”, or what stands before merging.',
  running: 'Checks running is a row of the list like any other, cobalt, with how many are left.',
  needs: 'The same facts as A.',
  card: (props, standing) => ({
    ...props,
    foot: (
      <>
        <BlockerList standing={standing} />
        {standing.next.kind === 'auto' && <Go dev91>{standing.next.label}</Go>}
      </>
    ),
  }),
  line: (props, standing, change) => {
    const all = stopping(standing)
    return {
      ...props,
      brief:
        all.length === 0
          ? brief('Good to merge', named(change), size(change))
          : brief(named(change), `Before merging: ${all.map((one) => said(one).phrase).join(', ')}`),
    }
  },
}

/** E's word: the one thing that stands, in the app's words where it has them (Merge conflict, Resolving a conflict). */
const wordOf = (standing: Standing): string => {
  const [first] = stopping(standing)
  switch (first?.kind) {
    case undefined:
      return 'Good to merge'
    case 'unpushed':
      return `${first.commits === 1 ? '1 commit' : `${first.commits} commits`} to push`
    case 'conflict':
      return 'Merge conflict'
    case 'failed':
      return first.failed === 1 ? 'Check failed' : 'Checks failed'
    case 'changes':
      return 'Changes requested'
    case 'draft':
      return 'Draft PR'
    case 'running':
      return 'Checks running'
    case 'resolving':
      return 'Resolving a conflict'
  }
}

const e: Direction = {
  key: 'e',
  letter: 'E',
  name: 'E · The card’s word says it, in whose colour',
  gist: 'The word at the top of the card, which already says where a task stands, names the one thing in the way, in the colour of whose move it is: violet when it’s yours (Merge conflict, 3 commits to push, Check failed, Good to merge), cobalt with a dot when CI or the lead is on it (Checks running, Resolving a conflict). The foot says the detail, and the rest of what stands. The home’s kind word is the same word.',
  running: 'The card turns cobalt, like a running card: not yours yet. It stays in Needs you so it doesn’t jump lanes.',
  needs: 'The same facts as A. No new parts: the card’s word and status already exist.',
  card: (props, standing) => {
    const [first, ...rest] = stopping(standing)
    const behind = standing.blockers.find((one) => one.kind === 'behind')
    const words = detailOf(standing)
    // The detail of the word: in its tone where it has a glyph to say it with (checks passed, which failed), else quiet.
    const detail =
      words === null ? null : first === undefined || first.kind === 'unpushed' ? (
        <Tell said={clearOf(standing)} words={words} />
      ) : first.kind === 'failed' ? (
        <Tell said={said(first)} words={words} />
      ) : (
        <span>{words}</span>
      )
    return {
      ...props,
      status: standing.group === 'waiting' ? TaskStatus.Running : TaskStatus.Yours,
      word: wordOf(standing),
      foot: (
        <>
          {detail}
          {rest.map((one) => (
            <Tell key={one.kind} said={said(one)} words={said(one).phrase} />
          ))}
          {behind !== undefined && <span>{said(behind).phrase}</span>}
          {standing.next.kind === 'auto' && <Go dev91>{standing.next.label}</Go>}
        </>
      ),
    }
  },
  line: (props, standing, change) => {
    const [, ...rest] = stopping(standing)
    return {
      ...props,
      kind: wordOf(standing),
      brief: brief(named(change), detailOf(standing), ...rest.map((one) => said(one).phrase), size(change)),
      ...(standing.group === 'waiting' ? { className: s.faded } : {}),
    }
  },
}

/** E's detail under its word: which check failed, where it conflicts, how many passed; null where the rest says it. */
const detailOf = (standing: Standing): string | null => {
  const [first, ...rest] = stopping(standing)
  const checks = standing.checks
  const files = (paths: ReadonlyArray<string>) => `with main, in ${paths.map(fileName).join(', ')}`
  switch (first?.kind) {
    case undefined:
      return clearOf(standing).phrase
    case 'unpushed':
      // Checks passed on what is pushed; what is said after it, where something else stands, says the rest.
      return rest.length > 0 || checks === null ? null : `All ${checks.total} checks passed, before the push`
    case 'failed':
      return first.failing.join(', ')
    case 'running':
      return `${first.passed} of ${first.total} passed`
    case 'conflict':
      return files(first.files)
    case 'resolving':
      return `The lead is on it, ${files(first.files)}`
    case 'changes':
      return `By ${first.by}`
    case 'draft':
      return checks === null ? null : clearOf(standing).phrase
  }
}

export const DIRECTIONS: ReadonlyArray<Direction> = [today, a, b, c, d, e]
export const directionOf = (key: Key): Direction => DIRECTIONS.find((one) => one.key === key) ?? today

export const DirectionContext = createContext<Direction>(today)
export const useDirection = () => useContext(DirectionContext)
