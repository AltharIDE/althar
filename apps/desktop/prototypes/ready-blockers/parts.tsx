import { Fact, Icon, LiveDot } from '@althar/ui'
import type { ReactNode } from 'react'

import b from '../../../../packages/ui/src/board/Board/Board.module.css'
import s from './parts.module.css'
import { type Standing, stopping } from './standing'
import { clearOf, type Said, said } from './words'

/* The new bits each direction puts on a ready card, made of the kit's Fact, Icon and LiveDot, and the board's own `go`. */

const join = (...names: ReadonlyArray<string | false | undefined>) => names.filter(Boolean).join(' ')

/** One thing, with its glyph and tone: the kit's Fact, or a cobalt dot for someone else's move under way. */
export function Tell({ said: one, words }: { said: Said; words: string }) {
  if (one.tone === 'live')
    return (
      <span className={s.live}>
        <LiveDot />
        {words}
      </span>
    )
  return (
    <Fact {...(one.icon === null ? {} : { icon: one.icon })} tone={one.tone}>
      {words}
    </Fact>
  )
}

/** Where the card leads, at its foot's end, as the accept card said Review: the whole card is still the one button. */
export function Go({ children, dev91 = false }: { children: ReactNode; dev91?: boolean }) {
  return (
    <span className={join(b.go, dev91 && s.dev91)} aria-hidden="true">
      {children}
      <Icon name="arrow" size={11} />
    </span>
  )
}

/** DEV-91's place, marked for the shots. */
export function Dev91({ children }: { children: ReactNode }) {
  return <span className={s.dev91}>{children}</span>
}

/** A: one line, what stands first in its tone, the rest after it; all clear, the checks that passed. */
export function StatusLine({ standing }: { standing: Standing }) {
  const [first, ...rest] = stopping(standing)
  if (first === undefined) {
    const behind = standing.blockers.find((one) => one.kind === 'behind')
    const clear = clearOf(standing)
    return (
      <span className={s.line}>
        <Tell said={clear} words={clear.phrase} />
        {behind !== undefined && (
          <>
            <span className={s.sep}>·</span>
            <span className={s.rest}>{said(behind).phrase}</span>
          </>
        )}
      </span>
    )
  }
  return (
    <span className={s.line}>
      <Tell said={said(first)} words={said(first).phrase} />
      {/* The rest without a glyph, each still in its tone: a failure after commits to push is still red. */}
      {rest.map((one) => (
        <span key={one.kind} className={s.line}>
          <span className={s.sep}>·</span>
          <span className={join(s.rest, s[said(one).tone])}>{said(one).phrase}</span>
        </span>
      ))}
    </span>
  )
}

/** The words of a status line, for the home's brief. */
export const statusWords = (standing: Standing): string => {
  const all = stopping(standing)
  if (all.length === 0)
    return [clearOf(standing).phrase, ...standing.blockers.filter((one) => one.kind === 'behind').map((one) => said(one).phrase)].join(
      ' · ',
    )
  return all.map((one) => said(one).phrase).join(' · ')
}

function Chip({ said: one, words }: { said: Said; words: string }) {
  return (
    <span className={join(s.chip, s[one.tone])} title={one.sentence}>
      {one.tone === 'live' ? <LiveDot /> : one.icon !== null && <Icon name={one.icon} size={11} />}
      {words}
    </span>
  )
}

/** B: a chip each for checks, main and push, always there, green when clear; draft, review and behind only when they stand. */
export function Chips({ standing }: { standing: Standing }) {
  const find = <K extends Standing['blockers'][number]['kind']>(kind: K) =>
    standing.blockers.find((one): one is Extract<Standing['blockers'][number], { kind: K }> => one.kind === kind)
  const checks = find('failed') ?? find('running')
  const main = find('conflict') ?? find('resolving')
  const push = find('unpushed')
  const passed: Said = { icon: 'check', tone: 'ok', short: 'Checks', phrase: '', sentence: clearOf(standing).phrase }
  const none: Said = { icon: 'check', tone: 'quiet', short: 'No checks', phrase: '', sentence: 'No checks ran' }
  const clean: Said = { icon: 'branch', tone: 'ok', short: 'Main', phrase: '', sentence: 'Merges cleanly into main' }
  const pushed: Said = { icon: 'up', tone: 'ok', short: 'Pushed', phrase: '', sentence: 'Every commit is on the PR' }
  const extras = standing.blockers.filter((one) => one.kind === 'draft' || one.kind === 'changes' || one.kind === 'behind')
  const chip = (one: Said) => <Chip said={one} words={one.short} />
  return (
    <span className={s.chips}>
      {chip(checks === undefined ? (standing.checks === null ? none : passed) : said(checks))}
      {chip(main === undefined ? clean : said(main))}
      {chip(push === undefined ? pushed : said(push))}
      {extras.map((one) => (
        <Chip key={one.kind} said={said(one)} words={said(one).short} />
      ))}
    </span>
  )
}

/** D: what stands between it and merging, a row each; with nothing, "Good to merge". */
export function BlockerList({ standing }: { standing: Standing }) {
  const all = standing.blockers
  if (stopping(standing).length === 0) {
    const clear = clearOf(standing)
    return (
      <ul className={s.list}>
        <li>
          <Tell said={clear} words={clear.sentence} />
        </li>
        {all.map((one) => (
          <li key={one.kind}>
            <Tell said={said(one)} words={said(one).sentence} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className={s.list}>
      {all.map((one) => (
        <li key={one.kind}>
          <Tell said={said(one)} words={said(one).sentence} />
        </li>
      ))}
    </ul>
  )
}

/** C: a group's head in Needs you: its mark, its name, how many. */
export function GroupHead({ group, name, count }: { group: Standing['group']; name: string; count: number }) {
  return (
    <div className={join(s.group, s[group])}>
      {group === 'merge' ? <Icon name="check" size={11} /> : group === 'blocked' ? <span className={s.mark} /> : <LiveDot />}
      <span>{name}</span>
      <span className={s.count}>{count}</span>
      <span className={s.rule} />
    </div>
  )
}

export { s as partStyles }
