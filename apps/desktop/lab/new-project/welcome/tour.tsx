import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { Button, HalftoneMark, Icon, Light, LinkButton, StepTrack, TaskStatus, trackOf } from '@althar/ui'

import { HomeReady, useNeeds } from '../directions/parts'
import { HOME, YOURS } from '../world'
import ar from './arrival.module.css'
import t from './tour.module.css'
import { Doors, ReadyStrip, useArrive, usePasteAnywhere } from './Welcome'
import w from './welcome.module.css'

/*
 * 3 · Tour. The home explained on the first-run welcome's card, with its
 * track along the head: what the home is (its name arriving, and its cores,
 * memory, room and tools set out as a spec), that your settings are there already
 * (each flying across from this Mac), and what it signs in itself (the
 * presses that do it). Then the card opens: it grows to the whole window and
 * melts into it, the light surges up behind, and the tour ends as the
 * arrival does, the mark coming up dot by dot over "Welcome to runner-1"
 * and the three doors in. Skip goes straight to that.
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

export function TourWelcome() {
  const [at, setAt] = useState(0)
  const page = PAGES[at]!
  const open = at === LAST
  const stage = useRef<HTMLElement>(null)
  const card = useRef<HTMLElement>(null)
  const head = useRef<HTMLElement>(null)

  /**
   * Opens the card into the window: what was on it lifts off and blurs away,
   * the card grows to the window's edges and its paper melts into it, and its
   * head glides up to the window's top, while the finale arrives in it.
   */
  const morph = () => {
    const root = card.current
    const holder = stage.current
    const bar = head.current
    if (root === null || holder === null || bar === null || typeof root.animate !== 'function' || reduced()) return setAt(LAST)
    const s = holder.getBoundingClientRect()
    const c = root.getBoundingClientRect()
    const h = bar.getBoundingClientRect()
    const paper = getComputedStyle(root).backgroundColor
    const ghost = root.cloneNode(true) as HTMLElement
    ghost.querySelectorAll('[id]').forEach((one) => one.removeAttribute('id'))
    ghost.classList.add(t.ghost ?? 'ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    Object.assign(ghost.style, {
      left: `${c.left - s.left}px`,
      top: `${c.top - s.top}px`,
      width: `${c.width}px`,
      height: `${c.height}px`,
    })
    holder.append(ghost)
    flushSync(() => setAt(LAST))
    root.animate(
      [
        { clipPath: `inset(${c.top - s.top}px ${s.right - c.right}px ${s.bottom - c.bottom}px ${c.left - s.left}px round 20px)` },
        { clipPath: 'inset(0px round 0px)' },
      ],
      { duration: 960, easing: OPEN },
    )
    root.animate([{ backgroundColor: paper }, { backgroundColor: paper, offset: 0.4 }, { backgroundColor: 'transparent' }], {
      duration: 1400,
      easing: 'ease-out',
    })
    const g = bar.getBoundingClientRect()
    bar.animate([{ transform: `translate(${h.left - g.left}px, ${h.top - g.top}px)` }, { transform: 'none' }], {
      duration: 960,
      easing: OPEN,
    })
    const away = ghost.animate(
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'none' },
        { opacity: 0, filter: 'blur(6px)', transform: 'translateY(-10px) scale(1.02)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    )
    void away.finished.finally(() => ghost.remove())
  }

  const go = (to: number) => {
    const next = Math.max(0, Math.min(LAST, to))
    if (next === at) return
    if (next === LAST) return morph()
    setAt(next)
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
    <main ref={stage} className={`${w.stage} ${t.stage}`}>
      <div className={w.light} aria-hidden="true">
        <div className={t.lift} data-open={open || undefined}>
          <Light height={0.55} />
        </div>
      </div>
      <section ref={card} className={t.card} data-open={open || undefined} aria-labelledby="tour-title">
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
            <div key={page} className={t.body}>
              {page === 'home' || page === 'project' ? (
                <Answering />
              ) : (
                <>
                  <div className={t.words}>
                    <h1 id="tour-title" className={`${w.display} ${t.title}`}>
                      {TEXT[page].title}
                    </h1>
                    <p className={t.line}>{TEXT[page].line}</p>
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
        <span className={w.eyebrow}>
          <span className={t.dot} aria-hidden="true" />
          {HOME.remote ? `${SPEC.at} · ${SPEC.ping} ms away` : SPEC.at}
        </span>
        <h1 id="tour-title" className={`${w.display} ${t.title} ${t.hello}`} aria-label={`This is ${HOME.name}`}>
          <span aria-hidden="true">This is </span>
          <span className={ar.name} aria-hidden="true">
            {[...HOME.name].map((letter, i) => (
              <span key={i} style={{ ['--i' as string]: i }}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className={t.line}>Tasks you start in this window run on it, and keep going with this Mac closed.</p>
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

/** Your settings, on this Mac and on the home: each flies across, and is ticked where it lands. */
function Carried() {
  const scene = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = scene.current
    if (root === null || typeof root.animate !== 'function' || reduced()) return
    const from = [...root.querySelectorAll<HTMLElement>('[data-from]')]
    const to = [...root.querySelectorAll<HTMLElement>('[data-to]')]
    to.forEach((chip, i) => {
      const a = from[i]!.getBoundingClientRect()
      const b = chip.getBoundingClientRect()
      const dx = a.left - b.left
      const dy = a.top - b.top
      chip.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.0 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: 0.05 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 34}px) scale(1.06)`, opacity: 1, offset: 0.5 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 760, delay: 380 + i * 300, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' },
      )
    })
  }, [])
  return (
    <div ref={scene} className={t.carried}>
      <section className={t.side}>
        <h2 className={t.sideName}>
          <Icon name="computer" size={14} />
          This Mac
        </h2>
        <ul className={t.chips}>
          {CARRIED.map(([what, value]) => (
            <li key={what} data-from>
              <b>{what}</b>
              <span>{value}</span>
            </li>
          ))}
        </ul>
      </section>
      <span className={t.across} aria-hidden="true">
        <Icon name="arrow" size={16} />
      </span>
      <section className={t.side} data-home>
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
 * home's name a letter at a time, and the doors in, with what the tour set
 * up along the foot. A repository's address pasted anywhere goes in.
 */
function Finale() {
  const ref = useArrive<HTMLDivElement>()
  usePasteAnywhere()
  const needs = useNeeds()
  const signed = needs.filter((one) => one.state === 'there' && one.brand !== null).map((one) => one.name)
  return (
    <div ref={ref} className={t.finale}>
      <div className={ar.head}>
        <HalftoneMark size={64} className={ar.mark} />
        <span className={w.eyebrow} data-arrive>
          {HOME.remote ? `althar@${HOME.name} · ${HOME.what}` : HOME.what}
        </span>
        <h1 id="tour-title" className={`${w.display} ${ar.title} ${t.finaleTitle}`} aria-label={`Welcome to ${HOME.name}`}>
          <span className={ar.welcome}>Welcome to</span>{' '}
          <span className={ar.name} aria-hidden="true">
            {[...HOME.name].map((letter, i) => (
              <span key={i} style={{ ['--i' as string]: i }}>
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className={ar.line} data-arrive>
          {signed.length > 0
            ? `Your settings are on it and ${signed.join(' and ')} signed in. Bring it its first project.`
            : 'Your settings are on it. Bring it its first project.'}
        </p>
      </div>
      <Doors label="Ways in" />
      <div className={ar.foot} data-arrive>
        <ReadyStrip label={`Ready on ${HOME.name}`} />
      </div>
    </div>
  )
}
