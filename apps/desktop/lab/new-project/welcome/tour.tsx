import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { Button, HalftoneMark, Icon, Light, LinkButton, StepTrack, TaskStatus, trackOf } from '@althar/ui'

import { HomeReady, useNeeds } from '../directions/parts'
import { HOME, YOURS } from '../world'
import ar from './arrival.module.css'
import t from './tour.module.css'
import { type Pace, morphPairs, piecesIn, settle } from './morph'
import { Doors, ReadyStrip, usePasteAnywhere } from './Welcome'
import w from './welcome.module.css'

/*
 * 3 · Tour. The home explained on the first-run welcome's card, with its
 * track along the head: what the home is (its name arriving, and its cores,
 * memory, room and tools set out as a spec), that your settings are there already
 * (the home's clearing in beside this Mac's), and what it signs in itself
 * (the presses that do it). Then the card opens: it grows to the whole window
 * and melts into it, the light rises behind, and the tour ends as the
 * arrival does, the mark coming up dot by dot over "Welcome to runner-1"
 * and the three doors in. Skip goes straight to that.
 *
 * Each step morphs into the next (`morph.ts`): its title and line move into
 * the next's, runner-1's column of settings reshapes into the sign-ins' list,
 * and the card itself opens into the window, its title into the arrival's.
 */

type Page = 'home' | 'yours' | 'signins' | 'project'
const PAGES: readonly Page[] = ['home', 'yours', 'signins', 'project']
const LAST = PAGES.length - 1
const LABELS: Record<Page, string> = { home: 'The home', yours: 'Yours', signins: 'Sign-ins', project: 'Project' }

/** What the home says about itself when it answers. */
const SPEC = HOME.remote
  ? {
      at: `althar@${HOME.name}`,
      ping: 18,
      cores: 8,
      chip: 'x86_64',
      memory: 32,
      busy: 2.4,
      free: 212,
      total: 512,
      system: 'Ubuntu 24.04',
      kernel: 'Linux 6.8',
      tools: ['git 2.43', 'node 22', 'python 3.12'],
    }
  : {
      at: HOME.name,
      ping: 0,
      cores: 10,
      chip: 'Apple M4',
      memory: 24,
      busy: 9.8,
      free: 418,
      total: 1000,
      system: 'macOS 26',
      kernel: 'Darwin 25',
      tools: ['git 2.47', 'node 22', 'bun 1.3'],
    }

const CARRIED: ReadonlyArray<readonly [string, string]> = [
  ['Presets', `${YOURS.presets}, Prototype and Change among them`],
  ['Skills', `${YOURS.skills}`],
  ['MCP servers', `${YOURS.servers}, postgres and linear among them`],
  ['Models', 'Opus 5.5 leads, GPT-6.1 Sol reviews'],
  ['Pull requests', 'Drafts first, merged on your word'],
]

