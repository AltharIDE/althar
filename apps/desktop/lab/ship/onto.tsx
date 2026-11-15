import { isValidElement, type ReactElement, type ReactNode, useSyncExternalStore } from 'react'

import {
  Button,
  type ChangeSetProps,
  CheckState,
  Dialog,
  HoverCard,
  Icon,
  LinkButton,
  Menu,
  MenuItem,
  MenuSegments,
  MenuSeparator,
  MenuSwitchItem,
  MergeButton,
  Popover,
  SplitButton,
  StepTrack,
  TaskStatus,
  trackOf,
} from '@althar/ui'

import { type Card, a } from './directions'
import type { Moment } from './moments'
import { GuideOf } from './guides'
import s from './lab.module.css'

/*
 * B′, onto main: B, as the person took it further (15 Nov). One control says
 * how far the commits go (a review first or not, then as far as a push, Ready
 * for review, or merged), its label the route itself. The route starts from
 * the person's own default, which Althar bends only where the project makes
 * it pointless (main needs someone else's approval: it stops at Ready), and
 * says so. The first time, Ship's button says what it does, until Got it, in
 * one of a few looks (LOOKS: S cycles them). Where the
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
  /** How Ship shows at its button: one of LOOKS. */
  readonly look: Look
  /** How Ship explains itself the first time: one of INTROS. */
  readonly intro: Intro
  /** Ship pressed the first time, where it explains itself then. */
  readonly pressed: boolean
  /** The friendly modal open, and its quiet way in hidden by the person. */
  readonly modal: boolean
  readonly hidden: boolean
  /** Which friendly modal: one of GUIDES. M cycles them, opening it. */
  readonly guide: Guide
  /** The tour's page. */
  readonly page: number
}

/** Ways the friendly modal can go: read only, or with the route set right in it. */
export const GUIDES = [
  { key: 'path', label: 'Modal: path to read' },
  { key: 'pathToggle', label: 'Modal: path, Change stops toggle' },
  { key: 'switches', label: 'Modal: a switch a stop' },
  { key: 'tap', label: 'Modal: tap the route' },
  { key: 'pick', label: 'Modal: pick a route' },
  { key: 'tour', label: 'Modal: a stop a page' },
  { key: 'short', label: 'Modal: short' },
] as const
export type Guide = (typeof GUIDES)[number]['key']

/** Ways Ship explains itself the first time, in place of a box under it. E cycles them. */
export const INTROS = [
  { key: 'modal', label: 'Quiet link, friendly modal' },
  { key: 'legend', label: 'Legend under the button' },
  { key: 'press', label: 'On the first press' },
  { key: 'pointer', label: 'Pointer' },
  { key: 'link', label: 'Quiet link' },
  { key: 'banner', label: 'Box under (before)' },
] as const
export type Intro = (typeof INTROS)[number]['key']

/** Ways to say Ship at its button, each with the same arrow beside it. S cycles them. */
export const LOOKS = [
  { key: 'caption', label: 'Line under' },
  { key: 'twoLine', label: 'Two lines' },
  { key: 'twoArrows', label: 'Two lines, arrows' },
  { key: 'twoChevrons', label: 'Two lines, chevrons' },
  { key: 'twoIcons', label: 'Two lines, icons' },
  { key: 'twoAll', label: 'Two lines, every stop' },
  { key: 'twoPills', label: 'Two lines, pills' },
  { key: 'side', label: 'Route beside Ship' },
  { key: 'track', label: 'Track under' },
  { key: 'coach', label: 'Pointer' },
  { key: 'route', label: 'Route as label' },
] as const
export type Look = (typeof LOOKS)[number]['key']

function routeOf(said: string | null): Route | null {
  const [first, far] = said?.split('-') ?? []
  if (far !== 'push' && far !== 'ready' && far !== 'merge') return null
  return { review: first === 'review', far }
}

