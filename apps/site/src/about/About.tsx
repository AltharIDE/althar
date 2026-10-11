import '@fontsource/mrs-saint-delafield/latin-400.css'
import '@fontsource/mrs-saint-delafield/latin-ext-400.css'

import { type CSSProperties, useRef } from 'react'

import { PRINCIPLES, TEAM, TEAM_LEAD, WHY } from '../content/about'
import { LINKS } from '../content/facts'
import { useSeen } from '../home/bodies/kit/seen'
import { cx } from '../lib/cx'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import s from './About.module.css'
import { Opening } from './Opening'
import { Column, Rise, TONES } from './parts'

/*
 * About: why we built Althar and what we hold to. The first screen opens on
 * a wall of terminals that falls quiet (Opening). Then why we built it, a
 * line at a time; the four things we hold to, each standing in a column of
 * the light; and who we are, each of us signing our name, in the footer's
 * ink, just above it.
 */

function Why() {
  return (
    <Rise as="section" className={s.why} step={160}>
      <h2 className={s.label} data-rise>
        <i aria-hidden="true" />
        Why we built it
      </h2>
      {WHY.before.map((line) => (
        <p key={line} className={s.before} data-rise>
          {line}
        </p>
      ))}
      <p className={s.turn} data-rise>
        {WHY.turn[0]} <b>{WHY.turn[1]}</b>
      </p>
      <p className={s.so} data-rise>
        {WHY.so}
      </p>
    </Rise>
  )
}

/** Where each principle's column stands across the stage, in %, and how tall it rises, as a share of it. */
const STANDS = [
  { left: 10, width: 20.5, h: 0.8 },
  { left: 29.8, width: 20.4, h: 0.97 },
  { left: 49.8, width: 20.4, h: 0.92 },
  { left: 69.5, width: 20.5, h: 0.84 },
] as const

/** The four things we hold to, each in a column of the light, the columns rising one after another once the stage is seen. */
function Held() {
  const box = useRef<HTMLElement>(null)
  const up = useSeen(box, 0.3)
  return (
    <section ref={box} className={cx(s.held, up && s.heldUp)} aria-labelledby="held">
      <h2 id="held" className={cx(s.label, s.heldLabel)}>
        <i aria-hidden="true" />
        What we hold to
      </h2>
      <div className={s.stage}>
        <div className={s.lights} aria-hidden="true">
          <Column tones={TONES.pale} risen={up} style={{ left: '-6%', width: '20%', '--h': 0.5 } as CSSProperties} />
          <Column tones={TONES.sky} risen={up} style={{ left: '2%', width: '14%', '--h': 0.62, '--after': '80ms' } as CSSProperties} />
          <Column tones={TONES.warm} risen={up} style={{ left: '90%', width: '20%', '--h': 0.46, '--after': '980ms' } as CSSProperties} />
          <Column tones={TONES.sky} risen={up} style={{ left: '84%', width: '14%', '--h': 0.6, '--after': '900ms' } as CSSProperties} />
          {STANDS.map((c, i) => (
            <Column
              key={i}
              tones={TONES.heart}
              risen={up}
              style={
                {
                  left: `${c.left}%`,
                  width: `${c.width}%`,
                  '--h': c.h,
                  '--after': `${160 + i * 180}ms`,
                  '--beat': `${6 + i * 1.3}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <ol className={s.principles}>
          {PRINCIPLES.map((p, i) => (
            <li
              key={p.id}
              className={s.principle}
              style={
                { '--left': `${STANDS[i]!.left}%`, '--width': `${STANDS[i]!.width}%`, '--after': `${700 + i * 180}ms` } as CSSProperties
              }
            >
              <span className={s.num} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={s.word}>{p.word}</h3>
              <p className={s.after}>{p.after}</p>
              <p className={s.body}>{p.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** Each of us signs, the ink running out along the line once the names are seen, one after the other. */
function Team() {
  const names = useRef<HTMLUListElement>(null)
  const signed = useSeen(names, 0.6)
  return (
    <Rise as="section" className={s.team} step={140}>
      <h2 className={s.label} data-rise>
        <i aria-hidden="true" />
        Who we are
      </h2>
      <p className={s.teamLead} data-rise>
        {TEAM_LEAD}
      </p>
      <ul ref={names} className={cx(s.people, signed && s.signed)}>
        {TEAM.map((p, i) => (
          <li key={p.name} className={s.person} style={{ '--after': `${200 + i * 1100}ms` } as CSSProperties}>
            <span className={s.hand} aria-hidden="true">
              {p.signs}
            </span>
            <span className={s.name}>{p.name}</span>
            <span className={s.does}>{p.does}</span>
          </li>
        ))}
      </ul>
      <a className={s.talk} href={LINKS.repo} data-rise>
        Talk to us on GitHub
      </a>
    </Rise>
  )
}

export function About() {
  return (
    <div className={s.page}>
      <Nav />
      <main id="main">
        <Opening />
        <Why />
        <Held />
        <Team />
      </main>
      <Footer />
    </div>
  )
}