const TEXT: Record<Exclude<Page, 'home' | 'project'>, { title: string; line: string }> = {
  yours: {
    title: 'Your settings are here already',
    line: 'The same on every home, kept in step: change one anywhere and it changes everywhere.',
  },
  signins: {
    title: `What ${HOME.name} signs in itself`,
    line: 'Each is approved in your browser on this Mac and never copied from it. Skip any: work that needs one asks.',
  },
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const OPEN = 'cubic-bezier(0.55, 0, 0.15, 1)'
/** A step on the card, and the card opening into the window or closing again. */
const STEP: Pace = { length: 560, easing: 'cubic-bezier(0.4, 0, 0.1, 1)', out: 200, inAt: 140, inFor: 320 }
const OPENING: Pace = { length: 960, easing: OPEN, out: 300, inAt: 320, inFor: 520 }

export function TourWelcome() {
  const [at, setAt] = useState(0)
  const page = PAGES[at]!
  const open = at === LAST
  const stage = useRef<HTMLElement>(null)
  const card = useRef<HTMLElement>(null)
  const head = useRef<HTMLElement>(null)
  const paper = useRef<HTMLSpanElement>(null)
  /** Lands the morph under way at once, where another starts before it's done. */
  const landing = useRef<(() => void) | null>(null)

  /**
   * Turns to page `next`, morphing: what the pages share moves into its
   * place on the next, the rest of the old fades out and the rest of the new
   * fades in. Opening, the card's paper also grows to past the window's
   * edges and melts into it, and its head glides to the window's top;
   * closing, the paper comes back from there into the card.
   */
  const turn = (next: number) => {
    landing.current?.()
    const holder = stage.current
    const root = card.current
    const sheet = paper.current
    const bar = head.current
    if (holder === null || root === null || sheet === null || bar === null || typeof root.animate !== 'function' || reduced())
      return setAt(next)
    const opening = next === LAST
    const closing = at === LAST
    const pace = opening || closing ? OPENING : STEP
    // The page as it is: everything read before anything changes.
    const s = holder.getBoundingClientRect()
    const c = root.getBoundingClientRect()
    const p0 = sheet.getBoundingClientRect()
    const h0 = bar.getBoundingClientRect()
    const before = new Map(piecesIn(root).map((one) => [one.key, one]))
    const ghost = root.cloneNode(true) as HTMLElement
    for (const one of [sheet, bar]) for (const move of one.getAnimations()) move.cancel()
    if (closing) sheet.style.borderRadius = ''

    flushSync(() => setAt(next))

    // The page it's become: read once.
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
    ghost.classList.add(t.ghost ?? 'ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    Object.assign(ghost.style, { left: `${c.left - s.left}px`, top: `${c.top - s.top}px`, width: `${c.width}px`, height: `${c.height}px` })
    // On the card the foot stays; opening, it goes with the rest.
    if (!opening) ghost.querySelector<HTMLElement>(':scope > footer')?.style.setProperty('visibility', 'hidden')
    for (const { a } of pairs) ghost.querySelector<HTMLElement>(`[data-morph="${a.key}"]`)?.style.setProperty('visibility', 'hidden')
    holder.append(ghost)
    const { laid, hidden, moves } = morphPairs(pairs, holder, s, t.ghost ?? 'ghost', pace)
    laid.push(ghost)

    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: pace.out, easing: 'linear', fill: 'forwards' })
    const arriving = closing ? [fresh, root.querySelector<HTMLElement>(':scope > footer')] : [fresh]
    for (const one of arriving)
      one?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: pace.inFor, delay: pace.inAt, easing: 'linear', fill: 'backwards' })

    if (opening || closing) {
      const sx = p0.width / p1.width
      const sy = p0.height / p1.height
      // Opening, the card's corners as they were at the scale it starts from.
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
      if (landing.current === land) landing.current = null
    }
    landing.current = land
    void Promise.allSettled([...moves.map((one) => one.finished), new Promise((done) => setTimeout(done, pace.out))]).then(land)
  }

  const go = (to: number) => {
    const next = Math.max(0, Math.min(LAST, to))
    if (next !== at) turn(next)
  }
  // The arrows go a page at a time, from where it is.
  const step = useRef((by: number) => go(at + by))
  useLayoutEffect(() => {
    step.current = (by: number) => go(at + by)
  })
  useEffect(() => {
    const onArrow = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea')) return
      if (event.key === 'ArrowRight') step.current(1)
      if (event.key === 'ArrowLeft') step.current(-1)
    }
    window.addEventListener('keydown', onArrow)
    return () => window.removeEventListener('keydown', onArrow)
  }, [])

  return (
    <main ref={stage} className={`${w.stage} ${t.stage}`} data-morph-root>
      <div className={w.light} aria-hidden="true">
        <div className={t.lift} data-open={open || undefined}>
          <Light height={0.55} />
        </div>
      </div>
      <section ref={card} className={t.card} data-open={open || undefined} aria-labelledby="tour-title">
        <span ref={paper} className={t.paper} aria-hidden="true" />
        <header ref={head} className={t.head}>
          <span className={t.brand}>
            <Icon name="home" size={16} />
            {HOME.name}
          </span>
          <StepTrack
            steps={trackOf(
              PAGES.map((one) => LABELS[one]),
              at,
            )}
            status={TaskStatus.Running}
            labels
            className={t.track}
            text={{ label: 'Pages' }}
          />
          {open ? (
            <LinkButton className={t.skip} onClick={() => go(at - 1)}>
              Back
            </LinkButton>
          ) : (
            <LinkButton className={t.skip} onClick={() => go(LAST)}>
              Skip
            </LinkButton>
          )}
        </header>
        {open ? (
          <Finale />
        ) : (
          <>
            <div key={page} className={t.body} data-morph-root>
              {page === 'home' || page === 'project' ? (
                <Answering />
              ) : (
                <>
                  <div className={t.words}>
                    <h1 id="tour-title" className={`${w.display} ${t.title}`} data-morph="title">
                      {TEXT[page].title}
                    </h1>
                    <p className={t.line} data-morph="line">
                      {TEXT[page].line}
                    </p>
                  </div>
                  <div className={t.scene}>
                    {page === 'yours' && <Carried />}
                    {page === 'signins' && <HomeReady label={`Ready on ${HOME.name}`} />}
                  </div>
                </>
              )}
            </div>
            <footer className={t.foot}>
              {at > 0 && <LinkButton onClick={() => go(at - 1)}>Back</LinkButton>}
              <span className={t.grow} />
              <Button variant="signal" onClick={() => go(at + 1)} autoFocus>
                {page === 'signins' ? 'Continue' : 'Next'}
              </Button>
            </footer>
          </>
        )}
      </section>
    </main>
  )
}

/* ---- 1 · the home ---- */