const start: State = {
  mine: { review: true, far: 'merge' },
  // ?route=review-ready, push-merge and the like: a route chosen for this Ship, for pictures.
  chosen: routeOf(new URLSearchParams(location.search).get('route')),
  shared: new URLSearchParams(location.search).get('solo') !== '1',
  explained: new URLSearchParams(location.search).get('explained') === '1',
  offer: 'shown',
  look: (LOOKS.find((one) => one.key === new URLSearchParams(location.search).get('look'))?.key ?? 'twoAll') as Look,
  intro: (INTROS.find((one) => one.key === new URLSearchParams(location.search).get('intro'))?.key ?? 'modal') as Intro,
  modal: new URLSearchParams(location.search).get('modal') === '1',
  hidden: new URLSearchParams(location.search).get('hidden') === '1',
  guide: (GUIDES.find((one) => one.key === new URLSearchParams(location.search).get('guide'))?.key ?? 'pathToggle') as Guide,
  page: Number(new URLSearchParams(location.search).get('page') ?? 0),
  pressed: new URLSearchParams(location.search).get('pressed') === '1',
}
let state = start
const listeners = new Set<() => void>()
const set = (change: Partial<State>) => {
  state = { ...state, ...change }
  for (const one of listeners) one()
}
export const resetOnto = () => set(start)
export const setLook = (look: Look) => set({ look })
export const setIntro = (intro: Intro) => set({ intro, explained: false, pressed: false, modal: false, hidden: false })
export const nextIntro = () => setIntro(INTROS[(INTROS.findIndex((one) => one.key === state.intro) + 1) % INTROS.length]!.key)
export const setGuide = (guide: Guide) => set({ guide, intro: 'modal', modal: true, explained: true, hidden: false, page: 0 })
export const nextGuide = () => setGuide(GUIDES[(GUIDES.findIndex((one) => one.key === state.guide) + 1) % GUIDES.length]!.key)
export const nextLook = () => set({ look: LOOKS[(LOOKS.findIndex((one) => one.key === state.look) + 1) % LOOKS.length]!.key })
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
      {now.intro === 'modal' && <MenuItem onSelect={() => set({ modal: true })}>How Ship works</MenuItem>}
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

/** The looks that put the route on a second line in the button. */
const TWO = new Set<Look>(['twoLine', 'twoArrows', 'twoChevrons', 'twoIcons', 'twoAll', 'twoPills'])

/** The stops the button names: the checks are the merge's own wait, not a stop of their own. */
const BUTTON_STOPS = ['Review', 'Push', 'Ready', 'Merge'] as const
const ICON_OF = { Review: 'search', Push: 'up', Ready: 'pr', Merge: 'after' } as const

/** The route, small, as the look sets it: dots, arrows, chevrons, icons, or every stop with the ones it skips faded. */
function RouteLine({ stops, look, at }: { stops: ReadonlyArray<string>; look: Look; at?: string }) {
  const atIndex = at === undefined ? -1 : BUTTON_STOPS.indexOf((at === 'Checks' ? 'Merge' : at) as (typeof BUTTON_STOPS)[number])
  const shown = look === 'twoAll' ? BUTTON_STOPS : BUTTON_STOPS.filter((one) => stops.includes(one))
  const between =
    look === 'twoPills' ? null : look === 'twoLine' ? (
      <span className={s.sep}>·</span>
    ) : look === 'twoChevrons' ? (
      <Icon name="chevron" size={10} className={s.sep} />
    ) : (
      <Icon name="arrow" size={10} className={s.sep} />
    )
  return (
    <small className={s.route} aria-label={stops.filter((one) => one !== 'Checks').join(', then ')}>
      {shown.map((stop, i) => (
        <span
          key={stop}
          className={look === 'twoPills' ? s.pill : s.stop}
          data-skipped={!stops.includes(stop) || undefined}
          data-step={
            atIndex < 0
              ? undefined
              : BUTTON_STOPS.indexOf(stop) < atIndex
                ? 'done'
                : BUTTON_STOPS.indexOf(stop) === atIndex
                  ? 'now'
                  : 'next'
          }
        >
          {i > 0 && between}
          {look === 'twoIcons' && <Icon name={ICON_OF[stop]} size={11} />}
          {look === 'twoChevrons' ? stop : stop.toLowerCase()}
        </span>
      ))}
    </small>
  )
}

