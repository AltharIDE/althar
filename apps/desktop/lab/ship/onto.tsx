import { type ReactElement, useSyncExternalStore } from 'react'

import {
  Button,
  type ChangeSetProps,
  CheckState,
  Menu,
  MenuItem,
  MenuSegments,
  MenuSeparator,
  MenuSwitchItem,
  MergeButton,
  SplitButton,
  StepTrack,
  TaskStatus,
  trackOf,
} from '@althar/ui'

import { type Card, a } from './directions'
import type { Moment } from './moments'
import s from './lab.module.css'

/*
 * B′, onto main: B, as the person took it further (15 Nov). One control says
 * how far the commits go (a review first or not, then as far as a push, Ready
 * for review, or merged), its label the route itself. The route starts from
 * the person's own default, which Althar bends only where the project makes
 * it pointless (main needs someone else's approval: it stops at Ready), and
 * says so. The first time, a line says what Ship does, until Got it. Where the
 * person keeps choosing another route, it offers to make that the default,
 * asking again after 3, 6, then 12 more.
 *
 * The lab's state for it lives here, so a route chosen at one moment carries
 * along the path: T swaps the project between shared and solo.
 */

export type Far = 'push' | 'ready' | 'merge'
export interface Route {
  readonly review: boolean
  readonly far: Far
}

interface State {
  /** The person's own default, from their profile. */
  readonly mine: Route
  /** What they chose for this Ship, where they changed it. */
  readonly chosen: Route | null
  /** Whether others work on main here, its rules needing an approval from someone else. */
  readonly shared: boolean
  /** Whether they've said Got it to what Ship does. */
  readonly explained: boolean
  /** The offer to make what they keep choosing their default: shown, put off (asks again after twice as many), or taken. */
  readonly offer: 'shown' | 'later' | 'taken'
}

const start: State = {
  mine: { review: true, far: 'merge' },
  chosen: null,
  shared: new URLSearchParams(location.search).get('solo') !== '1',
  explained: false,
  offer: 'shown',
}
let state = start
const listeners = new Set<() => void>()
const set = (change: Partial<State>) => {
  state = { ...state, ...change }
  for (const one of listeners) one()
}
export const resetOnto = () => set(start)
export const toggleShared = () => set({ shared: !state.shared, chosen: null })
export const useOnto = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )

/** What the project allows of the person's default, and why, where it bends it. */
const smart = (now: State): { route: Route; why: string | null } =>
  now.shared && now.mine.far === 'merge'
    ? { route: { ...now.mine, far: 'ready' }, why: 'Main here needs an approval from someone else, so it stops at Ready for review.' }
    : { route: now.mine, why: null }

const same = (one: Route, other: Route) => one.review === other.review && one.far === other.far

export const routeLabel = ({ review, far }: Route) =>
  review
    ? { push: 'Review and push', ready: 'Review and mark ready', merge: 'Review and merge' }[far]
    : { push: 'Push now', ready: 'Push and mark ready', merge: 'Push and merge' }[far]

const stopsOf = ({ review, far }: Route) => [
  ...(review ? ['Review'] : []),
  'Push',
  ...(far === 'push' ? [] : ['Ready']),
  ...(far === 'merge' ? ['Checks', 'Merge'] : []),
]

const noop = () => undefined
const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

/** How far it goes, changed in place: the same controls before Ship and while it runs. */
function HowFar({
  trigger,
  route,
  onRoute,
  note,
  extra,
  n,
  reviewable = true,
}: {
  trigger: ReactElement
  route: Route
  onRoute: (route: Route) => void
  note: string | null
  extra?: ReactElement
  n: number
  /** Before Ship only: once under way, Skip the review says it. */
  reviewable?: boolean
}) {
  const now = useOnto()
  return (
    <Menu trigger={trigger} label="How far it goes" align="end" width={310} {...(note === null ? {} : { note })}>
      {extra}
      {reviewable && (
        <MenuSwitchItem
          checked={route.review}
          onCheckedChange={(review) => onRoute({ ...route, review })}
          note={route.review ? `GPT-6.1 Sol reads the ${commits(n)} first` : `The ${commits(n)} go up as they are`}
        >
          Review first
        </MenuSwitchItem>
      )}
      <MenuSegments
        label="Goes as far as"
        value={route.far}
        onChange={(far) => onRoute({ ...route, far: far as Far })}
        options={[
          { value: 'push', label: 'Push', description: 'Pushed to PR #820, still a draft.' },
          { value: 'ready', label: 'Ready', description: 'Marked ready for review: someone else merges it.' },
          { value: 'merge', label: 'Merged', description: 'Merged once the check main requires passes.' },
        ]}
      />
      <MenuSeparator />
      <MenuItem
        disabled={now.chosen === null || same(route, now.mine)}
        description={
          now.chosen === null || same(route, now.mine) ? `Your default: ${routeLabel(now.mine)}.` : `Instead of ${routeLabel(now.mine)}.`
        }
        onSelect={() => set({ mine: route, chosen: null })}
      >
        Make this my default
      </MenuItem>
    </Menu>
  )
}

/** The control before Ship: the route as its label, how far a chevron away. */
function Onto({ n }: { n: number }) {
  const now = useOnto()
  const { route: picked, why } = smart(now)
  const route = now.chosen ?? picked
  const note = now.chosen !== null ? null : why
  return (
    <SplitButton
      variant="signal"
      onClick={noop}
      moreLabel="How far it goes"
      menu={(trigger) => <HowFar trigger={trigger} route={route} onRoute={(chosen) => set({ chosen })} note={note} n={n} />}
    >
      {routeLabel(route)}
    </SplitButton>
  )
}

