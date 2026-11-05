import { CopyButton } from '@althar/ui'
import { Fragment, type ReactNode, useEffect, useRef } from 'react'

import { AGENTS } from '../../../content/agents'
import { INSTALL } from '../../../content/facts'
import { HERO } from '../../../content/home'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { addDisplay } from '../../display'
import { drawStreak } from './dither/streak'
import s from './Dither.module.css'

/*
 * Prototype: the first screen as one sweep of light, the person's dithered
 * gradient turned into a diagonal that splits the frame. The dark upper left
 * holds the words, in white; the lit lower right holds the download, in ink.
 * On a wide screen the headline's last word steps down past the edge and is
 * cut by it: white in the night, ink in the light. On a phone the edge runs
 * steeper under the words, and the light fills the foot.
 *
 * Completely still: the light is drawn once on a canvas (dither/streak.ts),
 * and again only when the box changes size.
 */

addDisplay()

/** The headline's words, and where its lines break: on a wide screen after the second, on a phone after the first and third. */
const WORDS = HERO.title.split(' ')
const WIDE = new Set([1])
const NARROW = new Set([0, 2])

/** Every agent Althar runs, as its mark, named on hover and to a screen reader. */
function Agents() {
  return (
    <ul className={s.agents} aria-label={HERO.agentsName}>
      {AGENTS.map((agent) => (
        <li key={agent.id} title={agent.name}>
          <AgentMark agent={agent.id} size={18} />
          <span className={s.sr}>{agent.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** A number from the hero's CSS (the edge's angle, the cell, the hue's run). */
const read = (style: CSSStyleDeclaration, name: string, fallback: number) => {
  const v = parseFloat(style.getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

/** The first screen as one diagonal sweep of light. */
export function DitherHero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fast = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    const word = fast.current
    if (!el || !cv || !word) return
    let live = true
    let drawn = ''

    /*
     * The edge passes through the pin the CSS places (in the last word on a
     * wide screen, under the lead on a phone), at the angle it gives. The
     * light is drawn along it, and the last word is cut by the same line.
     */
    const paint = () => {
      if (!live) return
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = window.devicePixelRatio || 1
      const box = el.getBoundingClientRect()
      const pin = [...el.querySelectorAll<HTMLElement>('[data-pin]')].find((p) => p.offsetParent !== null)
      if (!w || !h || !pin) return
      const at = pin.getBoundingClientRect()
      const style = getComputedStyle(el)
      const streak = {
        x: at.left - box.left,
        y: at.top - box.top,
        angle: read(style, '--edge-angle', 30),
        hue: [read(style, '--hue-left', 0), read(style, '--hue-right', 1)] as const,
        cell: read(style, '--cell', 4),
      }
      const key = JSON.stringify([w, h, dpr, streak])
      if (key === drawn) return
      drawn = key
      drawStreak(cv, w, h, dpr, streak)

      // The last word, cut by the edge: a hard stop in its own box, on the gradient's line across the word.
      const r = word.getBoundingClientRect()
      const rad = (streak.angle * Math.PI) / 180
      const nx = Math.sin(rad)
      const ny = Math.cos(rad)
      const length = Math.abs(r.width * nx) + Math.abs(r.height * ny)
      const cx = r.left - box.left + r.width / 2
      const cy = r.top - box.top + r.height / 2
      const cut = length / 2 + (streak.x - cx) * nx + (streak.y - cy) * ny
      word.style.setProperty('--turn', `${(180 - streak.angle).toFixed(3)}deg`)
      word.style.setProperty('--cut', `${cut.toFixed(2)}px`)
    }

    // The box, and the last word (which moves if its type comes in late).
    const observer = new ResizeObserver(paint)
    observer.observe(el)
    observer.observe(word)
    window.addEventListener('resize', paint)
    // Once the type is in, the words have their final places.
    void document.fonts.ready.then(paint)
    return () => {
      live = false
      observer.disconnect()
      window.removeEventListener('resize', paint)
    }
  }, [])

  return (
    <div ref={root} className={s.hero}>
      {/* Dark under the nav: it turns to smoked glass over the night. */}
      <LightUnder tone="ink" className={s.under} />
      <canvas ref={canvas} className={s.light} aria-hidden="true" />
      {/* The night: the headline and the lead. */}
      <div className={s.words}>
        <h1 className={s.h1}>
          {WORDS.map((word, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              {word}
              {WIDE.has(i) && <br className={s.wide} />}
              {NARROW.has(i) && <br className={s.narrow} />}
            </Fragment>
          ))}
          <br className={s.narrow} />{' '}
          <span ref={fast} className={s.fast}>
            {HERO.last}
            <i className={cx(s.pin, s.pinWide)} data-pin />
          </span>
        </h1>
        <p className={s.lead}>{HERO.lead}</p>
        <i className={cx(s.pin, s.pinNarrow)} data-pin />
      </div>
      {/* The light: the agents, the install and the download, in ink. */}
      <div className={s.corner}>
        <Agents />
        <div className={s.command}>
          <code>
            <span aria-hidden="true">$ </span>
            {INSTALL.brew}
          </code>
          {/* The kit's button, under the kit's own reset. */}
          <span className="ch-root">
            <CopyButton value={INSTALL.brew} ghost />
          </span>
        </div>
        <div className={s.ways}>
          <Get tone="paper" />
          <OtherMac tone="paper" />
        </div>
      </div>
      {nav}
    </div>
  )
}