/** Got it: said once, and what Ship does stays a hover or a quiet line away. */
const gotIt = (
  <Button size="small" onClick={() => set({ explained: true })}>
    Got it
  </Button>
)

/** What each stop does on this route, short (a legend's column) or in full (a list), and whether it is skipped. */
const stopWords = (stop: (typeof BUTTON_STOPS)[number], route: Route, n: number, shared: boolean) => {
  switch (stop) {
    case 'Review':
      return route.review
        ? { short: 'GPT-6.1 Sol reads them', full: `GPT-6.1 Sol reads the ${commits(n)}; the lead fixes what it finds.`, on: true }
        : { short: 'Off', full: 'Off: they go up unread.', on: false }
    case 'Push':
      return { short: 'To PR #820', full: 'Sent up to PR #820.', on: true }
    case 'Ready':
      return route.far === 'push'
        ? { short: 'Stays a draft', full: 'Off: the pull request stays a draft.', on: false }
        : { short: 'For review', full: 'Marked ready for review.', on: true }
    case 'Merge':
      return route.far === 'merge'
        ? { short: 'Once verify passes', full: 'Merged once verify, the check main requires, passes.', on: true }
        : {
            short: shared ? 'Off: theirs' : 'Off: yours',
            full: shared ? 'Off: merging is for whoever approves it.' : 'Off: merging stays yours.',
            on: false,
          }
  }
}

/** Every stop, a row each: what it does, the ones it skips faded. */
function StopList({ route, n, shared }: { route: Route; n: number; shared: boolean }) {
  return (
    <span className={s.stopList}>
      {BUTTON_STOPS.map((stop) => {
        const words = stopWords(stop, route, n, shared)
        return (
          <span key={stop} className={s.stopRow} data-skipped={!words.on || undefined}>
            <b>{stop}</b>
            <span>{words.full}</span>
          </span>
        )
      })}
    </span>
  )
}

/** The legend: the button unfolds a strip under it, a column a stop, until Got it. */
function Legend({ route, n, shared }: { route: Route; n: number; shared: boolean }) {
  return (
    <span className={s.legend}>
      {BUTTON_STOPS.map((stop) => {
        const words = stopWords(stop, route, n, shared)
        return (
          <span key={stop} className={s.legendCell} data-skipped={!words.on || undefined}>
            <b>{stop}</b>
            <span>{words.short}</span>
          </span>
        )
      })}
      <span className={s.legendFoot}>
        <span>The arrow turns stops on and off.</span>
        <LinkButton onClick={() => set({ explained: true })}>Got it</LinkButton>
      </span>
    </span>
  )
}

/** A light card pinned under the button, its point at it: the stops, and what closes it. */
function Pinned({ children }: { children: ReactNode }) {
  return (
    <span className={s.pinned} role="note">
      {children}
    </span>
  )
}

/** A quiet way in, kept: How Ship works, a dot on it until it has been opened. */
function HowLink({ route, n, shared, unread }: { route: Route; n: number; shared: boolean; unread: boolean }) {
  return (
    <span className={s.howLink}>
      <Popover
        label="How Ship works"
        placement="below"
        align="center"
        width={330}
        onOpenChange={(open) => {
          if (open) set({ explained: true })
        }}
        trigger={
          <Button variant="quiet" size="small">
            {unread && <span className={s.unread} aria-label="New" />}
            How Ship works
          </Button>
        }
      >
        <StopList route={route} n={n} shared={shared} />
      </Popover>
    </span>
  )
}

