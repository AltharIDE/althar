import { type CSSProperties, Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'

import type { Agent } from '../content/agents'
import { useStill } from '../lib/browser'
import { AgentMark } from '../shared/AgentMark'
import s from './NameSwap.module.css'

/*
 * The hero's name: "You pay for Claude." swaps to Codex, Gemini, OpenCode and
 * on round, one agent at a time. The old name lifts away letter by letter,
 * the slot eases to the new name's width so the full stop glides with it,
 * and the new name rises in out of a blur. It pauses off screen and in a
 * background tab. With reduced motion, or `?t=` held, it stands still as a
 * list of the first three.
 */

interface Name {
  agent: Agent
  word: string
}

/** How long a name stays, in ms, before the next one comes in. */
const HOLD = 2200

/** The punctuation after a name in a list: "Claude, Codex and Gemini." The "and" goes between the spans. */
const listMark = (i: number, count: number) => (i === count - 1 ? '.' : i === count - 2 ? '' : ',')

/** A name as letters, each with its place from the left and from the right for the stagger. */
function Word({ name }: { name: Name }) {
  const letters = Array.from(name.word)
  return (
    <>
      <AgentMark agent={name.agent} className={s.nameMark} />
      {letters.map((c, i) => (
        <span key={i} className={s.letter} style={{ '--i': i, '--r': letters.length - 1 - i } as CSSProperties}>
          {c}
        </span>
      ))}
    </>
  )
}

function Rolling({ names, onTurn, after = 0 }: { names: readonly Name[]; onTurn?: (at: number) => void; after?: number }) {
  const [{ at, prev }, setTurn] = useState<{ at: number; prev: number | null }>({ at: 0, prev: null })
  const box = useRef<HTMLSpanElement>(null)
  const current = useRef<HTMLSpanElement>(null)
  const turned = useEffectEvent((at: number) => onTurn?.(at))

  /* The slot takes the incoming name's width; CSS eases between widths. Watching it also follows the type size across breakpoints. */
  useLayoutEffect(() => {
    const el = current.current
    const slot = box.current
    if (!el || !slot) return
    const fit = () => {
      slot.style.width = `${el.getBoundingClientRect().width}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [at])

  useEffect(() => {
    let timer = 0
    let seen = true
    let turn = 0
    let wait = HOLD + after
    const next = () => {
      wait = HOLD
      turn = (turn + 1) % names.length
      turned(turn)
      setTurn(({ at: a }) => ({ at: (a + 1) % names.length, prev: a }))
      timer = window.setTimeout(next, HOLD)
    }
    const run = () => {
      window.clearTimeout(timer)
      if (seen && !document.hidden) timer = window.setTimeout(next, wait)
    }
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? true
      run()
    })
    if (box.current) io.observe(box.current)
    document.addEventListener('visibilitychange', run)
    run()
    return () => {
      window.clearTimeout(timer)
      io.disconnect()
      document.removeEventListener('visibilitychange', run)
    }
  }, [names.length, after])

  const now = names[at]
  const was = prev === null ? null : names[prev]
  if (!now) return null
  return (
    <span ref={box} className={s.slot} aria-hidden="true">
      {was && (
        <span key={`out-${at}`} className={s.layer} data-leaving>
          <Word name={was} />
        </span>
      )}
      <span ref={current} key={`in-${at}`} className={s.layer} data-entering={was ? true : undefined}>
        <Word name={now} />
      </span>
    </span>
  )
}

/** "Claude." rolling through the names, or "Claude, Codex and Gemini." standing still. Reads as the whole list either way. */
export function NameSwap({
  names,
  nameClass,
  onTurn,
  after,
}: {
  names: readonly Name[]
  nameClass?: string
  /** Called as each name turns, with the incoming name's place. */
  onTurn?: (at: number) => void
  /** How much longer the first name stays, in ms: while the hero opens. */
  after?: number
}) {
  const moving = !useStill()
  const all = names.map((n) => n.word)
  const spoken = `${all.slice(0, -1).join(', ')} and ${all.at(-1)}.`

  if (!moving) {
    const three = names.slice(0, 3)
    return (
      <span>
        {three.map((n, i) => (
          <Fragment key={n.agent}>
            <span className={nameClass}>
              <AgentMark agent={n.agent} className={s.nameMark} />
              {n.word}
              {listMark(i, three.length)}
            </span>
            {i === three.length - 2 ? ' and ' : ' '}
          </Fragment>
        ))}
      </span>
    )
  }
  return (
    <span className={s.line}>
      <span className={s.spoken}>{spoken}</span>
      <Rolling names={names} onTurn={onTurn} after={after} />
      <span aria-hidden="true">.</span>
    </span>
  )
}
