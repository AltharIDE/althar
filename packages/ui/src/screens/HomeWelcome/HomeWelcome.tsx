import { Fragment, type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import type { Brand } from '../../foundations/brands/brands'
import { device } from '../../foundations/device'
import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Light } from '../../foundations/Light/Light'
import { BrandMark } from '../../foundations/Marks/Marks'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { TaskStatus } from '../../foundations/vocabulary'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { morphPairs, type Pace, piecesIn, settle } from './morph'
import s from './HomeWelcome.module.css'

/*
 * A home with no projects yet, opened in a window: its welcome. The first
 * time, a short tour on a card: what the home is (its name, its cores,
 * memory and room, its system and tools), then what work on it has there
 * (its agents, each signed in on the home itself, git, the code hosts it's
 * connected to), each one that isn't ready with the one thing that makes it
 * so. Then the card opens into the window, its paper growing to the edges
 * and melting into them while Althar's light rises, and the tour ends on the
 * arrival: the mark coming up dot by dot over "Welcome to runner-1", and
 * three ways in, each drawn as what's behind it: a clone, a folder already
 * there, or a new repository. Skip goes straight there, and every visit after
 * starts there. A repository's address pasted anywhere goes straight in.
 *
 * Each page morphs into the next (`morph.ts`): its title and line move into
 * the next's, the old clearing before the new comes in, and the card itself
 * opens into the window. With motion reduced, each page is simply there.
 *
 * It only draws: the consumer reads the home and does what's pressed.
 */

/** What the home's computer is, as it says. */
export interface HomeMachine {
  /** As the system names itself: Ubuntu 24.04.1 LTS. */
  readonly system: string
  readonly cores: number
  /** In bytes. */
  readonly memory: number
  /** The room on the disk projects go on, in bytes; null where it couldn't be read. */
  readonly disk: { readonly free: number; readonly size: number } | null
}

/** Something work on the home needs, as it stands there: an agent, git, a code host. */
export type WelcomeNeed = {
  readonly id: string
  readonly name: string
  /** Its mark; without one, `icon`. */
  readonly brand?: Brand
  readonly icon?: IconName
  /** What else says how it stands, in a few words: its version, who it's signed in as. */
  readonly note?: string
} & (
  | { readonly state: 'ready' }
  /** Installed and signed out: its own command for signing in, run in a terminal on the home. */
  | { readonly state: 'signedOut'; readonly command: string }
  /** Not installed: its maker's page on installing it, where there's one. */
  | { readonly state: 'missing'; readonly guide?: string }
  /** Couldn't be checked, and why, in a sentence. */
  | { readonly state: 'unchecked'; readonly why: string }
)

/**
 * Updating an older home from the window, where the window runs it itself: not yet, under way (getting the release,
 * the home restarting, the window reconnecting), or stopped, with why.
 */
export type HomeUpdateRun =
  /**
   * Not yet; `busy`, the tasks running on the home, which its restart stops: asked about before it goes, unless
   * `moves`, where the window asks about the release moving its data instead, and says it there.
   */
  | { readonly state: 'idle'; readonly busy?: number; readonly moves?: boolean }
  /**
   * Asked before it goes: the newest release (`to`) moves the home's data to a new format, kept in a snapshot first,
   * and the home can't go back to the release it runs (`from`) after.
   */
  | { readonly state: 'confirm'; readonly from: string; readonly to: string; readonly busy?: number }
  | { readonly state: 'running'; readonly step: 'getting' | 'restarting' | 'reconnecting' }
  /** `offline` where the window's connection dropped on the way: the home may be back on its old release. */
  | { readonly state: 'failed'; readonly problem: string; readonly offline?: boolean }

/** How an older home is updated: by the window itself, where `run` is given, else by its command, run there. */
export interface HomeUpdateOffer {
  readonly command: string
  /** How sure the window is that the command is how the home was installed (`known` where it's sure, as by default). */
  readonly installed?: 'known' | 'custom' | 'unknown'
  /** The window runs it itself, over SSH: how that stands. */
  readonly run?: HomeUpdateRun
  /**
   * Whether a published release would help, where the window looks first: being looked for, or none is out yet
   * (`unreleased`), which says so in place of the update, with Check again.
   */
  readonly release?: 'checking' | 'unreleased'
}

/** The line over an older home's update: that it's older, or, where no release would help yet, what's to come. */
export const olderLine = (t: Pick<HomeWelcomeText, 'older' | 'unreleased'>, name: string, update: HomeUpdateOffer) =>
  update.release === 'unreleased' ? t.unreleased.arrival(name) : t.older(name)

/** A way a new project's code comes in. */
export type HomeDoor = 'clone' | 'folder' | 'fresh'

