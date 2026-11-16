import { type ReactElement, type ReactNode, useSyncExternalStore } from 'react'

import {
  Button,
  type ChangeSetProps,
  CheckState,
  HoverCard,
  Icon,
  LinkButton,
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
import { ShipGuide } from './guide'
import type { Moment } from './moments'
import s from './lab.module.css'

/*
 * B′, onto main: B, as the person took it further (15 and 16 Nov). One Ship,
 * its button naming every stop (review, push, ready, merge), the ones this
 * Ship skips faded; its arrow sets how far it goes. The route starts from the
 * person's own default, which Althar bends only where the project makes it
 * pointless (main needs someone else's approval: it stops at Ready), and says
 * so. A friendly modal says how Ship works, a click on a stop's icon turning
 * it on or off; the way into it is what E swaps (ENTRIES). Where the person
 * keeps choosing another route, it offers to make that the default. While
 * Ship runs, the same button greys and keeps its route, the stop it is at in
 * bold, never a Push beside it.
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
  /** Whether they've opened How Ship works once: until then, its way in carries a dot. */
  readonly explained: boolean
  /** The offer to make what they keep choosing their default: shown, put off (asks again after twice as many), or taken. */
  readonly offer: 'shown' | 'later' | 'taken'
  /** The way into How Ship works: one of ENTRIES. */
  readonly entry: Entry
  /** The modal open, and whether Ship's first press opened it. */
  readonly modal: boolean
  readonly pressed: boolean
  /** Its way in under the button, hidden by the person; the arrow's menu keeps it. */
  readonly hidden: boolean
}

/** Ways into How Ship works, in place of the ⓘ link under the button. E cycles them. */
export const ENTRIES = [
  { key: 'words', label: 'A question under Ship' },
  { key: 'menu', label: 'In the arrow’s menu' },
  { key: 'question', label: 'A ? beside Ship' },
  { key: 'hover', label: 'Hovering Ship' },
  { key: 'firstPress', label: 'Ship’s first press' },
  { key: 'before', label: 'ⓘ link (before)' },
] as const
export type Entry = (typeof ENTRIES)[number]['key']

/** The ways in that sit under or beside the button, and so can be hidden. */
export const HIDEABLE = new Set<Entry>(['words', 'question', 'before'])

function routeOf(said: string | null): Route | null {
  const [first, far] = said?.split('-') ?? []
  if (far !== 'push' && far !== 'ready' && far !== 'merge') return null
  return { review: first === 'review', far }
}

const asked = new URLSearchParams(location.search)
const start: State = {
  mine: { review: true, far: 'merge' },
  // ?route=review-ready, push-merge and the like: a route chosen for this Ship, for pictures.
  chosen: routeOf(asked.get('route')),
  shared: asked.get('solo') !== '1',
  explained: asked.get('explained') === '1',
  offer: 'shown',
  entry: (ENTRIES.find((one) => one.key === asked.get('entry'))?.key ?? 'words') as Entry,
  modal: asked.get('modal') === '1',
  pressed: asked.get('pressed') === '1',
  hidden: asked.get('hidden') === '1',
}
let state = start
const listeners = new Set<() => void>()
const set = (change: Partial<State>) => {
  state = { ...state, ...change }
  for (const one of listeners) one()
}
export const resetOnto = () => set(start)
export const setEntry = (entry: Entry) => set({ entry, explained: false, pressed: false, modal: false, hidden: false })
export const nextEntry = () => setEntry(ENTRIES[(ENTRIES.findIndex((one) => one.key === state.entry) + 1) % ENTRIES.length]!.key)
export const toggleShared = () => set({ shared: !state.shared, chosen: null })
export const useOnto = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )

