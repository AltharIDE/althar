import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Furniture.module.css'
import { Rhythm } from '../../lib/rhythm'

export type ThreadDividerProps = RootProps<
  'div',
  {
    icon: IconName
    children: ReactNode
  } & ({ action: string; onAction: () => void } | { action?: undefined; onAction?: undefined })
>

/** A line across the thread that marks a change of scene: the lead changed, the task resumed. It may carry one action. */
export function ThreadDivider({ icon, children, action, onAction, className, ...rest }: ThreadDividerProps) {
  return (
    /* not role=separator: a separator's content is hidden from assistive technology, and this one says something */
    <div className={cx(s.divider, className)} {...rest}>
      <Icon name={icon} size={11} />
      <span>{children}</span>
      <span className={s.rule} aria-hidden="true" />
      {action && onAction && (
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
  checking: 'Althar restarted. Checking where the lead had got to before carrying on',
  carriedOn: 'Carried on after a restart',
  nothingTwice: 'nothing was run twice',
}

/**
 * Althar restarted while the task ran. It first checks what had already
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

export type ThreadEmptyProps = RootProps<
  'div',
  {
    kicker?: string
    title: string
    children?: ReactNode
    /** The title's rank in the page's outline. */
    headingLevel?: HeadingLevel
  }
>

/** An empty conversation: what it is for, before anything is said. */
export function ThreadEmpty({ kicker, title, children, headingLevel = 2, className, ...rest }: ThreadEmptyProps) {
  return (
    <div className={cx(s.empty, className)} {...rest}>
      {kicker && <span className={s.kicker}>{kicker}</span>}
      <Heading level={headingLevel} className={s.emptyTitle}>
        {title}
      </Heading>
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
      <span className={s.swapNote}>
        · {t.recommended} · {why}
      </span>
    </div>
  )
}

export interface JumpToLatestText {
  new: (n: number) => string
  /** Without a count. */
  latest: string
  /** After the count, for a screen reader: where the button goes. */
  goes: string
}

export const jumpToLatestText: JumpToLatestText = { new: (n) => `${n} new`, latest: 'Latest', goes: 'jump to the latest' }

export type JumpToLatestProps = RootProps<
  'button',
  {
    /** How many things arrived below. Without it, the pill says only that it goes to the latest. */
    count?: number
    onJump: () => void
    text?: Partial<JumpToLatestText>
  }
>

/** You scrolled up and things arrived below: a pill that takes you there. TaskFace places it; another host places it at the foot of its thread. */
export function JumpToLatest({ count, onJump, className, text, ...rest }: JumpToLatestProps) {
  const t = { ...jumpToLatestText, ...text }
  const some = count !== undefined && count > 0
  return (
    <button type="button" className={cx(s.jump, className)} onClick={onJump} {...rest}>
      {some && <LiveDot pulse />}
      {some ? t.new(count) : t.latest}
      {some && <VisuallyHidden>, {t.goes}</VisuallyHidden>}
      <Icon name="down" size={11} />
    </button>
  )
}