export interface HomeWelcomeText {
  label: string
  pages: { home: string; ready: string; projects: string }
  track: string
  /** Read out as a page comes up. */
  page: (at: number, of: number, title: string) => string
  skip: string
  skipLabel: string
  back: string
  next: string
  open: string
  thisIs: (name: string) => string
  homeLine: string
  cores: string
  memory: string
  free: string
  gb: string
  of: (size: string) => string
  unknown: string
  readyTitle: (name: string) => string
  readyLine: (name: string) => string
  readyLabel: (name: string) => string
  checking: string
  signedOut: string
  /** Its sign-in, started in Settings. */
  signIn: string
  signInLabel: (agent: string, home: string) => string
  missing: string
  copy: string
  copyLabel: (name: string) => string
  copied: string
  guide: string
  welcomeTo: string
  arrivalLine: (name: string) => string
  doors: string
  clone: { title: string; line: string }
  folder: { title: (name: string) => string; line: (found: number | 'failed' | null, name: string) => string }
  fresh: { title: string; line: (name: string) => string }
  older: (name: string) => string
  /** Where no published release makes projects from a window yet. */
  unreleased: { arrival: (name: string) => string; title: string; line: (name: string) => string }
  /** While the newest release is looked for. */
  looking: string
  updateLabel: (name: string) => string
  update: {
    /** What the update brings, over what pressing it does. */
    title: string
    line: (name: string) => string
    press: (name: string) => string
    running: (name: string) => string
    steps: { getting: string; restarting: (name: string) => string; reconnecting: string }
    /** Tasks running on the home, which its restart stops. */
    busy: (count: number, name: string) => string
    /** Asked before an update that stops them. */
    stop: (count: number) => string
    stopLine: (name: string) => string
    anyway: string
    /** Asked before a release that moves the home's data to a new format. */
    moves: {
      title: (name: string, to: string) => string
      line: (name: string, from: string, busy: number) => string
      press: string
    }
    cancel: string
    failed: (name: string) => string
    tryAgain: string
    reconnect: string
    /** Where the window can't run it: updated there, then looked at again. */
    there: (name: string) => string
    thereLine: string
    checkAgain: string
    /** Opens the command, run on the home by hand: where the window tried and couldn't, and where it can't. */
    byHand: (name: string) => string
    how: string
  }
  /** Under the update command, where the window can't be sure it's how the home was installed. */
  updateUnsure: (name: string, installed: 'custom' | 'unknown') => string
  copyUpdate: string
}

export const homeWelcomeText: HomeWelcomeText = {
  label: 'Welcome',
  pages: { home: 'The home', ready: 'What it has', projects: 'Projects' },
  track: 'Pages',
  page: (at, of, title) => `Page ${at} of ${of}: ${title}`,
  skip: 'Skip',
  skipLabel: 'Skip the tour',
  back: 'Back',
  next: 'Next',
  open: 'Continue',
  thisIs: (name) => `This is ${name}`,
  homeLine: `Tasks you start in this window run on it, and keep going with ${device.this} closed.`,
  cores: 'Cores',
  memory: 'Memory',
  free: 'Free',
  gb: 'GB',
  of: (size) => `GB of ${size}`,
  unknown: '–',
  readyTitle: (name) => `What ${name} has`,
  readyLine: (name) => `Its agents sign in on ${name} itself, as in a terminal there. Nothing comes over from ${device.this}.`,
  readyLabel: (name) => `On ${name}`,
  checking: 'Checking…',
  signedOut: 'Signed out',
  signIn: 'Sign in',
  signInLabel: (agent, home) => `Sign ${agent} in on ${home}`,
  missing: 'Not installed',
  copy: 'Copy',
  copyLabel: (name) => `Copy ${name}’s sign-in command`,
  copied: 'Copied',
  guide: 'How to install',
  welcomeTo: 'Welcome to',
  arrivalLine: (name) => `Bring it a project. Its tasks run on ${name}, and keep going with ${device.this} asleep.`,
  doors: 'Ways in',
  clone: { title: 'Clone a repository', line: 'From GitHub, GitLab or any address' },
  folder: {
    title: (name) => `A folder on ${name}`,
    line: (found, name) =>
      found === null
        ? 'Looking…'
        : found === 'failed'
          ? `Couldn’t look on ${name} just now`
          : found === 1
            ? `1 repository found on ${name}`
            : `${found} repositories found on ${name}`,
  },
  fresh: { title: 'Start empty', line: (name) => `A new repository, made on ${name}` },
  older: (name) => `${name} runs an older Althar. Once it’s updated, you can bring it projects from here.`,
  unreleased: {
    arrival: (name) => `${name} runs an Althar host from before projects could be made from here.`,
    title: 'No newer release yet',
    line: (name) => `The next Althar host release brings it. Once it’s out, update ${name} here.`,
  },
  looking: 'Looking for the newest release',
  updateLabel: (name) => `Updating ${name}`,
  update: {
    title: 'The newest Althar',
    line: (name) => `${name} restarts once, in a minute or two.`,
    press: (name) => `Update ${name}`,
    running: (name) => `Updating ${name}`,
    steps: { getting: 'Getting the new release', restarting: (name) => `Restarting ${name}`, reconnecting: 'Reconnecting' },
    busy: (count, name) => `${count === 1 ? '1 task is' : `${count} tasks are`} running on ${name}. They stop while it restarts.`,
    stop: (count) => (count === 1 ? 'Stop the running task?' : `Stop ${count} running tasks?`),
    stopLine: (name) => `${name} restarts to update, and its running tasks stop with it.`,
    anyway: 'Update anyway',
    moves: {
      title: (name, to) => `Update ${name} to ${to}?`,
      line: (name, from, busy) =>
        busy === 0
          ? `Its data moves to a new format, with a snapshot kept. ${name} can’t go back to ${from} after.`
          : `Its data moves to a new format, with a snapshot kept. ${busy === 1 ? 'Its running task stops' : `Its ${busy} tasks stop`}, and it can’t go back to ${from}.`,
      press: 'Update',
    },
    cancel: 'Cancel',
    failed: (name) => `Couldn’t update ${name}`,
    tryAgain: 'Try again',
    reconnect: 'Reconnect',
    there: (name) => `Update it on ${name}`,
    thereLine: 'Then check again here.',
    checkAgain: 'Check again',
    byHand: (name) => `Update it on ${name} yourself`,
    how: 'How to update it',
  },
  updateUnsure: (name, installed) =>
    installed === 'custom'
      ? `That’s the launcher this window connects with. If it runs ${name} from a source checkout, pull and rebuild there instead.`
      : `That’s for a home Althar installed. If you set ${name} up another way, update it that way.`,
  copyUpdate: 'Copy the update command',
}