/** Opens How Ship works; from Ship's first press, it ends on that press. */
const explain = (pressed = false) => set({ modal: true, explained: true, pressed })

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
      {(now.entry === 'menu' || now.entry === 'firstPress' || now.hidden) && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => explain()}>
            <span className={s.menuHow}>
              How Ship works
              {!now.explained && <span className={s.unread} aria-label="Not opened yet" />}
            </span>
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/** What Ship does with this route, in a sentence. */
const saysOf = ({ review, far }: Route, n: number) => {
  const parts = [
    ...(review ? [`reviews the ${commits(n)}`] : []),
    review ? 'pushes them to PR #820' : `pushes the ${commits(n)} to PR #820`,
    ...(far === 'push' ? [] : ['marks it ready for review']),
    ...(far === 'merge' ? ['merges it once verify passes'] : []),
  ]
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1)!}`
}

/** The stops the button names: the checks are the merge's own wait, not a stop of their own. */
const BUTTON_STOPS = ['Review', 'Push', 'Ready', 'Merge'] as const
export type Stop = (typeof BUTTON_STOPS)[number]
const ICON_OF = { Review: 'search', Push: 'up', Ready: 'pr', Merge: 'after' } as const

/** The route, small, every stop with arrows between, the ones it skips faded; under way, the stop it is at in bold. */
function RouteLine({ stops, at }: { stops: ReadonlyArray<string>; at?: string }) {
  const atIndex = at === undefined ? -1 : BUTTON_STOPS.indexOf((at === 'Checks' ? 'Merge' : at) as Stop)
  return (
    <small className={s.route} aria-label={stops.filter((one) => one !== 'Checks').join(', then ')}>
      {BUTTON_STOPS.map((stop, i) => (
        <span
          key={stop}
          className={s.stop}
          data-skipped={!stops.includes(stop) || undefined}
          data-step={atIndex < 0 ? undefined : i < atIndex ? 'done' : i === atIndex ? 'now' : 'next'}
        >
          {i > 0 && <Icon name="arrow" size={10} className={s.sep} />}
          {stop.toLowerCase()}
        </span>
      ))}
    </small>
  )
}

/** A dot on what opens How Ship works, until it has been opened once. */
const dot = (on: boolean) => on && <span className={s.unread} aria-label="Not opened yet" />

/**
 * The control before Ship: Ship, naming its stops, with how far a chevron away, and the way into How Ship works as
 * the entry has it. On a later task, under it, the offer to make what they keep choosing their default.
 */
function Onto({ n, later = false }: { n: number; later?: boolean }) {
  const now = useOnto()
  const { route: picked, why } = smart(now)
  const route = now.chosen ?? picked
  const note = now.chosen !== null ? null : why
  const fresh = !now.explained && !later
  const shown = !now.hidden
  const button = (
    <SplitButton
      variant="signal"
      className={`${s.tallSplit} ${now.entry === 'menu' && fresh ? s.moreDot : ''}`}
      onClick={() => {
        if (now.entry === 'firstPress' && fresh) explain(true)
      }}
      moreLabel="How far it goes"
      menu={(trigger) => <HowFar trigger={trigger} route={route} onRoute={(chosen) => set({ chosen })} note={note} n={n} />}
    >
      <span className={s.twoLine}>
        <b>Ship</b>
        <RouteLine stops={stopsOf(route)} />
      </span>
    </SplitButton>
  )
  const control: ReactNode =
    now.entry === 'question' && shown ? (
      <span className={s.withAsk}>
        {button}
        <button type="button" className={s.ask} aria-label="How Ship works" title="How Ship works" onClick={() => explain()}>
          ?{dot(fresh)}
        </button>
      </span>
    ) : now.entry === 'hover' ? (
      <HoverCard
        placement="below"
        align="center"
        width={300}
        card={
          <span className={s.hoverSays}>
            <span>
              <b>Ship</b> {saysOf(route, n)}.
            </span>
            <LinkButton onClick={() => explain()}>How Ship works</LinkButton>
          </span>
        }
      >
        <span className={s.anchor}>{button}</span>
      </HoverCard>
    ) : (
      button
    )
  const under = later ? (
    <Offer />
  ) : !shown ? null : now.entry === 'words' ? (
    <span className={s.howLink}>
      <button type="button" className={s.asking} onClick={() => explain()}>
        What does Ship do?
        {dot(fresh)}
      </button>
    </span>
  ) : now.entry === 'before' ? (
    <span className={s.howLink}>
      <Button variant="quiet" size="small" onClick={() => explain()}>
        <span className={s.howInner}>
          <Icon name="info" size={13} />
          How Ship works
          {dot(fresh)}
        </span>
      </Button>
    </span>
  ) : null
  return (
    <span className={s.ship}>
      {control}
      {under}
      {now.modal && <ShipGuide route={route} n={n} />}
    </span>
  )
}

/** What each stop does, said as to a friend: the friendly modal's words, and its icon. */
const guideOf = (stop: (typeof BUTTON_STOPS)[number], route: Route, n: number, shared: boolean) => {
  switch (stop) {
    case 'Review':
      return route.review
        ? `A second model, GPT-6.1 Sol, reads your ${commits(n)}. If it finds something, the lead fixes it and it reads again.`
        : 'Off for this Ship: the commits go up as they are. Handy when you’re sure.'
    case 'Push':
      return route.review
        ? 'Once the review passes, the commits go up to PR #820. Nothing goes up before.'
        : 'The commits go up to PR #820 straight away.'
    case 'Ready':
      return route.far === 'push'
        ? 'Off for this Ship: the pull request stays a draft, for you to mark ready later.'
        : 'The pull request is marked ready, so people can review it and GitHub runs every check.'
    case 'Merge':
      return route.far === 'merge'
        ? 'Merged into main as soon as verify, the one check main requires, passes.'
        : shared
          ? 'Off here: main needs someone else’s approval, so merging is up to them.'
          : 'Off for this Ship: merging stays yours, one press when you’re ready.'
  }
}

/** Under way: greyed, keeping its route, the stop it is at in bold, with how far still changeable and the review skippable, never a Push beside it. */
function Under({ label, n, skip, at }: { label: string; n: number; skip: boolean; at: string }) {
  const now = useOnto()
  const route = now.chosen ?? smart(now).route
  return (
    <SplitButton
      aria-disabled="true"
      className={`${s.waitingSplit} ${s.tallSplit}`}
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
      <span className={s.twoLine}>
        <b>{label}</b>
        <RouteLine stops={stopsOf(route)} at={at} />
      </span>
    </SplitButton>
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

/** B′'s Change card at each moment. */
export const onto = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const n = moment.snapshot.task.held?.commits ?? 0
  const route = routeNow()
  switch (moment.key) {
    case 'held':
      return { actions: [<Onto key="onto" n={n} />] }
    case 'heldLater':
      return { actions: [<Onto key="onto" n={n} later />] }
    case 'reviewing':
    case 'settling':
      return {
        note: <Track at="Review" />,
        ...(real.review === undefined ? {} : { review: { state: CheckState.Running, by: real.review.by } }),
        actions: [
          <Under key="u" label={moment.key === 'reviewing' ? 'Reviewing' : 'Fixing what the review found'} n={n} skip at="Review" />,
        ],
      }
    case 'pushing':
      return { note: <Track at="Push" />, actions: [<Under key="u" label={`Pushing ${commits(3)}`} n={3} skip={false} at="Push" />] }
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
        : { note: <Track at="Ready" />, actions: [<Under key="u" label="Marking ready" n={3} skip={false} at="Ready" />] }
    case 'readyChecks':
      return route.far === 'merge'
        ? { note: <Track at="Checks" />, actions: [<Under key="u" label="Merges once verify passes" n={3} skip={false} at="Checks" />] }
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

export { BUTTON_STOPS, ICON_OF, commits, guideOf, same, saysOf, set as setOnto, stopsOf }
