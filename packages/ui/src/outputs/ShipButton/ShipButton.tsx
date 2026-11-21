import { type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/icons'
import { ShipFar, ShipStop, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuItem, MenuSegments, MenuSeparator, MenuSwitchItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import s from './ShipButton.module.css'

/*
 * Ship, naming its route: the button says every stop (review, push, ready,
 * merge), the ones this Ship skips faded, and its chevron sets them. Hovering
 * it says what it will do in a sentence, with How Ship works a click away: a
 * dialog of the stops in plain words, where a click on a stop's icon turns it
 * on or off for this Ship. Under way, the same button greys and keeps its
 * route, the stop it is at in bold, so nothing beside it competes.
 */

/** A Ship's route: whether its review comes first, and how far it goes. */
export interface ShipRoute {
  readonly review: boolean
  readonly far: ShipFar
}

/** What the words name: the commits that go, where they go, who reviews them, and whether merging is someone else's. */
export interface ShipAbout {
  /** "2 commits". */
  readonly commits: string
  /** "PR #820", or "a new pull request". */
  readonly to: string
  /** The reviewer's name, where it has one. */
  readonly reviewer: string | null
  /** Main needs someone else's approval: merging is theirs. */
  readonly theirs: boolean
}

export interface ShipButtonText {
  ship: string
  /** Each stop's name, as the route line and the dialog have it. */
  stop: Record<ShipStop, string>
  /** The route line's names, small under Ship. */
  line: Record<ShipStop, string>
  /** The route line read out: "review, then push, then ready". */
  lineLabel: (stops: ReadonlyArray<string>) => string
  more: string
  reviewFirst: string
  reviewOn: (about: ShipAbout) => string
  reviewOff: (about: ShipAbout) => string
  noReviewer: string
  goesAsFarAs: string
  far: Record<ShipFar, string>
  farNote: (far: ShipFar, about: ShipAbout) => string
  makeDefault: string
  isDefault: (route: string) => string
  insteadOf: (route: string) => string
  /** A route by name: "Review and merge". */
  routeName: (route: ShipRoute) => string
  skipReview: string
  skipReviewNote: (about: ShipAbout) => string
  howItWorks: string
  /** What this Ship will do, in a sentence: the hover's words. */
  says: (route: ShipRoute, about: ShipAbout, readyAlready: boolean) => string
  intro: string
  /** How to change the route in the dialog, after its intro. */
  introEdit: string
  /** What a stop does on this route, in the dialog. */
  guide: (stop: ShipStop, route: ShipRoute, about: ShipAbout, readyAlready: boolean) => string
  /** The review's stop, in the dialog, where the task has no reviewer. */
  guideNoReviewer: (about: ShipAbout) => string
  skip: (stop: string) => string
  bringBack: (stop: string) => string
  pushAlways: string
  off: string
  gotIt: string
  close: string
  /** The dialog's own Ship, named for what this route does. */
  shipAs: (route: ShipRoute, about: ShipAbout) => string
  forThisShip: string
}

const ORDER = [ShipStop.Review, ShipStop.Push, ShipStop.Ready, ShipStop.Merge] as const

const sentence = (parts: ReadonlyArray<string>) =>
  parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')}, then ${parts.at(-1) ?? ''}`

export const shipButtonText: ShipButtonText = {
  ship: 'Ship',
  stop: { [ShipStop.Review]: 'Review', [ShipStop.Push]: 'Push', [ShipStop.Ready]: 'Ready', [ShipStop.Merge]: 'Merge' },
  line: { [ShipStop.Review]: 'review', [ShipStop.Push]: 'push', [ShipStop.Ready]: 'ready', [ShipStop.Merge]: 'merge' },
  lineLabel: (stops) => stops.join(', then '),
  more: 'How far it goes',
  reviewFirst: 'Review first',
  reviewOn: (about) => `${about.reviewer ?? 'Its reviewer'} reads the ${about.commits} first`,
  reviewOff: (about) => `The ${about.commits} go up as they are`,
  noReviewer: 'This task has no reviewer',
  goesAsFarAs: 'Goes as far as',
  far: { [ShipFar.Push]: 'Push', [ShipFar.Ready]: 'Ready', [ShipFar.Merge]: 'Merged' },
  farNote: (far, about) => {
    switch (far) {
      case ShipFar.Push:
        return `Pushed to ${about.to}, still a draft.`
      case ShipFar.Ready:
        return about.theirs ? 'Marked ready for review: someone else merges it.' : 'Marked ready for review.'
      case ShipFar.Merge:
        return 'Merged once the checks main requires pass.'
      default:
        return unreachable(far)
    }
  },
  makeDefault: 'Make this my default',
  isDefault: (route) => `Your default: ${route}.`,
  insteadOf: (route) => `Instead of ${route}.`,
  routeName: ({ review, far }) => {
    switch (far) {
      case ShipFar.Push:
        return review ? 'Review and push' : 'Push now'
      case ShipFar.Ready:
        return review ? 'Review and mark ready' : 'Push and mark ready'
      case ShipFar.Merge:
        return review ? 'Review and merge' : 'Push and merge'
      default:
        return unreachable(far)
    }
  },
  skipReview: 'Skip the review',
  skipReviewNote: (about) => `Stops the review. The ${about.commits} go up as they are.`,
  howItWorks: 'How Ship works',
  says: ({ review, far }, about, readyAlready) =>
    `Ship ${sentence([
      ...(review ? [`reviews the ${about.commits}`] : []),
      review ? `pushes them to ${about.to}` : `pushes the ${about.commits} to ${about.to}`,
      ...(far === ShipFar.Push || readyAlready ? [] : ['marks it ready for review']),
      ...(far === ShipFar.Merge ? ['merges it once the checks main requires pass'] : []),
    ])}.`,
  intro: 'Ship takes your work toward main, one stop at a time, and stops wherever you’re needed.',
  introEdit: 'Click a stop’s icon to skip it this time.',
  guide: (stop, route, about, readyAlready) => {
    switch (stop) {
      case ShipStop.Review:
        return route.review
          ? `${about.reviewer ?? 'Its reviewer'} reads your ${about.commits}. If it finds something, the lead fixes it and it reads again.`
          : 'Off for this Ship: the commits go up as they are.'
      case ShipStop.Push:
        return route.review
          ? `Once the review passes, the commits go up to ${about.to}. Nothing goes up before.`
          : `The commits go up to ${about.to} straight away.`
      case ShipStop.Ready:
        return readyAlready
          ? 'The pull request is ready for review already.'
          : route.far === ShipFar.Push
            ? 'Off for this Ship: the pull request stays a draft, for you to mark ready later.'
            : 'The pull request is marked ready, so people can review it and every check runs.'
      case ShipStop.Merge:
        return route.far === ShipFar.Merge
          ? about.theirs
            ? 'Merged into main once someone else approves it and the checks main requires pass.'
            : 'Merged into main as soon as the checks main requires pass.'
          : about.theirs
            ? 'Off here: main needs someone else’s approval, so merging is up to them.'
            : 'Off for this Ship: merging stays yours, one press when you’re ready.'
      default:
        return unreachable(stop)
    }
  },
  guideNoReviewer: (about) => `This task has no reviewer, so the ${about.commits} go up as they are.`,
  skip: (stop) => `Skip ${stop} this time`,
  bringBack: (stop) => `Bring ${stop} back`,
  pushAlways: 'Push always goes: it’s what Ship is for',
  off: 'Off',
  gotIt: 'Got it',
  close: 'Close',
  shipAs: ({ review, far }, about) => {
    switch (far) {
      case ShipFar.Push:
        return review ? 'Review, then push' : `Push ${about.commits}`
      case ShipFar.Ready:
        return review ? 'Review, then mark ready' : 'Push and mark ready'
      case ShipFar.Merge:
        return review ? 'Review, then merge' : 'Push and merge'
      default:
        return unreachable(far)
    }
  },
  forThisShip: 'For this Ship only.',
}

/** Whether a route takes a stop: Push always; Ready where it goes that far, or its pull request is ready already. */
export const takes = (route: ShipRoute, stop: ShipStop, readyAlready = false): boolean => {
  switch (stop) {
    case ShipStop.Review:
      return route.review
    case ShipStop.Push:
      return true
    case ShipStop.Ready:
      return readyAlready || route.far !== ShipFar.Push
    case ShipStop.Merge:
      return route.far === ShipFar.Merge
    default:
      return unreachable(stop)
  }
}

/** A stop turned on or off, the route kept whole: Push always goes, and Merge needs Ready. */
export const toggled = (route: ShipRoute, stop: ShipStop, on: boolean): ShipRoute => {
  switch (stop) {
    case ShipStop.Review:
      return { ...route, review: on }
    case ShipStop.Push:
      return route
    case ShipStop.Ready:
      return { ...route, far: on ? ShipFar.Ready : ShipFar.Push }
    case ShipStop.Merge:
      return { ...route, far: on ? ShipFar.Merge : ShipFar.Ready }
    default:
      return unreachable(stop)
  }
}

export const sameRoute = (one: ShipRoute, other: ShipRoute) => one.review === other.review && one.far === other.far

const ICON: Record<ShipStop, IconName> = {
  [ShipStop.Review]: 'search',
  [ShipStop.Push]: 'up',
  [ShipStop.Ready]: 'pr',
  [ShipStop.Merge]: 'after',
}

export interface ShipRouteLineProps {
  route: ShipRoute
  readyAlready?: boolean
  /** Under way: the stop it is at, in bold, the ones before it done and those after faded. */
  at?: ShipStop
  text?: Partial<ShipButtonText>
}

/** The route, small: every stop with arrows between, the ones it skips faded. */
export function ShipRouteLine({ route, readyAlready = false, at, text }: ShipRouteLineProps) {
  const t = { ...shipButtonText, ...text }
  const atIndex = at === undefined ? -1 : ORDER.indexOf(at)
  const taken = ORDER.filter((stop) => takes(route, stop, readyAlready))
  return (
    <small className={s.line} aria-label={t.lineLabel(taken.map((stop) => t.line[stop]))}>
      {ORDER.map((stop, i) => (
        <span
          key={stop}
          className={s.stop}
          aria-hidden="true"
          data-skipped={!takes(route, stop, readyAlready) || undefined}
          data-step={atIndex < 0 ? undefined : i < atIndex ? 'done' : i === atIndex ? 'now' : 'next'}
        >
          {i > 0 && <Icon name="arrow" size={10} className={s.sep} />}
          {t.line[stop]}
        </span>
      ))}
    </small>
  )
}

export interface ShipGuideProps {
  route: ShipRoute
  about: ShipAbout
  readyAlready?: boolean
  /** Whether a review can come first: without a reviewer, its stop can't be turned on, and says why. */
  reviewable?: boolean
  /** Turns a stop on or off for this Ship; without it, the stops are only read. */
  onRoute?: (route: ShipRoute) => void
  /** Ships on the route as it stands: offered once the route has changed here. */
  onShip?: () => void
  onClose: () => void
  text?: Partial<ShipButtonText>
}

/** How Ship works: the stops as a path, in plain words for this route; a click on a stop's icon turns it on or off. */
export function ShipGuide({ route, about, readyAlready = false, reviewable = true, onRoute, onShip, onClose, text }: ShipGuideProps) {
  const t = { ...shipButtonText, ...text }
  // The route it opened on: once it changes here, the dialog ends on the Ship it makes.
  const [opened] = useState(route)
  const changed = !sameRoute(route, opened)
  return (
    <Dialog
      title={t.howItWorks}
      description={onRoute === undefined ? t.intro : `${t.intro} ${t.introEdit}`}
      width={480}
      tall
      onClose={onClose}
      actions={
        changed && onShip !== undefined ? (
          <>
            <Button onClick={onClose}>{t.close}</Button>
            <Button
              variant="signal"
              onClick={() => {
                onShip()
                onClose()
              }}
            >
              {t.shipAs(route, about)}
            </Button>
          </>
        ) : (
          <Button variant="signal" onClick={onClose}>
            {t.gotIt}
          </Button>
        )
      }
    >
      <ol className={s.path}>
        {ORDER.map((stop) => {
          const on = takes(route, stop, readyAlready)
          const noReviewer = stop === ShipStop.Review && !reviewable
          const fixed = stop === ShipStop.Push || (stop === ShipStop.Ready && readyAlready) || noReviewer || onRoute === undefined
          const why = onRoute === undefined ? undefined : stop === ShipStop.Push ? t.pushAlways : noReviewer ? t.noReviewer : undefined
          const name = t.stop[stop]
          return (
            <li key={stop} className={s.step} data-skipped={!on || undefined}>
              {fixed ? (
                <span className={s.mark} {...(why === undefined ? {} : { title: why })}>
                  <Icon name={ICON[stop]} size={14} />
                </span>
              ) : (
                <button
                  type="button"
                  className={cx(s.mark, s.press)}
                  aria-pressed={on}
                  aria-label={on ? t.skip(name) : t.bringBack(name)}
                  title={on ? t.skip(name) : t.bringBack(name)}
                  onClick={() => onRoute?.(toggled(route, stop, !on))}
                >
                  <Icon name={ICON[stop]} size={14} />
                </button>
              )}
              <span className={s.words}>
                <b>
                  {name}
                  {!on && <span className={s.off}>{t.off}</span>}
                </b>
                <span>{noReviewer && !on ? t.guideNoReviewer(about) : t.guide(stop, route, about, readyAlready)}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {changed && onShip !== undefined && <p className={s.foot}>{t.forThisShip}</p>}
    </Dialog>
  )
}

export interface ShipButtonProps {
  /** The route this Ship takes: as chosen for it, else the task's own. */
  route: ShipRoute
  /** Changes the route: before Ship, for this Ship; under way, its route from here. */
  onRoute: (route: ShipRoute) => void
  about: ShipAbout
  /** Whether a review can come first: without a reviewer, Review first stays off. */
  reviewable?: boolean
  /** Its pull request is ready for review already: Ready is no stop to skip. */
  readyAlready?: boolean
  /** The route the person's Ships take unless they choose another; with `onMakeDefault`, the menu offers to make this one it. */
  defaultRoute?: ShipRoute
  onMakeDefault?: () => void
  /** Why it goes less far than their default, at the menu's foot. */
  note?: ReactNode
  /** Ships on the route. Without it, under way. */
  onShip?: () => void
  /** Under way: what it is doing, in Ship's place, and the stop it is at. */
  underWay?: { readonly label: string; readonly at: ShipStop } | null
  /** Under way at its review: stops it, and the commits go up as they are. */
  onSkipReview?: () => void
  disabled?: boolean
  className?: string
  text?: Partial<ShipButtonText>
}

/** Ship, its route on it: the chevron sets the route, a hover says what it does, and How Ship works explains each stop. */
export function ShipButton({
  route,
  onRoute,
  about,
  reviewable = true,
  readyAlready = false,
  defaultRoute,
  onMakeDefault,
  note,
  onShip,
  underWay = null,
  onSkipReview,
  disabled = false,
  className,
  text,
}: ShipButtonProps) {
  const t = { ...shipButtonText, ...text }
  const [guide, setGuide] = useState(false)
  const going = underWay !== null
  const fars = [ShipFar.Push, ShipFar.Ready, ShipFar.Merge].filter(
    // A pull request ready already can't go back to a draft: as far as a push is as far as Ready.
    (far) => !(far === ShipFar.Push && (readyAlready || (going && underWay.at !== ShipStop.Review && underWay.at !== ShipStop.Push))),
  )
  const shownFar = readyAlready && route.far === ShipFar.Push ? ShipFar.Ready : route.far
  const isDefault = defaultRoute === undefined || sameRoute(route, defaultRoute)
  const menu = (
    <>
      {going ? (
        underWay.at === ShipStop.Review &&
        onSkipReview !== undefined && (
          <MenuItem description={t.skipReviewNote(about)} onSelect={onSkipReview}>
            {t.skipReview}
          </MenuItem>
        )
      ) : (
        <MenuSwitchItem
          checked={route.review}
          disabled={!reviewable}
          onCheckedChange={(review) => onRoute({ ...route, review })}
          note={!reviewable ? t.noReviewer : route.review ? t.reviewOn(about) : t.reviewOff(about)}
        >
          {t.reviewFirst}
        </MenuSwitchItem>
      )}
      <MenuSegments
        label={t.goesAsFarAs}
        value={shownFar}
        onChange={(far) => {
          const picked = fars.find((one) => one === far)
          if (picked !== undefined) onRoute({ ...route, far: picked })
        }}
        options={fars.map((far) => ({ value: far, label: t.far[far], description: t.farNote(far, about) }))}
      />
      {defaultRoute !== undefined && onMakeDefault !== undefined && (
        <>
          <MenuSeparator />
          <MenuItem
            disabled={isDefault}
            description={isDefault ? t.isDefault(t.routeName(defaultRoute)) : t.insteadOf(t.routeName(defaultRoute))}
            onSelect={onMakeDefault}
          >
            {t.makeDefault}
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem icon="info" onSelect={() => setGuide(true)}>
        {t.howItWorks}
      </MenuItem>
    </>
  )
  const label = (
    <span className={s.two}>
      <b>{going ? underWay.label : t.ship}</b>{' '}
      <ShipRouteLine route={route} readyAlready={readyAlready} {...(going ? { at: underWay.at } : {})} text={t} />
    </span>
  )
  return (
    <>
      <SplitButton
        variant={going ? 'default' : 'signal'}
        className={cx(s.ship, going && s.going, className)}
        disabled={disabled}
        {...(going ? { 'aria-disabled': true } : {})}
        onClick={going ? undefined : onShip}
        moreLabel={t.more}
        menu={(trigger) => (
          <Menu trigger={trigger} label={t.more} align="end" width={310} {...(note === undefined || going ? {} : { note })}>
            {menu}
          </Menu>
        )}
        {...(going
          ? {}
          : {
              around: (main) => (
                <HoverCard
                  placement="below"
                  align="center"
                  width={300}
                  card={
                    <span className={s.says}>
                      <span>{t.says(route, about, readyAlready)}</span>
                      <LinkButton onClick={() => setGuide(true)}>{t.howItWorks}</LinkButton>
                    </span>
                  }
                >
                  {main}
                </HoverCard>
              ),
            })}
      >
        {label}
      </SplitButton>
      {guide && (
        <ShipGuide
          route={route}
          about={about}
          readyAlready={readyAlready}
          reviewable={reviewable}
          {...(going ? {} : { onRoute, ...(onShip === undefined ? {} : { onShip }) })}
          onClose={() => setGuide(false)}
          text={t}
        />
      )}
    </>
  )
}
