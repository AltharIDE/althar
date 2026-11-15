import { createContext, useContext, type ReactNode } from 'react'

import {
  Button,
  type ChangeReview,
  type ChangeSetProps,
  CheckState,
  HoverCard,
  type MergeNeed,
  MergeButton,
  type MergeNeedsText,
  Menu,
  MenuItem,
  mergeNeedsText,
  SplitButton,
  StepTrack,
  TaskStatus,
  trackOf,
} from '@althar/ui'

import type { Moment } from './moments'
import { onto } from './onto'
import s from './lab.module.css'

/*
 * The directions, each as what the Change card shows at each moment of the
 * path: its buttons (one live, in violet, where something waits on the
 * person; the next step greyed out, with what it waits for on hover, where
 * nothing does), and the lines over them. Everything else on the screen is
 * the app's own, from the moment's snapshot.
 */

export type DirectionKey = 'today' | 'a' | 'b' | 'b2' | 'c'

export interface Lab {
  readonly direction: DirectionKey
  readonly moment: Moment
  /** Every hover held open, for pictures. */
  readonly hover: boolean
}

export const LabContext = createContext<Lab | null>(null)
export const useLab = () => useContext(LabContext)

/** What a direction puts on the card: its buttons, and where it says more, its lines, its review line, a note or a problem. */
export type Card = Partial<Pick<ChangeSetProps, 'needs' | 'needsText' | 'review' | 'note' | 'error'>> & {
  readonly actions: ReadonlyArray<ReactNode>
}

export interface Direction {
  readonly key: DirectionKey
  readonly label: string
  /** The idea, in a line, as the bar says it. */
  readonly idea: string
  readonly cardOf?: (moment: Moment, real: ChangeSetProps, hover: boolean) => Card
}

const noop = () => undefined

/** What it waits for, on hover, held open for pictures. */
function Why({ why, hover, children }: { why: ReactNode; hover: boolean; children: ReactNode }) {
  return (
    <HoverCard card={why} placement="below" align="end" width={280} {...(hover ? { open: true } : {})}>
      <span className={s.why}>{children}</span>
    </HoverCard>
  )
}

/** The next step, not the person's yet: greyed, not pressable, saying on hover what it waits for. */
function Waits({ label, why, hover, menu }: { label: string; why: ReactNode; hover: boolean; menu?: ReadonlyArray<Way> }) {
  return (
    <Why why={why} hover={hover}>
      {menu === undefined ? (
        <Button aria-disabled="true" className={s.waiting} onClick={noop}>
          {label}
        </Button>
      ) : (
        <SplitButton
          aria-disabled="true"
          className={s.waitingSplit}
          onClick={noop}
          moreLabel="Other ways"
          menu={(trigger) => <Ways trigger={trigger} ways={menu} />}
        >
          {label}
        </SplitButton>
      )}
    </Why>
  )
}

interface Way {
  readonly label: string
  readonly note?: string
}

