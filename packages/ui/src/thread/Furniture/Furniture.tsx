import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Furniture.module.css'
import { Rhythm } from '../../lib/rhythm'

/** A line across the thread that marks a change of scene: the lead changed, the task resumed. */
export function Divider({
  icon,
  children,
  action,
  onAction,
}: {
  icon: IconName
  children: ReactNode
  action?: string
  onAction?: () => void
}) {
  return (
    /* not role=separator: a separator's content is hidden from assistive technology, and this one says something */
    <div className={s.divider}>
      <Icon name={icon} size={11} />
      <span>{children}</span>
      <span className={s.rule} aria-hidden="true" />
      {action && (
        <LinkButton className={s.action} onClick={onAction}>
          {action}
        </LinkButton>
      )}
    </div>
  )
}

export interface InterruptedText {
  interrupted: string
}

export const interruptedText: InterruptedText = { interrupted: 'Interrupted by you' }

/** You interrupted the agent's turn here, with the composer's square. The task kept going. */
export function Interrupted({ text }: { text?: Partial<InterruptedText> }) {
  const t = { ...interruptedText, ...text }
  return (
    <div className={s.stopped}>
      <Icon name="square" size={10} />
      {t.interrupted}
    </div>
  )
}

export interface RestartedText {
  checking: string
  carriedOn: string
  nothingTwice: string
}

export const restartedText: RestartedText = {
  checking: 'Charrette restarted. Checking where the lead had got to before carrying on',
  carriedOn: 'Carried on after a restart',
  nothingTwice: 'nothing was run twice',
}

/**
 * Charrette restarted while the task ran. It first checks what had already
 * happened, so nothing is done twice, then carries on. Asking you is only
 * for when that check can't tell.
 */
export function Restarted({ checking = false, text }: { checking?: boolean; text?: Partial<RestartedText> }) {
  const t = { ...restartedText, ...text }
  return (
    <output className={s.divider}>
      {checking ? <Spinner size="small" /> : <Icon name="corner" size={11} />}
      <span>{checking ? t.checking : `${t.carriedOn} · ${t.nothingTwice}`}</span>
      <span className={s.rule} aria-hidden="true" />
    </output>
  )
}

export interface LimitMovedText {
  movedTo: (what: string) => string
  movedWhy: (runtime: string, resets: string, project: string) => string
  waits: (what: string, resets: string) => string
  waitsWhy: (runtime: string) => string
}

export const limitMovedText: LimitMovedText = {
  movedTo: (what) => `${what} moved to`,
  movedWhy: (runtime, resets, project) => `${runtime} hit its usage limit, resets ${resets} · by ${project}’s rule`,
  waits: (what, resets) => `${what} waits until ${resets}`,
  waitsWhy: (runtime) => `${runtime} hit its usage limit and no other agent is free`,
}

export interface LimitMovedProps {
  /** What moved or waits: The lead, Review. */
  what: string
  /** The model it moved to. Without one, it waits. */
  to?: ModelInfo
  runtime: string
  resets: string
  /** Whose rule moved it. */
  project: string
  text?: Partial<LimitMovedText>
}

/** A usage limit the project's rule handled: the work moved, and says so. Or no one was free, and it waits. */
export function LimitMoved({ what, to, runtime, resets, project, text }: LimitMovedProps) {
  const t = { ...limitMovedText, ...text }
  return (
    <div className={s.gc} data-rhythm={Rhythm.Change}>
      <Icon name="clock" size={11} />
      {to ? (
        <>
          <span className={s.gcTitle}>{t.movedTo(what)}</span>
          <Model model={to} short strong />
          <span className={s.gcNote}>· {t.movedWhy(runtime, resets, project)}</span>
        </>
      ) : (
        <>
          <span className={s.gcTitle}>{t.waits(what, resets)}</span>
          <span className={s.gcNote}>· {t.waitsWhy(runtime)}</span>
        </>
      )}
      <span className={s.rule} aria-hidden="true" />
    </div>
  )
}

/** An empty conversation: what it is for, before anything is said. */
export function Empty({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      {kicker && <span className={s.kicker}>{kicker}</span>}
      <h2 className={s.emptyTitle}>{title}</h2>
      {children && <p className={s.emptyText}>{children}</p>}
    </div>
  )
}

export interface ModelLineText {
  changedTo: string
  lead: string
  recommended: string
}

export const modelLineText: ModelLineText = {
  changedTo: 'Lead changed to',
  lead: 'Lead',
  recommended: 'recommended by the coordinator',
}

/** The lead changed mid-thread: who took over, and what it picks up from. */
export function ModelSwap({
  to,
  note,
  text,
}: {
  to: ModelInfo
  /** What it picks up from. */ note?: string
  text?: Partial<ModelLineText>
}) {
  const t = { ...modelLineText, ...text }
  return (
    <div className={s.swap}>
      <span>{t.changedTo}</span>
      <Model model={to} className={s.swapModel} />
      {note && <span className={s.swapNote}>· {note}</span>}
    </div>
  )
}

/** Once a task has started, who leads it is one line at the top of the thread. */
export function LeadLine({
  model,
  why,
  text,
}: {
  model: ModelInfo
  /** Why the coordinator recommended it. */ why: string
  text?: Partial<ModelLineText>
}) {
  const t = { ...modelLineText, ...text }
  return (
    <div className={s.swap}>
      <span>{t.lead}</span>
      <Model model={model} className={s.swapModel} />
      <span className={s.swapNote} title={why}>
        · {t.recommended} · {why}
      </span>
    </div>
  )
}

export interface JumpText {
  new: (n: number) => string
}

export const jumpText: JumpText = { new: (n) => `${n} new` }

/** New things below where you scrolled up to: a pill that takes you there. The host places it, at the foot of the thread. */
export function Jump({
  count,
  onJump,
  className,
  text,
}: {
  count: number
  onJump: () => void
  className?: string
  text?: Partial<JumpText>
}) {
  const t = { ...jumpText, ...text }
  return (
    <button type="button" className={cx(s.jump, className)} onClick={onJump}>
      <LiveDot pulse />
      {t.new(count)}
      <Icon name="down" size={11} />
    </button>
  )
}
