import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { Brand, BrandMark, Icon, ProjectMark, ProjectInk } from '@althar/ui'

import { enter, type Intent } from '../entries'
import { useNeeds } from '../directions/parts'
import { useLab } from '../state'
import { FOUND, HOME, pastedOf, REPOS, world } from '../world'
import { ArrivalWelcome } from './arrival'
import { AskWelcome } from './ask'
import { OrbitWelcome } from './orbit'
import { TourWelcome } from './tour'
import w from './welcome.module.css'

/*
 * A home with no projects opens on a welcome, and the welcome opens the New
 * project page (or the direction's flow), with what was picked on it chosen
 * there already. Four of them, on the bar's 1–4: the arrival (Althar's light
 * rising under the home's name, three doors in), the orbit (your
 * repositories circling the home, each flown into it), the tour (the home
 * explained in four pages), and the ask (one big line that says what it
 * will do as you type). What they share is here.
 */

export function LabWelcome() {
  const { w: which } = useLab()
  if (which === '1') return <ArrivalWelcome />
  if (which === '2') return <OrbitWelcome />
  if (which === '3') return <TourWelcome />
  return <AskWelcome />
}

/**
 * How the welcomes' words and pieces come in: a blur clearing on a straight
 * line, in place, nothing rising. Later the further down and across a piece
 * sits. Only opacity and filter move, so the compositor draws it.
 */
export const BLUR_IN = { length: 560, blur: 10, start: 160, down: 480, across: 100 } as const

const ARRIVING = '[data-arrive], [data-arrive-each] > *'

/** Starts each piece of `within` that's marked to arrive, hidden until it starts. */
export const blurIn = (within: HTMLElement) => {
  const box = within.getBoundingClientRect()
  const pieces = [...within.querySelectorAll<HTMLElement>(ARRIVING)].filter((piece) => typeof piece.animate === 'function')
  // Every place read before anything animates: one layout, not one a piece.
  const places = pieces.map((piece) => piece.getBoundingClientRect())
  pieces.forEach((piece, i) => {
    const r = places[i]!
    if (box.height > 0 && r.top - box.top > box.height) return
    const delay =
      BLUR_IN.start +
      (box.height > 0 ? ((r.top - box.top) / box.height) * BLUR_IN.down + ((r.left - box.left) / box.width) * BLUR_IN.across : 0)
    piece.animate(
      [
        { opacity: 0, filter: `blur(${BLUR_IN.blur}px)` },
        { opacity: 1, filter: 'blur(0px)' },
      ],
      {
        duration: BLUR_IN.length,
        delay,
        easing: 'linear',
        fill: 'backwards',
      },
    )
  })
}

/** Starts what's marked to arrive, once the welcome is drawn; with motion reduced it's simply there. */
export const useArrive = <T extends HTMLElement>() => {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    if (ref.current !== null && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) blurIn(ref.current)
  }, [])
  return ref
}

/** A repository's address pasted anywhere on the welcome goes in with it picked. */
export const usePasteAnywhere = (paste: (text: string) => void = (text) => goPasted(text)) => {
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (pastedOf(text) === null) return
      event.preventDefault()
      paste(text)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [paste])
}

export const goPasted = (text: string, door?: HTMLElement | null) => {
  const repo = pastedOf(text)
  if (repo === null) return
  enter({ way: 'clone', repo: repo.id, query: text.trim() }, door)
}

export const inkVar = (ink: ProjectInk) => `var(--project-${ink})`

const repoLine = (() => {
  const names = REPOS.slice(0, 2).map((one) => one.name)
  return `${names.join(', ')} and ${REPOS.length - 2} more`
})()

export type Door = 'clone' | 'folder' | 'new'

/**
 * The three ways in, as doors: a clone, with your repositories fanned over
 * it; a folder already on the home, its paths stacked; and a new one, whose
 * mark is drawn as you reach for it. Each opens the page on its way.
 */
export function Doors({ compact = false, label }: { compact?: boolean; label: string }) {
  const doors: ReadonlyArray<{ key: Door; title: string; line: string; art: ReactNode; intent: Intent }> = [
    {
      key: 'clone',
      title: 'Clone a repository',
      line: repoLine,
      intent: { way: 'clone' },
      art: (
        <span className={w.fan}>
          {REPOS.slice(0, 5).map((one, i) => (
            <span key={one.id} className={w.fanCard} style={{ ['--i' as string]: i - 2 }}>
              <ProjectMark seed={one.id} ink={one.ink} size={compact ? 34 : 42} />
            </span>
          ))}
          <span className={w.fanHost}>
            <BrandMark brand={Brand.GitHub} size={compact ? 14 : 16} />
          </span>
        </span>
      ),
    },
    {
      key: 'folder',
      title: `A folder ${HOME.remote ? `on ${HOME.name}` : 'here'}`,
      line:
        FOUND.length > 0 ? `${FOUND.length} found, in ${HOME.place} and around` : `Any path ${HOME.remote ? `on ${HOME.name}` : 'here'}`,
      intent: { way: 'folder' },
      art: (
        <span className={w.paths}>
          {FOUND.slice(0, 3).map((one, i) => (
            <span key={one.id} className={w.path} style={{ ['--i' as string]: i }}>
              <Icon name="folder" size={12} />
              {one.where}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'new',
      title: 'Start empty',
      line: `A new repository, made ${HOME.remote ? `on ${HOME.name}` : 'here'}`,
      intent: { way: 'new' },
      art: (
        <span className={w.blank}>
          <span className={w.blankPlus}>
            <Icon name="plus" size={compact ? 18 : 22} />
          </span>
          <span className={w.blankMark}>
            <ProjectMark seed="a-new-one" ink={ProjectInk.Teal} size={compact ? 40 : 48} />
          </span>
        </span>
      ),
    },
  ]
  return (
    <div className={w.doors} data-compact={compact || undefined} role="group" aria-label={label} data-arrive-each>
      {doors.map((door) => (
        <button
          key={door.key}
          type="button"
          className={w.door}
          data-door={door.key}
          onClick={(event) => enter(door.intent, event.currentTarget)}
        >
          <span className={w.art} aria-hidden="true">
            {door.art}
          </span>
          <span className={w.doorText}>
            <span className={w.doorTitle}>
              {door.title}
              <Icon name="arrow" size={14} className={w.doorArrow} />
            </span>
            <span className={w.doorLine}>{door.line}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** What the home has and lacks, in a strip of chips: each missing one signs in where it stands. */
export function ReadyStrip({ label }: { label: string }) {
  const needs = useNeeds()
  return (
    <ul className={w.strip} aria-label={label}>
      <li data-state="there">
        <Icon name="check" size={12} className={w.stripTick} />
        Your settings
      </li>
      {needs.map((one) => (
        <li key={one.key} data-state={one.state}>
          {one.brand === null ? <Icon name="plug" size={13} /> : <BrandMark brand={one.brand} size={13} />}
          {one.name}
          {one.state === 'there' ? (
            <Icon name="check" size={12} className={w.stripTick} />
          ) : one.state === 'doing' ? (
            <span className={w.stripDoing}>Approve in your browser…</span>
          ) : (
            <button type="button" className={w.stripFix} onClick={() => void world.fix(one.key)}>
              {one.fix}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