/** Under way: greyed, where it is, with how far still changeable and the review skippable, never a Push beside it. */
function Under({ label, n, skip }: { label: string; n: number; skip: boolean }) {
  const now = useOnto()
  const route = now.chosen ?? smart(now).route
  return (
    <SplitButton
      aria-disabled="true"
      className={s.waitingSplit}
      onClick={noop}
      moreLabel="How far it goes"
      menu={(trigger) => (
        <HowFar
          trigger={trigger}
          route={route}
          onRoute={(chosen) => set({ chosen })}
          note={null}
          n={n}
          reviewable={false}
          {...(skip
            ? {
                extra: (
                  <MenuItem description={`Stops the review. The ${commits(n)} go up as they are.`} onSelect={noop}>
                    Skip the review
                  </MenuItem>
                ),
              }
            : {})}
        />
      )}
    >
      {label}
    </SplitButton>
  )
}

/** What Ship does, said the first time, until Got it. */
function Explain({ n }: { n: number }) {
  const now = useOnto()
  const route = now.chosen ?? smart(now).route
  const steps = stopsOf(route)
  return (
    <span className={s.tip}>
      <span>
        <b>Ship</b> takes the {commits(n)} toward main: {steps.join(', then ').toLowerCase()}. It stops where you’re needed; the arrow
        changes how far it goes.
      </span>
      <Button size="small" onClick={() => set({ explained: true })}>
        Got it
      </Button>
    </span>
  )
}

/** What they keep choosing, offered as their default; put off, it asks again after twice as many. */
function Offer() {
  const now = useOnto()
  const kept: Route = { review: false, far: 'merge' }
  if (now.offer === 'taken') return <span className={s.tip}>Push and merge is your default now. Settings › You changes it.</span>
  if (now.offer === 'later') return <span className={s.tip}>It asks again after you choose something else 6 more times.</span>
  return (
    <span className={`${s.tip} ${s.tipStack}`}>
      <span>
        You chose <b>Push and merge</b> the last 3 times over your default, Review and merge. Make it your default?
      </span>
      <span className={s.tipActions}>
        <Button size="small" variant="signal" onClick={() => set({ mine: kept, chosen: null, offer: 'taken' })}>
          Make it my default
        </Button>
        <Button size="small" onClick={() => set({ offer: 'later' })}>
          Not now
        </Button>
      </span>
    </span>
  )
}

function Track({ at, status = TaskStatus.Running, done = false }: { at: string; status?: TaskStatus; done?: boolean }) {
  const now = useOnto()
  const stops = stopsOf(now.chosen ?? smart(now).route)
  const i = Math.max(0, stops.indexOf(at))
  return (
    <span className={s.track}>
      <StepTrack steps={trackOf(stops, done ? stops.length - 1 : i, done ? stops.length - 1 : i, done)} status={status} labels />
    </span>
  )
}

const routeNow = () => state.chosen ?? smart(state).route

export const onto = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const n = moment.snapshot.task.held?.commits ?? 0
  const route = routeNow()
  switch (moment.key) {
    case 'held':
      return { ...(state.explained ? {} : { note: <Explain n={n} /> }), actions: [<Onto key="onto" n={n} />] }
    case 'heldLater':
      return { note: <Offer />, actions: [<Onto key="onto" n={n} />] }
    case 'reviewing':
    case 'settling':
      return {
        note: <Track at="Review" />,
        ...(real.review === undefined ? {} : { review: { state: CheckState.Running, by: real.review.by } }),
        actions: [<Under key="u" label={moment.key === 'reviewing' ? 'Reviewing' : 'Fixing what the review found'} n={n} skip />],
      }
    case 'pushing':
      return { note: <Track at="Push" />, actions: [<Under key="u" label={`Pushing ${commits(3)}`} n={3} skip={false} />] }
    case 'draftChecks':
    case 'draftPassed':
      // Only where it went as far as a push: the next step is the person's, the same control from here.
      return route.far === 'push'
        ? {
            note: <Track at="Push" done status={TaskStatus.Yours} />,
            actions: [
              <Button key="r" variant="signal" onClick={noop}>
                Mark ready for review
              </Button>,
            ],
          }
        : { note: <Track at="Ready" />, actions: [<Under key="u" label="Marking ready" n={3} skip={false} />] }
    case 'readyChecks':
      return route.far === 'merge'
        ? { note: <Track at="Checks" />, actions: [<Under key="u" label="Merges once verify passes" n={3} skip={false} />] }
        : { note: <Track at="Ready" done status={TaskStatus.Yours} />, ...a(moment, real, hover) }
    case 'requiredPassed':
      return route.far === 'merge'
        ? {
            note: <Track at="Merge" />,
            actions: [
              <Button key="m" busy>
                Merging
              </Button>,
            ],
          }
        : {
            note: <Track at="Ready" done status={TaskStatus.Yours} />,
            actions: [<MergeButton key="m" onMerge={noop} onBypassQueue={noop} />],
          }
    case 'queued':
      return {
        ...(route.far === 'merge' ? { note: <Track at="Merge" /> } : {}),
        actions: [<MergeButton key="q" queued onBypassQueue={noop} />],
      }
    case 'merged':
      return { ...(route.far === 'merge' ? { note: <Track at="Merge" done status={TaskStatus.Done} /> } : {}), actions: [] }
    default:
      return a(moment, real, hover)
  }
}