export interface HomeWelcomeProps {
  /** The home, by its name: runner-1. */
  name: string
  /** Where it's reached, over its name: althar@runner-1. */
  at: string
  /** What its computer is; null while it's asked. */
  machine: HomeMachine | null
  /** git there, by its version; null where there's none, undefined while it's asked. */
  git?: string | null
  /** What work there needs, as it stands there; null while it's read. */
  needs: readonly WelcomeNeed[] | null
  /** The newest of your repositories on the code hosts it's connected to, drawn on the clone door; none where it has none. */
  repositories: readonly { readonly id: string; readonly ink: ProjectInk }[]
  /** Where the repositories found on it are (~/code/site), drawn on the folder door; null while they're looked for, `failed` where they couldn't be. */
  found: readonly string[] | 'failed' | null
  /**
   * The home is older than making projects from a window: its command for
   * updating, run there, in place of the ways in, and no tour; and how sure
   * the window is that it's how the home was installed, said under it where
   * it isn't (`known` where it's sure, as by default).
   */
  update?: HomeUpdateOffer
  /** Update pressed, or Try again: the window updates the home itself (`update.run`), or asks first (`confirm`). */
  onUpdate?: () => void
  /** Not now, asked before a release that moves the home's data (`confirm`). */
  onCancelUpdate?: () => void
  /** Check again pressed, where the home was updated by hand: the window looks at it again. */
  onCheckAgain?: () => void
  /** Sign in pressed on an agent signed out on the home, by its id: its sign-in, started. Without it, its command is copied. */
  onSignIn?: (id: string) => void
  /** A way in pressed, from the door pressed. */
  onDoor: (door: HomeDoor, from: HTMLElement) => void
  /** Something pasted anywhere but a field: true where it was a repository's address, taken in as a clone. */
  onPaste?: (text: string) => boolean
  /** The tour was seen on this home before: it starts on the arrival. */
  toured: boolean
  /** The tour was ended or skipped. */
  onToured: () => void
  /** Copies a command to the clipboard. */
  onCopy: (command: string) => void
  /** Opens a maker's page on installing their tool, in the browser. */
  onGuide: (url: string) => void
  className?: string
  text?: Partial<HomeWelcomeText>
}

type Page = 'home' | 'ready' | 'projects'
const PAGES: readonly Page[] = ['home', 'ready', 'projects']
const LAST = PAGES.length - 1

const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canMorph = (element: HTMLElement) => typeof element.animate === 'function' && !reduced()
/** A page on the card, and the card opening into the window or closing again. */
const OPEN = 'cubic-bezier(0.55, 0, 0.15, 1)'
const STEP: Pace = { length: 560, easing: 'cubic-bezier(0.4, 0, 0.1, 1)', out: 200, inAt: 140, inFor: 320 }
const OPENING: Pace = { length: 960, easing: OPEN, out: 300, inAt: 320, inFor: 520 }

/** Keys typed into a field, or into what's open over the welcome, are theirs. */
const theirs = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]') !== null

const gigabytes = (bytes: number, base: number) => Math.round(bytes / base ** 3)
const sizeOf = (bytes: number) => {
  const gb = gigabytes(bytes, 1000)
  return gb >= 1000 ? `${(gb / 1000).toFixed(gb >= 10_000 ? 0 : 1).replace(/\.0$/, '')} TB` : String(gb)
}

/**
 * A command to run, whole, wrapping only between its words where it's longer
 * than the line: never inside one, as at a flag's dashes, unless a word is
 * longer than the line itself. Copied as it is.
 */
export function CommandText({ command, className }: { readonly command: string; readonly className?: string }) {
  return (
    <code className={cx(s.command, className)}>
      {command.split(' ').map((word, at) => (
        <Fragment key={at}>
          {at > 0 && ' '}
          <span className={s.commandWord}>{word}</span>
        </Fragment>
      ))}
    </code>
  )
}