/**
 * The home's first page: its name arriving a letter at a time, as the
 * arrival's does, and what it is set out as a spec, each figure landing in
 * turn and then standing still.
 */
function Answering() {
  const figures: ReadonlyArray<{ what: string; value: string; unit: string }> = [
    { what: 'Cores', value: String(SPEC.cores), unit: SPEC.chip },
    { what: 'Memory', value: String(SPEC.memory), unit: 'GB' },
    {
      what: `Free in ${HOME.place}`,
      value: String(SPEC.free),
      unit: `GB of ${SPEC.total >= 1000 ? `${SPEC.total / 1000} TB` : SPEC.total}`,
    },
  ]
  return (
    <div className={t.answering}>
      <div className={t.words}>
        <span className={w.eyebrow} data-morph="eyebrow">
          <span className={t.dot} aria-hidden="true" />
          {HOME.remote ? `${SPEC.at} · ${SPEC.ping} ms away` : SPEC.at}
        </span>
        <h1 id="tour-title" className={`${w.display} ${t.title} ${t.hello}`} aria-label={`This is ${HOME.name}`} data-morph="title">
          <span aria-hidden="true">This is </span>
          <span className={ar.name} aria-hidden="true">
            {[...HOME.name].map((letter, i) => (
              <span key={i} style={{ ['--i' as string]: i }}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className={t.line} data-morph="line">
          Tasks you start in this window run on it, and keep going with this Mac closed.
        </p>
      </div>
      <div className={t.spec}>
        <dl className={t.figures}>
          {figures.map((one, i) => (
            <div key={one.what} className={t.figure} style={{ ['--i' as string]: i }}>
              <dt>{one.what}</dt>
              <dd>
                <b>{one.value}</b>
                <small>{one.unit}</small>
              </dd>
            </div>
          ))}
        </dl>
        <p className={t.tools}>
          <span>{SPEC.system}</span>
          {SPEC.tools.map((one) => (
            <span key={one}>{one}</span>
          ))}
          <span data-agent>
            <Icon name="check" size={11} />
            Claude Code 2.1
          </span>
        </p>
      </div>
    </div>
  )
}

/* ---- 2 · yours ---- */

/** Your settings, on this Mac and on the home: the home's clear in a row at a time, where they stand, each ticked. */
function Carried() {
  return (
    <div className={t.carried}>
      <section className={t.side}>
        <h2 className={t.sideName}>
          <Icon name="computer" size={14} />
          This Mac
        </h2>
        <ul className={t.chips}>
          {CARRIED.map(([what, value]) => (
            <li key={what}>
              <b>{what}</b>
              <span>{value}</span>
            </li>
          ))}
        </ul>
      </section>
      <span className={t.across} aria-hidden="true">
        <Icon name="arrow" size={16} />
      </span>
      <section className={t.side} data-home data-morph="ready" data-morph-as="box">
        <h2 className={t.sideName}>
          <Icon name="home" size={14} />
          {HOME.name}
        </h2>
        <ul className={t.chips}>
          {CARRIED.map(([what, value], i) => (
            <li key={what} data-to style={{ ['--i' as string]: i }}>
              <b>{what}</b>
              <span>{value}</span>
              <Icon name="check" size={12} className={t.chipTick} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ---- 4 · the card opened: the arrival ---- */

/**
 * The tour's end, as the arrival is: the mark coming up dot by dot, the
 * home's name, and the doors in, with what the tour set up along the foot,
 * where the sign-ins land. A repository's address pasted anywhere goes in.
 */
function Finale() {
  usePasteAnywhere()
  const needs = useNeeds()
  const signed = needs.filter((one) => one.state === 'there' && one.brand !== null).map((one) => one.name)
  return (
    <div className={t.finale} data-morph-root>
      <div className={ar.head}>
        <HalftoneMark size={64} className={ar.mark} />
        <span className={w.eyebrow} data-morph="eyebrow" data-morph-at="center">
          {HOME.remote ? `althar@${HOME.name} · ${HOME.what}` : HOME.what}
        </span>
        <h1
          id="tour-title"
          className={`${w.display} ${ar.title} ${t.finaleTitle}`}
          aria-label={`Welcome to ${HOME.name}`}
          data-morph="title"
          data-morph-at="center"
        >
          <span className={ar.welcome}>Welcome to</span>{' '}
          <span className={ar.name} aria-hidden="true">
            {[...HOME.name].map((letter, i) => (
              <span key={i} style={{ ['--i' as string]: i }}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className={ar.line} data-morph="line" data-morph-at="center">
          {signed.length > 0
            ? `Your settings are on it and ${signed.join(' and ')} signed in. Bring it its first project.`
            : 'Your settings are on it. Bring it its first project.'}
        </p>
      </div>
      <Doors label="Ways in" />
      <div className={ar.foot}>
        <ReadyStrip label={`Ready on ${HOME.name}`} />
      </div>
    </div>
  )
}
