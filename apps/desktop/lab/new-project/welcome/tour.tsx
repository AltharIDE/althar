import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button, Icon, Light, LinkButton, StepTrack, TaskStatus, trackOf } from '@althar/ui'

import { HomeReady } from '../directions/parts'
import { enter } from '../entries'
import { HOME, YOURS } from '../world'
import t from './tour.module.css'
import { Doors } from './Welcome'
import w from './welcome.module.css'

/*
 * 3 · Tour. The home explained in four pages, on the first-run welcome's
 * card, with its track along the head: what the home is (its facts read in,
 * a row at a time), that your settings are there already (each flying across
 * from this Mac), what it signs in itself (the presses that do it), and its
 * first project (the doors in). Skip goes to the last page; its main button
 * opens the New project page out of the card.
 */

type Page = 'home' | 'yours' | 'signins' | 'project'
const PAGES: readonly Page[] = ['home', 'yours', 'signins', 'project']
const LABELS: Record<Page, string> = { home: 'The home', yours: 'Yours', signins: 'Sign-ins', project: 'Project' }

const READOUT: ReadonlyArray<readonly [string, string]> = HOME.remote
  ? [
      ['Reached', `althar@${HOME.name}, 18 ms away`],
      ['System', 'Ubuntu 24.04 · x86_64'],
      ['Power', '8 cores · 32 GB memory'],
      ['Room', `212 GB free in ${HOME.place}`],
      ['Tools', 'git 2.43 · node 22 · python 3.12'],
      ['Agents', 'Claude Code 2.1, signed in'],
    ]
  : [
      ['System', 'macOS 26 · Apple M4'],
      ['Room', `418 GB free in ${HOME.place}`],
      ['Tools', 'git 2.47 · node 22 · bun 1.3'],
      ['Agents', 'Claude Code 2.1, Codex 0.60'],
    ]

const CARRIED: ReadonlyArray<readonly [string, string]> = [
  ['Presets', `${YOURS.presets}, Prototype and Change among them`],
  ['Skills', `${YOURS.skills}`],
  ['MCP servers', `${YOURS.servers}, postgres and linear among them`],
  ['Models', 'Opus 5.5 leads, GPT-6.1 Sol reviews'],
  ['Pull requests', 'Drafts first, merged on your word'],
]

const TEXT: Record<Page, { title: string; line: string }> = {
  home: {
    title: `This is ${HOME.name}`,
    line: 'Tasks you start in this window run on it, and keep going with this Mac closed.',
  },
  yours: {
    title: 'Your settings are here already',
    line: 'The same on every home, kept in step: change one anywhere and it changes everywhere.',
  },
  signins: {
    title: `What ${HOME.name} signs in itself`,
    line: 'Each is approved in your browser on this Mac and never copied from it. Skip any: work that needs one asks.',
  },
  project: {
    title: 'Its first project',
    line: 'Clone a repository onto it, open a folder that’s there, or start one empty.',
  },
}

export function TourWelcome() {
  const [at, setAt] = useState(0)
  const page = PAGES[at]!
  const card = useRef<HTMLElement>(null)
  const last = at === PAGES.length - 1
  const next = () => (last ? enter({}, card.current) : setAt(at + 1))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea')) return
      if (event.key === 'ArrowRight') setAt((was) => Math.min(was + 1, PAGES.length - 1))
      if (event.key === 'ArrowLeft') setAt((was) => Math.max(was - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <main className={`${w.stage} ${t.stage}`}>
      <div className={w.light} aria-hidden="true">
        <Light height={0.55} />
      </div>
      <section ref={card} className={t.card} aria-labelledby="tour-title">
        <header className={t.head}>
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
          {last ? (
            <span className={t.skip} aria-hidden="true" />
          ) : (
            <LinkButton className={t.skip} onClick={() => setAt(PAGES.length - 1)}>
              Skip
            </LinkButton>
          )}
        </header>
        <div key={page} className={t.body}>
          <div className={t.words}>
            <h1 id="tour-title" className={`${w.display} ${t.title}`}>
              {TEXT[page].title}
            </h1>
            <p className={t.line}>{TEXT[page].line}</p>
          </div>
          <div className={t.scene}>
            {page === 'home' && <Readout />}
            {page === 'yours' && <Carried />}
            {page === 'signins' && <HomeReady label={`Ready on ${HOME.name}`} />}
            {page === 'project' && <Doors compact label="Ways in" />}
          </div>
        </div>
        <footer className={t.foot}>
          {at > 0 && <LinkButton onClick={() => setAt(at - 1)}>Back</LinkButton>}
          <span className={t.grow} />
          <Button variant="signal" {...(last ? { icon: 'plus' as const } : {})} onClick={next} autoFocus>
            {last ? 'New project' : page === 'signins' ? 'Continue' : 'Next'}
          </Button>
        </footer>
      </section>
    </main>
  )
}

/** The home's facts, read in a row at a time, each ticked as it lands. */
function Readout() {
  return (
    <div className={t.homeScene}>
      <div className={t.machine} aria-hidden="true">
        <span className={t.ripples}>
          <span />
          <span />
          <span />
        </span>
        <span className={t.machineTile}>
          <Icon name="home" size={40} />
        </span>
        <span className={t.machineName}>{HOME.name}</span>
      </div>
      <dl className={t.readout}>
        {READOUT.map(([what, value], i) => (
          <div key={what} className={t.fact} style={{ ['--i' as string]: i }}>
            <dt>{what}</dt>
            <dd>{value}</dd>
            <Icon name="check" size={13} className={t.factTick} />
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Your settings, on this Mac and on the home: each flies across, and is ticked where it lands. */
function Carried() {
  const scene = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = scene.current
    if (root === null || typeof root.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