export function HomeWelcome({
  name,
  at,
  machine,
  git,
  needs,
  repositories,
  found,
  update,
  onUpdate,
  onCancelUpdate,
  onCheckAgain,
  onSignIn,
  onDoor,
  onPaste,
  toured,
  onToured,
  onCopy,
  onGuide,
  className,
  text,
}: HomeWelcomeProps) {
  const t = { ...homeWelcomeText, ...text }
  // Whether this visit tours is settled as it opens: seen once, every visit after starts on the arrival. An older home,
  // which can't say what it is, starts there too.
  const [touring] = useState(!toured && update === undefined)
  const [page, setPage] = useState(touring ? 0 : LAST)
  const open = page === LAST
  const stage = useRef<HTMLElement>(null)
  const card = useRef<HTMLElement>(null)
  const head = useRef<HTMLElement>(null)
  const paper = useRef<HTMLSpanElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const arrivalTitle = useRef<HTMLHeadingElement>(null)
  /** Lands the morph under way at once, where another starts before it's done. */
  const landing = useRef<(() => void) | null>(null)
  const ended = useRef(toured)
  const titleId = useId()
  const [copied, setCopied] = useState<string | null>(null)

  const end = () => {
    if (ended.current) return
    ended.current = true
    onToured()
  }

  // A repository's address pasted anywhere but a field goes straight in.
  const paste = useRef(onPaste)
  useLayoutEffect(() => {
    paste.current = onPaste
  })
  useEffect(() => {
    const onPasted = (event: ClipboardEvent) => {
      if (event.defaultPrevented || theirs(event.target)) return
      const said = event.clipboardData?.getData('text') ?? ''
      if (said.trim() !== '' && paste.current?.(said.trim()) === true) event.preventDefault()
    }
    window.addEventListener('paste', onPasted)
    return () => window.removeEventListener('paste', onPasted)
  }, [])

  // Copied says so on its button a moment, then the button is as it was.
  useEffect(() => {
    if (copied === null) return
    const done = setTimeout(() => setCopied(null), 1600)
    return () => clearTimeout(done)
  }, [copied])
  const copy = (need: string, command: string) => {
    onCopy(command)
    setCopied(need)
  }

  /**
   * Turns to page `to`, morphing: what the pages share moves into its place
   * on the next, the rest of the old fades out and the rest of the new fades
   * in. Opening, the card's paper also grows to past the window's edges and
   * melts into it, and its head glides to the window's top; closing, the
   * paper comes back from there into the card. Everything is read once
   * before the change and once after it; only transforms and opacity move.
   */
  const turn = (to: number) => {
    landing.current?.()
    const opening = to === LAST
    const closing = page === LAST
    // Focus follows the page: opened, onto the arrival's title; on the card, onto Next, which stays put between pages.
    const focus = () => (opening ? arrivalTitle.current : next.current)?.focus({ preventScroll: true })
    const holder = stage.current
    const root = card.current
    const sheet = paper.current
    const bar = head.current
    if (holder === null || root === null || sheet === null || bar === null || !canMorph(root)) {
      flushSync(() => setPage(to))
      if (opening || closing) focus()
      return
    }
    const pace = opening || closing ? OPENING : STEP
    const sBox = holder.getBoundingClientRect()
    const cBox = root.getBoundingClientRect()
    const p0 = sheet.getBoundingClientRect()
    const h0 = bar.getBoundingClientRect()
    const before = new Map(piecesIn(root).map((one) => [one.key, one]))
    const ghost = root.cloneNode(true) as HTMLElement
    for (const one of [sheet, bar]) for (const move of one.getAnimations()) move.cancel()
    if (closing) sheet.style.borderRadius = ''

    flushSync(() => setPage(to))
    if (opening || closing) focus()

    const fresh = root.querySelector<HTMLElement>('[data-morph-root]')
    if (fresh === null) return
    settle(fresh)
    const p1 = sheet.getBoundingClientRect()
    const h1 = bar.getBoundingClientRect()
    const pairs = piecesIn(fresh).flatMap((b) => {
      const a = before.get(b.key)
      return a === undefined ? [] : [{ a, b }]
    })

    // The old card, still, over the new, its matched pieces left to their copies.
    ghost.querySelectorAll('[id]').forEach((one) => one.removeAttribute('id'))
    ghost.classList.add(s.ghost ?? 'ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    Object.assign(ghost.style, {
      left: `${cBox.left - sBox.left}px`,
      top: `${cBox.top - sBox.top}px`,
      width: `${cBox.width}px`,
      height: `${cBox.height}px`,
    })
    // On the card its foot stays; opening, it goes with the rest.
    if (!opening) ghost.querySelector<HTMLElement>(':scope > footer')?.style.setProperty('visibility', 'hidden')
    for (const { a } of pairs) ghost.querySelector<HTMLElement>(`[data-morph="${a.key}"]`)?.style.setProperty('visibility', 'hidden')
    holder.append(ghost)
    const { laid, hidden, moves } = morphPairs(pairs, holder, sBox, s.ghost ?? 'ghost', pace)
    laid.push(ghost)

    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: pace.out, easing: 'linear', fill: 'forwards' })
    const arriving = closing ? [fresh, root.querySelector<HTMLElement>(':scope > footer')] : [fresh]
    for (const one of arriving)
      one?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: pace.inFor, delay: pace.inAt, easing: 'linear', fill: 'backwards' })

    if (opening || closing) {
      const sx = p0.width / p1.width
      const sy = p0.height / p1.height
      // Opening, the card's corners as they were, at the scale it starts from.
      if (opening) sheet.style.borderRadius = `${20 / sx}px / ${20 / sy}px`
      sheet.animate([{ transform: `translate(${p0.left - p1.left}px, ${p0.top - p1.top}px) scale(${sx}, ${sy})` }, { transform: 'none' }], {
        duration: pace.length,
        easing: pace.easing,
      })
      sheet.animate(
        opening
          ? [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }]
          : [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }],
        { duration: opening ? 1300 : pace.length, easing: 'linear' },
      )
      bar.animate([{ transform: `translate(${h0.left - h1.left}px, ${h0.top - h1.top}px)` }, { transform: 'none' }], {
        duration: pace.length,
        easing: pace.easing,
      })
    }

    let landed = false
    const land = () => {
      if (landed) return
      landed = true
      for (const one of laid) one.remove()
      for (const one of hidden) one.style.visibility = ''
      // Its title was hidden under its copy, which takes focus off it: it goes back once it stands, unless focus moved on.
      if ((opening || closing) && (document.activeElement === null || document.activeElement === document.body)) focus()
      if (landing.current === land) landing.current = null
    }
    landing.current = land
    void Promise.allSettled([...moves.map((one) => one.finished), new Promise((done) => setTimeout(done, pace.out))]).then(land)
  }

  const go = (to: number) => {
    const target = Math.max(0, Math.min(LAST, to))
    if (target === page) return
    if (target === LAST) end()
    turn(target)
  }

  // On the card, the arrows turn a page at a time, from where it is; keys typed into a field, or with a modifier, are theirs.
  const step = useRef((by: number) => go(page + by))
  useLayoutEffect(() => {
    step.current = (by: number) => go(page + by)
  })
  useEffect(() => {
    if (!touring || open) return
    const onArrow = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || theirs(event.target)) return
      if (event.key === 'ArrowRight') step.current(1)
      else if (event.key === 'ArrowLeft') step.current(-1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onArrow)
    return () => window.removeEventListener('keydown', onArrow)
  }, [touring, open])

  // Landed under way as the welcome goes, nothing is left over the window.
  useEffect(() => () => landing.current?.(), [])

  const arrival = (
    <Arrival
      name={name}
      eyebrow={machine === null ? at : `${at} · ${machine.system}`}
      titleId={titleId}
      titleRef={arrivalTitle}
      needs={needs}
      repositories={repositories}
      found={found}
      update={update}
      onUpdate={onUpdate}
      onCancelUpdate={onCancelUpdate}
      onCheckAgain={onCheckAgain}
      onDoor={onDoor}
      copied={copied}
      onCopy={copy}
      onGuide={onGuide}
      onSignIn={onSignIn}
      t={t}
    />
  )

  if (!touring)
    return (
      <main className={cx(s.stage, s.arriving, className)} aria-labelledby={titleId}>
        <div className={s.light} aria-hidden="true">
          <Light height={0.82} />
        </div>
        {arrival}
      </main>
    )

  const title = page === 0 ? t.thisIs(name) : page === 1 ? t.readyTitle(name) : `${t.welcomeTo} ${name}`
  return (
    <main ref={stage} className={cx(s.stage, s.touring, className)} data-morph-root aria-labelledby={titleId}>
      <div className={s.light} aria-hidden="true">
        <div className={s.lift} data-open={open || undefined}>
          <Light height={0.55} />
        </div>
      </div>
      <output className={s.said}>{t.page(page + 1, PAGES.length, title)}</output>
      <section ref={card} className={s.card} data-open={open || undefined} aria-label={t.label}>
        <span ref={paper} className={s.paper} aria-hidden="true" />
        <header ref={head} className={s.head}>
          <span className={s.brand}>
            <Icon name="home" size={16} />
            <span className={s.brandName} title={name}>
              {name}
            </span>
          </span>
          <StepTrack
            steps={trackOf(
              PAGES.map((one) => t.pages[one]),
              page,
            )}
            status={TaskStatus.Running}
            labels
            className={s.track}
            text={{ label: t.track }}
          />
          {open ? (
            <LinkButton className={s.skip} onClick={() => go(page - 1)}>
              {t.back}
            </LinkButton>
          ) : (
            <LinkButton className={s.skip} onClick={() => go(LAST)} aria-label={t.skipLabel}>
              {t.skip}
            </LinkButton>
          )}
        </header>
        {open ? (
          arrival
        ) : (
          <>
            <div key={page} className={s.body} data-morph-root>
              {page === 0 ? (
                <HomeFacts name={name} at={at} machine={machine} git={git} needs={needs} titleId={titleId} t={t} />
              ) : (
                <>
                  <div className={s.words}>
                    <h1 id={titleId} className={cx(s.display, s.title)} data-morph="title">
                      {t.readyTitle(name)}
                    </h1>
                    <p className={s.line} data-morph="line">
                      {t.readyLine(name)}
                    </p>
                  </div>
                  <div className={s.scene}>
                    <NeedList name={name} needs={needs} copied={copied} onCopy={copy} onGuide={onGuide} onSignIn={onSignIn} t={t} />
                  </div>
                </>
              )}
            </div>
            <footer className={s.foot}>
              {page > 0 && <LinkButton onClick={() => go(page - 1)}>{t.back}</LinkButton>}
              <span className={s.grow} />
              <Button ref={next} variant="signal" onClick={() => go(page + 1)}>
                {page === LAST - 1 ? t.open : t.next}
              </Button>
            </footer>
          </>
        )}
      </section>
    </main>
  )
}

