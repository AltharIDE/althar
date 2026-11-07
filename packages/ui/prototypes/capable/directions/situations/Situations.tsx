// Scrappy, surface 7: situations the 6 Nov decisions bring, one state each, where each happens on the real screens. A Never rule an agent meets; an ask that waits while the person is away; a lead-started task that fails; the project with the coordinator off; two tasks changing the same files; Auto moving a lead to a lighter model; and what agents did while the person was away, on the board, with what can't be undone said in place of Undo.
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { ToolKind, ToolState } from '../../../../src/foundations/vocabulary'
import { IconButton } from '../../../../src/primitives/IconButton/IconButton'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { AltharLine } from '../../../../src/thread/AltharLine/AltharLine'
import { Tool } from '../../../../src/thread/Tool/Tool'
import { CHILD } from '../../data'
import { proto } from '../../state'
import s from './situations.module.css'

const RULES = '#/projects/p1?room=settings&section=rules'
const go = (hash: string) => () => window.location.assign(hash)

/** A command the person's own Never rule refused: the call, declined, and Althar's line naming the rule; the lead was told the same and went another way. */
export function NeverMet() {
  return (
    <>
      <Tool kind={ToolKind.Run} verb="Run" target="rm -rf ~/Library/Application\ Support/Althar" state={ToolState.Declined} />
      <AltharLine className={s.line}>
        Refused by your rule <code>rm -rf ~/Library</code>. The lead was told so. <LinkButton onClick={go(RULES)}>Rules</LinkButton>
      </AltharLine>
    </>
  )
}

/** A task its parent's lead started, which stopped without finishing: Althar's line in the parent's thread; the parent's lead heard its report as news. */
export function ChildFailed() {
  return (
    <AltharLine tone="warning" className={s.line}>
      <a href={`#/threads/${CHILD.threadId}`} className={s.link}>
        {CHILD.title}
      </a>{' '}
      stopped without a change: Codex’s sandbox on Windows has no network switch.{' '}
      <LinkButton onClick={go(`#/threads/${CHILD.threadId}`)}>Its report</LinkButton>
    </AltharLine>
  )
}

/** Another open task changes the same files: Althar's line in both threads, the other task linked; both leads were told. */
export function SameFiles() {
  return (
    <AltharLine className={s.line}>
      <a href="#/threads/th-runs" className={s.link}>
        Runs show in the pill over the composer again
      </a>{' '}
      changes <code>TaskView.tsx</code> too. Both leads were told.
    </AltharLine>
  )
}

/** Auto moved the lead to a lighter model, as the person's plan ran low: Althar's line, and the way back. */
export function Lighter() {
  const [kept, setKept] = useState(false)
  if (kept)
    return (
      <AltharLine className={s.line}>
        Back on Opus 5.5 for this task. <LinkButton onClick={() => setKept(false)}>Undo</LinkButton>
      </AltharLine>
    )
  return (
    <AltharLine className={s.line}>
      Moved to Sonnet 5.5: your Claude plan is at 92% for the week, until Thursday.{' '}
      <LinkButton onClick={() => setKept(true)}>Keep Opus 5.5</LinkButton>
    </AltharLine>
  )
}

/** An ask that has waited while the person was away: how long, and where else it reached them. */
export function Waited() {
  return (
    <p className={s.waited}>
      <Icon name="clock" size={12} />
      <span>Waiting 40 min · sent to your iPhone at 13:20</span>
    </p>
  )
}

/** The project's Conversation, with the coordinator off: what the composer does there now, and the way to turn it on. */
export function CoordinatorOff() {
  return (
    <div className={s.off}>
      <p className={s.offHead}>The coordinator is off in althar</p>
      <p className={s.offWhat}>What you write here starts a task.</p>
      <LinkButton onClick={() => proto.set({ coordinatorOff: false })}>Turn it on</LinkButton>
    </div>
  )
}

interface Done {
  readonly id: string
  readonly icon: IconName | Brand
  readonly what: string
  readonly task: string
  readonly when: string
  /** How to take it back, where it can be. */
  readonly undo?: string
  /** Why it can't be taken back now, where it can't. */
  readonly cant?: string
}

const DONE: ReadonlyArray<Done> = [
  { id: 'merge2', icon: 'pr', what: 'Merged #634 into main', task: 'Tabs keep their order', when: '13:10', undo: 'Revert it' },
  {
    id: 'post',
    icon: Brand.GitHub,
    what: 'Posted a review on dana’s #612',
    task: 'Design review of #612',
    when: '12:52',
    cant: 'dana replied',
  },
  { id: 'move', icon: Brand.Linear, what: 'Moved DEV-188 to In Review', task: 'Design review of #612', when: '12:52', undo: 'Undo' },
  { id: 'start', icon: 'create', what: 'Started 2 tasks', task: 'ADR: agents work as yours', when: '12:40' },
  {
    id: 'merge',
    icon: 'pr',
    what: 'Merged #633 into main',
    task: 'Plan usage in the bar',
    when: '12:20',
    cant: 'Released in 0.8.4',
    undo: 'Revert it',
  },
]
const isBrand = (icon: Done['icon']): icon is Brand => (Object.values(Brand) as string[]).includes(icon)

/** What agents did outside their worktrees since the person last looked, on the board, so it's there with the coordinator or without. Where it can't be undone, why. */
export function WhileAway() {
  const [undone, setUndone] = useState<ReadonlyArray<string>>([])
  const [gone, setGone] = useState(false)
  if (gone) return null
  return (
    <section className={s.away} aria-label="While you were away">
      <p className={s.awayHead}>
        <span className={s.awayTitle}>While you were away</span>
        <span className={s.since}>since 11:40</span>
        <IconButton icon="close" label="Done" size="small" tooltipAlign="end" className={s.close} onClick={() => setGone(true)} />
      </p>
      <ul className={s.done}>
        {DONE.map((one) => {
          const isUndone = undone.includes(one.id)
          return (
            <li key={one.id} data-undone={isUndone || undefined}>
              <span className={s.glyph}>
                {isBrand(one.icon) ? <BrandMark brand={one.icon} size={12} /> : <Icon name={one.icon} size={13} />}
              </span>
              <span className={s.doneWhat}>{one.what}</span>
              <span className={s.doneTask}>{one.task}</span>
              <span className={s.when}>{one.when}</span>
              <span className={s.cant}>{one.cant}</span>
              <span className={s.undo}>
                {one.undo !== undefined &&
                  (isUndone ? (
                    <span className={s.undone}>{one.icon === 'pr' ? 'Reverting' : 'Undone'}</span>
                  ) : (
                    <LinkButton onClick={() => setUndone((now) => [...now, one.id])}>{one.undo}</LinkButton>
                  ))}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
