import { useRef, useState } from 'react'

import { Button, Field, Icon, Light, ProjectMark } from '@althar/ui'

import { enter, type Intent } from '../entries'
import { FOUND, HOME, pastedOf, REPOS } from '../world'
import o from './orbit.module.css'
import { goPasted, ReadyStrip, useArrive, usePasteAnywhere } from './Welcome'
import w from './welcome.module.css'

/*
 * 2 · Orbit. The home at the middle of its own little system: your
 * repositories on GitHub circling it on the outer ring, the folders already
 * on it on the inner one, and a blank to start empty. Reach for one and the
 * rings hold still while a line draws from it to the home; press it and it
 * flies in, the home takes it, and the home opens into the New project page
 * with it chosen. The words beside say what it is, with a field for an
 * address and New project.
 */

const OUTER = 44
const INNER = 25.5

interface Body {
  readonly id: string
  readonly ring: 'outer' | 'inner'
  readonly angle: number
  readonly intent: Intent
  readonly label: string
  readonly face: 'repo' | 'folder' | 'new'
}

const outer: readonly Body[] = REPOS.map((one, i) => ({
  id: one.id,
  ring: 'outer',
  angle: -90 + (360 / REPOS.length) * i,
  intent: { way: 'clone', repo: one.id },
  label: one.name,
  face: 'repo',
}))
const insideBodies: readonly Body[] = [
  ...FOUND.map((one): Body => ({
    id: one.id,
    ring: 'inner',
    angle: 0,
    intent: { way: 'folder', folder: one.id },
    label: one.name,
    face: 'folder',
  })),
  { id: 'new', ring: 'inner', angle: 0, intent: { way: 'new' }, label: 'Start empty', face: 'new' },
]
const inner = insideBodies.map((one, i): Body => ({ ...one, angle: -45 + (360 / insideBodies.length) * i }))

const at = (ring: Body['ring'], angle: number) => {
  const r = ring === 'outer' ? OUTER : INNER
  const a = (angle * Math.PI) / 180
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) }
}

export function OrbitWelcome() {
  const ref = useArrive<HTMLElement>()
  const station = useRef<HTMLButtonElement>(null)
  const [reach, setReach] = useState<string | null>(null)
  const [flying, setFlying] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  usePasteAnywhere((text) => goPasted(text, station.current))

  /** Flies what was pressed into the home, which takes it, then opens on it. */
  const fly = (body: Body, tile: HTMLElement) => {
    const stage = ref.current
    const home = station.current
    if (stage === null || home === null || flying !== null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return enter(body.intent, home)
    setFlying(body.id)
    const box = stage.getBoundingClientRect()
    const from = tile.getBoundingClientRect()
    const to = home.getBoundingClientRect()
    const ghost = tile.cloneNode(true) as HTMLElement
    ghost.classList.add(o.ghost ?? 'ghost')
    Object.assign(ghost.style, { left: `${from.left - box.left}px`, top: `${from.top - box.top}px`, width: `${from.width}px` })
    stage.append(ghost)
    tile.style.visibility = 'hidden'
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    const flight = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 36}px) scale(1.18)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0 },
      ],
      { duration: 700, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards' },
    )
    void flight.finished.then(() => {
      ghost.remove()
      home.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], {
        duration: 460,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      })
      home.dataset.took = 'true'
      window.setTimeout(() => enter(body.intent, home), 380)
    })
  }

  const face = (body: Body) =>
    body.face === 'repo' ? (
      <ProjectMark seed={body.id} ink={REPOS.find((one) => one.id === body.id)!.ink} size={38} />
    ) : (
      <span className={o.faceTile} data-face={body.face}>
        <Icon name={body.face === 'folder' ? 'folder' : 'plus'} size={17} />
      </span>
    )

  const ring = (bodies: readonly Body[], which: Body['ring']) => (
    <div className={o.ring} data-ring={which}>
      <svg className={o.beams} viewBox="0 0 100 100" aria-hidden="true">
        {bodies.map((body) => {
          const p = at(which, body.angle)
          return (
            <line
              key={body.id}
              x1={p.x}
              y1={p.y}
              x2={50}
              y2={50}
              className={o.beam}
              data-on={reach === body.id || flying === body.id || undefined}
            />
          )
        })}
      </svg>
      {bodies.map((body) => {
        const p = at(which, body.angle)
        return (
          <div key={body.id} className={o.body} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
            <button
              type="button"
              className={o.tile}
              data-face={body.face}
              onPointerEnter={() => setReach(body.id)}
              onPointerLeave={() => setReach((was) => (was === body.id ? null : was))}
              onFocus={() => setReach(body.id)}
              onBlur={() => setReach((was) => (was === body.id ? null : was))}
              onClick={(event) => fly(body, event.currentTarget)}
              aria-label={body.face === 'repo' ? `Clone ${body.label}` : body.face === 'folder' ? `Open ${body.label}` : body.label}
            >
              {face(body)}
              <span className={o.tileName} data-mono={body.face === 'folder' || undefined}>
                {body.label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )

  return (
    <main ref={ref} className={`${w.stage} ${o.stage}`}>
      <div className={w.light} aria-hidden="true">
        <Light height={0.5} />
      </div>
      <div className={o.layout}>
        <section className={o.words}>
          <span className={w.eyebrow} data-arrive>
            <Icon name="home" size={13} />
            {HOME.name} · {HOME.what}
          </span>
          <h1 className={`${w.display} ${o.title}`} data-arrive>
            Bring your code to {HOME.name}
          </h1>
          <p className={o.line} data-arrive>
            Press a repository to clone it there, or a folder that’s already on it.
          </p>
          <ul className={o.legend} data-arrive aria-hidden="true">
            <li>
              <span className={o.swatch} data-ring="outer" />
              Yours on GitHub
            </li>
            <li>
              <span className={o.swatch} data-ring="inner" />
              Already on {HOME.name}
            </li>
          </ul>
          <form
            className={o.address}
            data-arrive
            onSubmit={(event) => {
              event.preventDefault()
              if (pastedOf(address) !== null) goPasted(address, station.current)
              else enter({}, station.current)
            }}
          >
            <Field
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Paste a repository’s address"
              aria-label="A repository’s address"
              spellCheck={false}
            />
            <Button type="submit" variant="signal" icon={pastedOf(address) === null ? 'plus' : 'arrow'}>
              {pastedOf(address) === null ? 'New project' : 'Clone it'}
            </Button>
          </form>
          <div className={o.ready} data-arrive>
            <ReadyStrip label={`Ready on ${HOME.name}`} />
          </div>
        </section>
        <div className={o.system} data-held={reach !== null || flying !== null || undefined} data-arrive>
          <svg className={o.orbits} viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={OUTER} className={o.orbitOuter} />
            <circle cx="50" cy="50" r={INNER} className={o.orbitInner} />
          </svg>
          {ring(outer, 'outer')}
          {ring(inner, 'inner')}
          <button ref={station} type="button" className={o.station} onClick={(event) => enter({}, event.currentTarget)}>
            <span className={o.halo} aria-hidden="true">
              <span />
              <span />
            </span>
            <span className={o.home}>
              <Icon name="home" size={30} />
            </span>
            <span className={o.homeName}>{HOME.name}</span>
            <span className={o.homePlace}>{HOME.place}</span>
          </button>
        </div>
      </div>
    </main>
  )
}