/**
 * The control before Ship: Ship, with how far a chevron away, and under it, as the look has it, what Ship will do. The first
 * time, that says it in full until Got it; on a later task, the offer to make what they keep choosing their default.
 */
function Onto({ n, later = false }: { n: number; later?: boolean }) {
  const now = useOnto()
  const { route: picked, why } = smart(now)
  const route = now.chosen ?? picked
  const note = now.chosen !== null ? null : why
  const stops = stopsOf(route)
  const first = !now.explained && !later
  const says = (
    <>
      <b>Ship</b> {saysOf(route, n)}. The arrow changes how far it goes.
    </>
  )
  const label =
    now.look === 'route' ? (
      routeLabel(route)
    ) : now.look === 'side' ? (
      <span className={s.side}>
        <b>Ship</b>
        <RouteLine stops={stops} look="twoArrows" />
      </span>
    ) : TWO.has(now.look) ? (
      <span className={s.twoLine}>
        <b>Ship</b>
        <RouteLine stops={stops} look={now.look} />
      </span>
    ) : (
      'Ship'
    )
  const button = (
    <SplitButton
      variant="signal"
      {...(TWO.has(now.look) ? { className: s.tallSplit } : now.look === 'side' ? { mainClassName: s.sideMain } : {})}
      onClick={() => {
        if (first && now.intro === 'press') set({ pressed: true })
      }}
      moreLabel="How far it goes"
      menu={(trigger) => <HowFar trigger={trigger} route={route} onRoute={(chosen) => set({ chosen })} note={note} n={n} />}
    >
      {label}
    </SplitButton>
  )
  const tip = (
    <span className={s.tip}>
      <span>{says}</span>
      {gotIt}
    </span>
  )
  const under = later ? (
    <Offer />
  ) : now.look === 'caption' ? (
    first ? (
      tip
    ) : (
      <span className={s.caption}>{stops.join(' → ').toLowerCase()}</span>
    )
  ) : now.look === 'track' ? (
    <>
      <span className={s.preview}>
        <StepTrack steps={trackOf(stops, -1)} status={TaskStatus.Running} labels />
      </span>
      {first && tip}
    </>
  ) : now.look === 'coach' ? (
    first ? (
      <span className={s.coach} role="note">
        <span>{says}</span>
        {gotIt}
      </span>
    ) : null
  ) : now.intro === 'modal' ? (
    now.hidden ? null : (
      <span className={s.howLink}>
        <Button variant="quiet" size="small" onClick={() => set({ modal: true, explained: true })}>
          <span className={s.howInner}>
            <Icon name="info" size={13} />
            How Ship works
            {first && <span className={s.unread} aria-label="Not opened yet" />}
          </span>
        </Button>
      </span>
    )
  ) : now.intro === 'link' ? (
    <HowLink route={route} n={n} shared={now.shared} unread={first} />
  ) : !first ? null : now.intro === 'legend' ? (
    <Legend route={route} n={n} shared={now.shared} />
  ) : now.intro === 'pointer' ? (
    <Pinned>
      <StopList route={route} n={n} shared={now.shared} />
      <span className={s.pinnedFoot}>
        <span>The arrow turns stops on and off.</span>
        <Button size="small" onClick={() => set({ explained: true })}>
          Got it
        </Button>
      </span>
    </Pinned>
  ) : now.intro === 'press' ? (
    now.pressed ? (
      <Pinned>
        <StopList route={route} n={n} shared={now.shared} />
        <span className={s.pinnedFoot}>
          <LinkButton onClick={() => set({ pressed: false })}>Not now</LinkButton>
          <Button size="small" variant="signal" onClick={() => set({ explained: true, pressed: false })}>
            Ship
          </Button>
        </span>
        <span className={s.pinnedNote}>Shown once. After this, Ship goes at once.</span>
      </Pinned>
    ) : null
  ) : (
    tip
  )
  return (
    <span className={s.ship}>
      {now.look === 'coach' && !first ? (
        <HoverCard card={<>{says}</>} placement="below" align="center" width={280}>
          <span className={s.anchor}>{button}</span>
        </HoverCard>
      ) : (
        button
      )}
      {under}
      {now.intro === 'modal' &&
        now.modal &&
        (now.guide === 'path' ? <ShipGuide route={route} n={n} shared={now.shared} /> : <GuideOf route={route} n={n} />)}
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

/** The friendly modal: what Ship does, stop by stop, how to make it yours, and a way to hide its link or just close. */
function ShipGuide({ route, n, shared }: { route: Route; n: number; shared: boolean }) {
  const stops = stopsOf(route)
  const close = () => set({ modal: false })
  return (
    <Dialog
      title="How Ship works"
      description="Ship takes your work toward main, one stop at a time, and stops wherever you’re needed."
      width={480}
      tall
      onClose={close}
      actions={
        <>
          <Button variant="quiet" onClick={() => set({ modal: false, hidden: true })}>
            Hide this link
          </Button>
          <Button variant="signal" onClick={close}>
            Got it
          </Button>
        </>
      }
    >
      <ol className={s.guide}>
        {BUTTON_STOPS.map((stop) => {
          const on = stops.includes(stop)
          return (
            <li key={stop} className={s.guideStop} data-skipped={!on || undefined}>
              <span className={s.guideIcon}>
                <Icon name={ICON_OF[stop]} size={14} />
              </span>
              <span className={s.guideText}>
                <b>
                  {stop}
                  {!on && <span className={s.guideOff}>Off</span>}
                </b>
                <span>{guideOf(stop, route, n, shared)}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className={s.guideMine}>
        <span className={s.guideChevron}>
          <Icon name="chevronD" size={12} />
        </span>
        <span>
          <b>Make it yours.</b> The arrow beside Ship turns any stop on or off: skip the review when you’re sure, or stop before merging
          when a friend should look first. Your choice can become your default there, and this guide stays in that menu.
        </span>
      </p>
    </Dialog>
  )
}

/** Under way: greyed, where it is, with how far still changeable and the review skippable, never a Push beside it. */
function Under({ label, n, skip, at }: { label: string; n: number; skip: boolean; at: string }) {
  const now = useOnto()
  const route = now.chosen ?? smart(now).route
  const stops = stopsOf(route)
  // Where Ship's button said its route, the route stays, the stop it is at in bold.
  const two = TWO.has(now.look) || now.look === 'side'
  const shown = two ? (
    <span className={now.look === 'side' ? s.side : s.twoLine}>
      <b>{label}</b>
      <RouteLine stops={stops} look={now.look === 'side' ? 'twoArrows' : now.look} at={at} />
    </span>
  ) : (
    label
  )
  return (
    <SplitButton
      aria-disabled="true"
      className={cx(s.waitingSplit, two && now.look !== 'side' && s.tallSplit)}
      {...(now.look === 'side' ? { mainClassName: s.sideMain } : {})}
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
      {shown}
    </SplitButton>
  )
}

const cx = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

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

/** With the track look, the track Ship previewed under its button stays there as it runs, the control over it. */
export const onto = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
  const card = cardOf(moment, real, hover)
  if (state.look !== 'track' || !isValidElement(card.note) || card.note.type !== Track) return card
  const { note, actions, ...rest } = card
  return {
    ...rest,
    actions: [
      <span key="ship" className={s.ship}>
        {actions}
        {note}
      </span>,
    ],
  }
}

const cardOf = (moment: Moment, real: ChangeSetProps, hover: boolean): Card => {
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

export { BUTTON_STOPS, ICON_OF, commits, guideOf, same, saysOf, set as setOnto, stopWords, stopsOf }