function Ways({ trigger, ways }: { trigger: React.ReactElement; ways: ReadonlyArray<Way> }) {
  return (
    <Menu trigger={trigger} label="Other ways" align="end" width={290}>
      {ways.map((way) => (
        <MenuItem key={way.label} {...(way.note === undefined ? {} : { description: way.note })} onSelect={noop}>
          {way.label}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** The one thing the person can do now, in violet; with the other ways a chevron away. */
function Live({ label, menu, variant = 'signal' }: { label: string; menu?: ReadonlyArray<Way>; variant?: 'signal' | 'default' }) {
  return menu === undefined ? (
    <Button variant={variant} onClick={noop}>
      {label}
    </Button>
  ) : (
    <SplitButton variant={variant} onClick={noop} moreLabel="Other ways" menu={(trigger) => <Ways trigger={trigger} ways={menu} />}>
      {label}
    </SplitButton>
  )
}

const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)
const heldOf = (moment: Moment) => moment.snapshot.task.held?.commits ?? 0
const merge = <MergeButton key="merge" onMerge={noop} onBypassQueue={noop} />

/** Its review, under way: who reads the commits that wait. */
const reading = (real: ChangeSetProps): ChangeReview | undefined =>
  real.review === undefined ? undefined : { state: CheckState.Running, by: real.review.by }

const pushNow = (n: number): Way => ({
  label: 'Push now, without review',
  note: `The ${commits(n)} go up as they are; no review reads them.`,
})
const skipReview = (n: number): Way => ({
  label: 'Push now, skip the review',
  note: `Stops the review. The ${commits(n)} go up as they are.`,
})
const anyway: Way = { label: 'Merge anyway', note: 'e2e (2) isn’t one main requires: GitHub merges it as it is.' }
const bypass: Way = { label: 'Merge without queue', note: 'Merge directly using your permission to bypass branch protections.' }

/** GitHub took it out of its merge queue: the card says it as its error (the kit's Problem, as the app's Failure fills it), with what fixes it. */
const refused = (
  <>
    GitHub took it out of the merge queue: e2e (2) failed on its run with main.{' '}
    <Button size="small" onClick={noop}>
      Ask the lead to fix it
    </Button>
  </>
)

const someoneElse = 'Someone else pushed to PR #820 first. The lead’s commit goes on top of theirs.'

/* A: the next step, always in one place ---------------------------------------------------------------------------- */

export const a = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const n = heldOf(moment)
  switch (moment.key) {
    case 'held':
      return { actions: [<Live key="ship" label={`Ship ${commits(n)}`} menu={[pushNow(n)]} />] }
    case 'reviewing':
      return {
        ...(reading(real) === undefined ? {} : { review: reading(real) }),
        actions: [
          <Waits
            key="ship"
            label="Shipping"
            hover={hover}
            why={`GPT-6.1 Sol is reviewing the ${commits(n)}. They go up once it passes.`}
            menu={[skipReview(n)]}
          />,
        ],
      }
    case 'settling':
      return {
        actions: [
          <Waits
            key="ship"
            label="Shipping"
            hover={hover}
            why={`The lead is fixing what the review found. The review reads the fix, then the ${commits(n)} go up.`}
            menu={[skipReview(n)]}
          />,
        ],
      }
    case 'pushing':
      return { actions: [<Button key="push" busy>{`Pushing ${commits(n)}`}</Button>] }
    case 'draftChecks':
    case 'draftPassed':
      return { actions: [<Live key="ready" label="Mark ready for review" />] }
    case 'readyChecks':
      return {
        actions: [
          <Waits
            key="merge"
            label="Merge"
            hover={hover}
            why="Waits on verify, the one check main requires. e2e and stress run beside it."
          />,
        ],
      }
    case 'requiredPassed':
    case 'mergeable':
      return { actions: [merge] }
    case 'queued':
      return {
        actions: [
          <Waits
            key="queue"
            label="In the merge queue"
            hover={hover}
            why="GitHub merges it once the queue’s checks pass with main."
            menu={[bypass]}
          />,
        ],
      }
    case 'failed':
      return { actions: [<Waits key="merge" label="Merge" hover={hover} why="e2e (2) failed. The lead is fixing it." menu={[anyway]} />] }
    case 'queueRefused':
      return { error: refused, actions: [<Live key="again" label="Merge again" variant="default" />] }
    case 'heldPush':
      return { note: someoneElse, actions: [<Live key="push" label="Push 1 commit" />] }
    default:
      return { actions: [] }
  }
}

/* B: say how far, once ------------------------------------------------------------------------------------------------ */

const STOPS = ['Review', 'Push', 'Ready', 'Checks', 'Merge']

/** Where Ship and merge is on its way: the stops it makes, the one it is at, coloured as the task stands. */
const track = (at: number, status: TaskStatus = TaskStatus.Running, seen = at, done = false) => (
  <span className={s.track}>
    <StepTrack steps={trackOf(STOPS, at, seen, done)} status={status} labels />
  </span>
)

const dontMerge = <Live key="stop" label="Don’t merge it" variant="default" />

const b = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const n = heldOf(moment)
  switch (moment.key) {
    case 'held':
      return {
        actions: [
          <Live
            key="ship"
            label="Ship and merge"
            menu={[{ label: 'Ship only', note: `The review reads the ${commits(n)}, then they go up. Merging stays yours.` }, pushNow(n)]}
          />,
        ],
      }
    case 'reviewing':
      return {
        note: track(0),
        ...(reading(real) === undefined ? {} : { review: reading(real) }),
        actions: [<Live key="skip" label="Skip the review" variant="default" />, dontMerge],
      }
    case 'settling':
      return { note: track(0), actions: [<Live key="skip" label="Skip the review" variant="default" />, dontMerge] }
    case 'pushing':
      return { note: track(1), actions: [dontMerge] }
    case 'draftChecks':
    case 'draftPassed':
      // Reached only by Ship only: merging is the person's, one press that carries it the rest of the way.
      return {
        actions: [
          <Live
            key="ready"
            label="Mark ready and merge"
            menu={[{ label: 'Mark ready only', note: 'GitHub runs every check; merging stays yours.' }]}
          />,
        ],
      }
    case 'readyChecks':
      return {
        note: track(3),
        actions: [
          <Why key="w" hover={hover} why="It merges once verify, the one check main requires, passes.">
            {dontMerge}
          </Why>,
        ],
      }
    case 'requiredPassed':
      return {
        note: track(4),
        actions: [
          <Button key="m" busy>
            Merging
          </Button>,
        ],
      }
    case 'mergeable':
      return { actions: [merge] }
    case 'queued':
      return { note: track(4), actions: [<MergeButton key="q" queued onBypassQueue={noop} />] }
    case 'merged':
      return { note: track(4, TaskStatus.Done, 4, true), actions: [] }
    case 'failed':
      return {
        note: track(3, TaskStatus.Running),
        actions: [
          <Why key="w" hover={hover} why="The lead is fixing e2e (2). Once the checks pass, it merges.">
            {dontMerge}
          </Why>,
        ],
      }
    case 'queueRefused':
      return { note: track(4, TaskStatus.Yours), error: refused, actions: [<Live key="again" label="Merge again" variant="default" />] }
    case 'heldPush':
      return { note: someoneElse, actions: [<Live key="push" label="Push and merge" menu={[{ label: 'Push only' }]} />] }
    default:
      return { actions: [] }
  }
}

/* C: one list, one gate ----------------------------------------------------------------------------------------------- */

/** A line of Althar's own in the list of what merging needs: the review, the commits that wait, the lead at work. */
const own = (state: MergeNeed['state'], said: string, todo?: string): MergeNeed & { todo?: string } => ({
  kind: 'other',
  state,
  said,
  ...(todo === undefined ? {} : { todo }),
})

/** Its own lines first, then GitHub's, as the real list has them. */
const listOf = (real: ChangeSetProps, ...mine: ReadonlyArray<MergeNeed>): MergeNeed[] => [
  ...mine,
  // Shipping says it in its own words: the host's push line would only say it again.
  ...(real.needs ?? []).filter((one) => !(mine.length > 0 && one.kind === 'pushed')),
]

/** One list now: everything merging needs, Althar's and GitHub's; the todo of its own lines is theirs. */
const listText: Partial<MergeNeedsText> = {
  all: () => 'Everything merging needs is met',
  todo: (need, host) => (need.kind === 'other' ? ((need as { todo?: string }).todo ?? null) : mergeNeedsText.todo(need, host)),
}

const gate = (why: string, hover: boolean, menu?: ReadonlyArray<Way>) => (
  <Waits key="merge" label="Merge" hover={hover} why={why} {...(menu === undefined ? {} : { menu })} />
)

const c = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const n = heldOf(moment)
  const list = (...mine: ReadonlyArray<MergeNeed>) => ({ needs: listOf(real, ...mine), needsText: listText })
  switch (moment.key) {
    case 'held':
      return {
        ...list(own('unmet', `${commits(n)} not shipped`, 'Ship them')),
        actions: [
          <Live key="ship" label={`Ship ${commits(n)}`} />,
          gate(`Waits on ${commits(n)} not shipped, and on the draft.`, hover, [pushNow(n)]),
        ],
      }
    case 'reviewing':
      return {
        ...list(own('waiting', `GPT-6.1 Sol reviewing ${commits(n)}`), own('waiting', `${commits(n)} go up once it passes`)),
        ...(reading(real) === undefined ? {} : { review: reading(real) }),
        actions: [
          <Live key="ready" label="Mark ready for review" />,
          gate(`Waits on the review of ${commits(n)}.`, hover, [skipReview(n)]),
        ],
      }
    case 'settling':
      return {
        ...list(own('waiting', 'The lead is fixing what the review found'), own('waiting', `${commits(n)} go up once the review passes`)),
        actions: [
          <Live key="ready" label="Mark ready for review" />,
          gate('Waits on the lead’s fix, and the review of it.', hover, [skipReview(n)]),
        ],
      }
    case 'pushing':
      return {
        ...list(own('waiting', `${commits(n)} going up`)),
        actions: [<Live key="ready" label="Mark ready for review" />, gate(`Waits on ${commits(n)} going up.`, hover)],
      }
    case 'draftChecks':
      return { ...list(), actions: [<Live key="ready" label="Mark ready for review" />, gate('Waits on verify, and on the draft.', hover)] }
    case 'draftPassed':
      return { ...list(), actions: [<Live key="ready" label="Mark ready for review" />, gate('Waits on the draft.', hover)] }
    case 'readyChecks':
      return { ...list(), actions: [gate('Waits on verify, the one check main requires. e2e and stress run beside it.', hover)] }
    case 'requiredPassed':
    case 'mergeable':
      return { ...list(), actions: [merge] }
    case 'queued':
      return {
        ...list(),
        actions: [
          <Waits
            key="q"
            label="In the merge queue"
            hover={hover}
            why="GitHub merges it once the queue’s checks pass with main."
            menu={[bypass]}
          />,
        ],
      }
    case 'failed':
      return {
        ...list(own('waiting', 'The lead is fixing e2e (2)')),
        actions: [gate('Waits on the lead’s fix for e2e (2).', hover, [anyway])],
      }
    case 'queueRefused':
      return { ...list(), error: refused, actions: [<Live key="again" label="Merge again" variant="default" />] }
    case 'heldPush':
      return {
        note: someoneElse,
        ...list(),
        actions: [<Live key="push" label="Push 1 commit" />, gate('Waits on 1 commit not pushed.', hover)],
      }
    default:
      return { actions: [] }
  }
}

/*
 * Every direction: commits held for Ship are Ship's to send, never "Push them"; and while Ship is under way they aren't crossed
 * out, they wait for it.
 */
const shipLine = (moment: Moment, real: ChangeSetProps): Partial<Card> => {
  const n = heldOf(moment)
  const going =
    moment.key === 'reviewing' || moment.key === 'settling'
      ? `${commits(n)} go up once the review passes`
      : moment.key === 'pushing'
        ? `${commits(n)} going up`
        : null
  return {
    needs: (real.needs ?? []).map((one) =>
      one.kind === 'pushed' && one.said !== undefined && going !== null ? { ...one, state: 'waiting' as const, said: going } : one,
    ),
    needsText: {
      todo: (need, host) =>
        need.kind === 'pushed' && need.said !== undefined ? (need.state === 'unmet' ? 'Ship them' : null) : mergeNeedsText.todo(need, host),
    },
  }
}

const shipping =
  (cardOf: NonNullable<Direction['cardOf']>): NonNullable<Direction['cardOf']> =>
  (moment, real, hover) => ({ ...shipLine(moment, real), ...cardOf(moment, real, hover) })

export const DIRECTIONS: ReadonlyArray<Direction> = [
  { key: 'today', label: 'Today', idea: 'Main as it is now, drawn from the same moments.' },
  {
    key: 'a',
    label: 'A · One place',
    idea: 'One button that moves along the path. When it isn’t yours, the next step shows greyed out, with what it waits for on hover.',
    cardOf: shipping(a),
  },
  {
    key: 'b',
    label: 'B · How far',
    idea: 'Say once how far it goes: Ship and merge carries it through, and stops only where you’re needed.',
    cardOf: shipping(b),
  },
  {
    key: 'b2',
    label: 'B′ · Onto main',
    idea: 'B, taken further: one control whose label is the route (review or not, then push, ready or merged), from your own default, bent only where the project makes it pointless. T swaps the project between shared and solo.',
    cardOf: shipping(onto),
  },
  {
    key: 'c',
    label: 'C · One gate',
    idea: 'Merge is always on the card. One list, Althar’s steps and GitHub’s, says what it waits for; the button reads that list.',
    cardOf: c,
  },
]