/** A name's letters as they're read: an accented letter or an emoji is one. */
const lettersOf = (text: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (one) => one.segment)

/** A name a letter at a time, each clearing where it stands; read as a whole by its heading. */
function Letters({ of }: { of: string }) {
  return (
    <span className={s.name} aria-hidden="true">
      {lettersOf(of).map((letter, i) => (
        <span key={i} style={cssVars({ '--i': i })}>
          {letter}
        </span>
      ))}
    </span>
  )
}

/** The home's first page: its name arriving, and what it is set out as a spec, each figure landing in turn and then standing still. */
function HomeFacts({
  name,
  at,
  machine,
  git,
  needs,
  titleId,
  t,
}: {
  name: string
  at: string
  machine: HomeMachine | null
  git: string | null | undefined
  needs: readonly WelcomeNeed[] | null
  titleId: string
  t: HomeWelcomeText
}) {
  const figures: ReadonlyArray<{ what: string; value: string; unit?: string }> = [
    { what: t.cores, value: machine === null ? t.unknown : String(machine.cores) },
    { what: t.memory, value: machine === null ? t.unknown : String(gigabytes(machine.memory, 1024)), unit: t.gb },
    {
      what: t.free,
      value: machine?.disk == null ? t.unknown : String(gigabytes(machine.disk.free, 1000)),
      ...(machine?.disk == null ? {} : { unit: t.of(sizeOf(machine.disk.size)) }),
    },
  ]
  const agents = (needs ?? []).filter((one) => one.state === 'ready' && one.brand !== undefined)
  return (
    <div className={s.answering}>
      <div className={s.words}>
        <span className={s.eyebrow} data-morph="eyebrow">
          <span className={s.dot} aria-hidden="true" />
          {at}
        </span>
        <h1 id={titleId} className={cx(s.display, s.title, s.hello)} aria-label={t.thisIs(name)} data-morph="title">
          <span aria-hidden="true">{t.thisIs('')}</span>
          <Letters of={name} />
        </h1>
        <p className={s.line} data-morph="line">
          {t.homeLine}
        </p>
      </div>
      <div className={s.spec}>
        <dl className={s.figures} aria-busy={machine === null || undefined}>
          {figures.map((one, i) => (
            <div key={one.what} className={s.figure} style={cssVars({ '--i': i })}>
              <dt>{one.what}</dt>
              <dd>
                <b>{one.value}</b>
                {one.unit !== undefined && <small>{one.unit}</small>}
              </dd>
            </div>
          ))}
        </dl>
        <p className={s.tools}>
          {machine !== null && <span>{machine.system}</span>}
          {git != null && <span>git {git}</span>}
          {agents.map((one) => (
            <span key={one.id} data-ready>
              <Icon name="check" size={11} />
              {one.note === undefined ? one.name : `${one.name} ${one.note}`}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}

/** Its mark: a brand's, or an icon. */
const markOf = (need: WelcomeNeed, size: number) =>
  need.brand === undefined ? <Icon name={need.icon ?? 'plug'} size={size} /> : <BrandMark brand={need.brand} size={size} />

/** What a need that isn't ready takes: its sign-in, started (or its command to copy, where it can't be), or its maker's page. */
function Fix({
  home,
  need,
  copied,
  onCopy,
  onGuide,
  onSignIn,
  t,
}: {
  home: string
  need: WelcomeNeed
  copied: string | null
  onCopy: (id: string, command: string) => void
  onGuide: (url: string) => void
  onSignIn: ((id: string) => void) | undefined
  t: HomeWelcomeText
}) {
  if (need.state === 'signedOut' && onSignIn !== undefined)
    return (
      <Button size="small" onClick={() => onSignIn(need.id)} aria-label={t.signInLabel(need.name, home)}>
        {t.signIn}
      </Button>
    )
  if (need.state === 'signedOut')
    return (
      <Button
        size="small"
        icon={copied === need.id ? 'check' : 'copy'}
        onClick={() => onCopy(need.id, need.command)}
        aria-label={t.copyLabel(need.name)}
      >
        {copied === need.id ? t.copied : t.copy}
      </Button>
    )
  if (need.state === 'missing' && need.guide !== undefined) {
    const guide = need.guide
    return (
      <LinkButton className={s.needLink} onClick={() => onGuide(guide)}>
        {t.guide}
      </LinkButton>
    )
  }
  return null
}

/** What a need says beside its name: how it stands where it isn't ready, else its note. */
const noteOf = (need: WelcomeNeed, t: HomeWelcomeText) => {
  if (need.state === 'signedOut') return t.signedOut
  if (need.state === 'missing') return t.missing
  if (need.state === 'unchecked') return need.why
  return need.note
}

/** What work on the home needs, a row each: ready with a tick, or the one thing that makes it so. */
function NeedList({
  name,
  needs,
  copied,
  onCopy,
  onGuide,
  onSignIn,
  t,
}: {
  name: string
  needs: readonly WelcomeNeed[] | null
  copied: string | null
  onCopy: (id: string, command: string) => void
  onGuide: (url: string) => void
  onSignIn: ((id: string) => void) | undefined
  t: HomeWelcomeText
}) {
  return (
    <ul className={s.needs} aria-label={t.readyLabel(name)} aria-busy={needs === null || undefined}>
      {needs === null ? (
        <li className={s.checking}>{t.checking}</li>
      ) : (
        needs.map((need, i) => (
          <li key={need.id} data-state={need.state} style={cssVars({ '--i': i })}>
            <span className={s.needMark}>{markOf(need, 16)}</span>
            <span className={s.needName}>{need.name}</span>
            {need.state === 'signedOut' && onSignIn === undefined ? (
              <span className={s.needNote} data-code title={need.command}>
                <span className={s.needState}>{t.signedOut}</span>
                <code>{need.command}</code>
              </span>
            ) : (
              <span className={s.needNote} title={noteOf(need, t)}>
                {noteOf(need, t)}
              </span>
            )}
            <span className={s.needEnd}>
              {need.state === 'ready' ? (
                <Icon name="check" size={14} className={s.needTick} />
              ) : (
                <Fix home={name} need={need} copied={copied} onCopy={onCopy} onGuide={onGuide} onSignIn={onSignIn} t={t} />
              )}
            </span>
          </li>
        ))
      )}
    </ul>
  )
}

/** The arrival: the mark coming up, "Welcome to runner-1", the ways in, and what the home has along the foot. */
function Arrival({
  name,
  eyebrow,
  titleId,
  titleRef,
  needs,
  repositories,
  found,
  update,
  onUpdate,
  onCancelUpdate,
  onCheckAgain,
  onDoor,
  copied,
  onCopy,
  onGuide,
  onSignIn,
  t,
}: {
  name: string
  eyebrow: string
  titleId: string
  titleRef: RefObject<HTMLHeadingElement | null>
  needs: readonly WelcomeNeed[] | null
  repositories: HomeWelcomeProps['repositories']
  found: HomeWelcomeProps['found']
  update: HomeWelcomeProps['update']
  onUpdate: HomeWelcomeProps['onUpdate']
  onCancelUpdate: HomeWelcomeProps['onCancelUpdate']
  onCheckAgain: HomeWelcomeProps['onCheckAgain']
  onDoor: HomeWelcomeProps['onDoor']
  copied: string | null
  onCopy: (id: string, command: string) => void
  onGuide: (url: string) => void
  onSignIn: HomeWelcomeProps['onSignIn']
  t: HomeWelcomeText
}) {
  return (
    <div className={s.arrival} data-morph-root>
      <div className={s.arrivalHead}>
        <HalftoneMark size={64} className={s.mark} />
        <span className={s.eyebrow} data-morph="eyebrow" data-morph-at="center">
          {eyebrow}
        </span>
        <h1
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className={cx(s.display, s.arrivalTitle)}
          aria-label={`${t.welcomeTo} ${name}`}
          data-morph="title"
          data-morph-at="center"
        >
          <span className={s.welcome} aria-hidden="true">
            {t.welcomeTo}
          </span>{' '}
          <Letters of={name} />
        </h1>
        <p className={s.arrivalLine} data-morph="line" data-morph-at="center">
          {update === undefined ? t.arrivalLine(name) : olderLine(t, name, update)}
        </p>
      </div>
      {update === undefined ? (
        <Doors name={name} repositories={repositories} found={found} onDoor={onDoor} t={t} />
      ) : (
        <UpdateHome
          name={name}
          update={update}
          onUpdate={onUpdate}
          onCancelUpdate={onCancelUpdate}
          onCheckAgain={onCheckAgain}
          copied={copied === 'update'}
          onCopy={() => onCopy('update', update.command)}
          text={t}
        />
      )}
      {/* An older home takes nothing else until it's updated: what it has shows once it can take a project. */}
      {update === undefined && needs !== null && needs.length > 0 && (
        <ul className={s.strip} aria-label={t.readyLabel(name)}>
          {needs.map((need) => (
            <li key={need.id} data-state={need.state}>
              {markOf(need, 13)}
              <span className={s.stripName}>{need.name}</span>
              {need.state === 'ready' ? (
                <Icon name="check" size={12} className={s.stripTick} />
              ) : (
                <>
                  <span className={s.stripState}>
                    {need.state === 'signedOut' ? t.signedOut : need.state === 'missing' ? t.missing : need.why}
                  </span>
                  <Fix home={name} need={need} copied={copied} onCopy={onCopy} onGuide={onGuide} onSignIn={onSignIn} t={t} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * An older home's update, in place of the ways in: one panel that stays where it is as it goes. Where the window runs
 * it, its press, then where it's got to, then why it stopped, with Try again; where it can't, Check again for once
 * it's updated there. The command, to run there by hand, only folded away under it: where the window can't run it,
 * or where it tried and couldn't.
 */
export function UpdateHome({
  name,
  update,
  onUpdate,
  onCancelUpdate,
  onCheckAgain,
  copied,
  onCopy,
  className,
  text,
}: {
  name: string
  update: HomeUpdateOffer
  onUpdate?: (() => void) | undefined
  onCancelUpdate?: (() => void) | undefined
  onCheckAgain?: (() => void) | undefined
  /** The command was copied a moment ago. */
  copied: boolean
  onCopy: () => void
  className?: string
  text?: Partial<HomeWelcomeText>
}) {
  const t = { ...homeWelcomeText, ...text }
  const run = update.run
  const busy = run?.state === 'idle' || run?.state === 'confirm' ? (run.busy ?? 0) : 0
  // Pressed on a busy home: asked first, in the same panel, unless the window asks itself (`moves`). Anything else under way ends the asking.
  const [asking, setAsking] = useState(false)
  if (asking && (run?.state !== 'idle' || busy === 0)) setAsking(false)
  const release = update.release
  const state = release ?? (run === undefined ? 'there' : asking ? 'asking' : run.state)
  const steps = [t.update.steps.getting, t.update.steps.restarting(name), t.update.steps.reconnecting]
  const at = run?.state === 'running' ? (['getting', 'restarting', 'reconnecting'] as const).indexOf(run.step) : 0
  const title =
    release === 'unreleased'
      ? t.unreleased.title
      : release === 'checking'
        ? t.update.title
        : run === undefined
          ? t.update.there(name)
          : run.state === 'confirm'
            ? t.update.moves.title(name, run.to)
            : asking
              ? t.update.stop(busy)
              : run.state === 'idle'
                ? t.update.title
                : run.state === 'running'
                  ? t.update.running(name)
                  : t.update.failed(name)
  const line =
    release === 'unreleased'
      ? t.unreleased.line(name)
      : release === 'checking'
        ? t.looking
        : run === undefined
          ? t.update.thereLine
          : run.state === 'confirm'
            ? t.update.moves.line(name, run.from, busy)
            : asking
              ? t.update.stopLine(name)
              : run.state === 'idle'
                ? busy > 0
                  ? t.update.busy(busy, name)
                  : t.update.line(name)
                : run.state === 'running'
                  ? steps[at]
                  : run.problem
  return (
    <section className={cx(s.updating, className)} aria-label={t.updateLabel(name)}>
      <div className={s.update} data-state={state}>
        <span className={s.updateTile} aria-hidden="true">
          {state === 'running' || state === 'checking' ? (
            <Spinner size="large" />
          ) : (
            <Icon name={state === 'failed' || state === 'asking' ? 'problem' : state === 'unreleased' ? 'clock' : 'download'} size={20} />
          )}
        </span>
        <span className={s.updateText} aria-live="polite">
          <span className={s.updateTitle}>{title}</span>
          <span className={s.updateLine} title={line}>
            {line}
          </span>
        </span>
        <span className={s.updateEnd}>
          {release === 'checking' ? null : release === 'unreleased' ? (
            onCheckAgain !== undefined && (
              <Button icon="reload" onClick={onCheckAgain}>
                {t.update.checkAgain}
              </Button>
            )
          ) : run?.state === 'running' ? (
            <StepTrack steps={trackOf(steps, at)} className={s.updateTrack} text={{ label: t.updateLabel(name) }} />
          ) : run === undefined ? (
            onCheckAgain !== undefined && (
              <Button icon="reload" onClick={onCheckAgain}>
                {t.update.checkAgain}
              </Button>
            )
          ) : run.state === 'confirm' ? (
            <span className={s.updateActions}>
              <LinkButton onClick={onCancelUpdate}>{t.update.cancel}</LinkButton>
              <Button variant="signal" onClick={onUpdate}>
                {t.update.moves.press}
              </Button>
            </span>
          ) : asking ? (
            <span className={s.updateActions}>
              <LinkButton onClick={() => setAsking(false)}>{t.update.cancel}</LinkButton>
              <Button
                variant="danger"
                onClick={() => {
                  setAsking(false)
                  onUpdate?.()
                }}
              >
                {t.update.anyway}
              </Button>
            </span>
          ) : run.state === 'failed' ? (
            <span className={s.updateActions}>
              {run.offline === true && onCheckAgain !== undefined && <Button onClick={onCheckAgain}>{t.update.reconnect}</Button>}
              <Button variant="signal" onClick={onUpdate}>
                {t.update.tryAgain}
              </Button>
            </span>
          ) : (
            <Button variant="signal" onClick={busy > 0 && run.moves !== true ? () => setAsking(true) : onUpdate}>
              {t.update.press(name)}
            </Button>
          )}
        </span>
      </div>
      {release === undefined && (run === undefined || run.state === 'failed') && (
        <Disclosure className={s.byHand}>
          <DisclosureTrigger>
            <LinkButton className={s.byHandTrigger}>
              {run === undefined ? t.update.how : t.update.byHand(name)}
              <Caret />
            </LinkButton>
          </DisclosureTrigger>
          <Fold bleed={false} className={s.byHandFold}>
            <div className={s.byHandBody}>
              <div className={s.byHandCommand}>
                <CommandText command={update.command} className={s.updateCommand} />
                <Button size="small" icon={copied ? 'check' : 'copy'} onClick={onCopy} aria-label={t.copyUpdate}>
                  {copied ? t.copied : t.copy}
                </Button>
              </div>
              {update.installed !== undefined && update.installed !== 'known' && (
                <p className={s.updateUnsure}>{t.updateUnsure(name, update.installed)}</p>
              )}
            </div>
          </Fold>
        </Disclosure>
      )}
    </section>
  )
}

/**
 * The ways in, as doors, each drawn as what's behind it: a clone, with your
 * repositories fanned over it; a folder already on the home, its places
 * stacked; a new one, whose mark is drawn as you reach for it. Where the
 * home found no repositories, there's no folder door.
 */
function Doors({
  name,
  repositories,
  found,
  onDoor,
  t,
}: {
  name: string
  repositories: HomeWelcomeProps['repositories']
  found: HomeWelcomeProps['found']
  onDoor: HomeWelcomeProps['onDoor']
  t: HomeWelcomeText
}) {
  const doors: ReadonlyArray<{ key: HomeDoor; title: string; line: string; art: ReactNode }> = [
    {
      key: 'clone',
      title: t.clone.title,
      line: t.clone.line,
      art:
        repositories.length > 0 ? (
          <span className={s.fan}>
            {repositories.slice(0, 5).map((one, i, all) => (
              <span key={one.id} className={s.fanCard} style={cssVars({ '--i': i - (all.length - 1) / 2 })}>
                <ProjectMark seed={one.id} ink={one.ink} size={42} />
              </span>
            ))}
          </span>
        ) : (
          <span className={s.clone}>
            <Icon name="download" size={22} />
          </span>
        ),
    },
    ...(Array.isArray(found) && found.length === 0
      ? []
      : [
          {
            key: 'folder' as const,
            title: t.folder.title(name),
            line: t.folder.line(found === null || found === 'failed' ? found : found.length, name),
            art: (
              <span className={s.paths}>
                {(Array.isArray(found) ? found : []).slice(0, 3).map((where, i) => (
                  <span key={where} className={s.path} style={cssVars({ '--i': i })}>
                    <Icon name="folder" size={12} />
                    {where}
                  </span>
                ))}
              </span>
            ),
          },
        ]),
    {
      key: 'fresh',
      title: t.fresh.title,
      line: t.fresh.line(name),
      art: (
        <span className={s.blank}>
          <span className={s.blankPlus}>
            <Icon name="plus" size={22} />
          </span>
          <span className={s.blankMark}>
            <ProjectMark seed={`${name}-new`} ink={ProjectInk.Teal} size={48} />
          </span>
        </span>
      ),
    },
  ]
  const ids = useId()
  return (
    <ul className={s.doors} aria-label={t.doors} style={cssVars({ '--doors': doors.length })}>
      {doors.map((door, i) => (
        <li key={door.key} style={cssVars({ '--i': i })}>
          <button
            type="button"
            className={s.door}
            data-door={door.key}
            aria-labelledby={`${ids}-${door.key}`}
            aria-describedby={`${ids}-${door.key}-line`}
            onClick={(event) => onDoor(door.key, event.currentTarget)}
          >
            <span className={s.art} aria-hidden="true">
              {door.art}
            </span>
            <span className={s.doorText}>
              <span id={`${ids}-${door.key}`} className={s.doorTitle}>
                {door.title}
                <Icon name="arrow" size={14} className={s.doorArrow} />
              </span>
              <span id={`${ids}-${door.key}-line`} className={s.doorLine}>
                {door.line}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
