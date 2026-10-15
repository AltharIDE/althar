// Throwaway: what every idea draws from: the dictation as it stands, its words, the voice's bars, who it goes to, and what the person can do.
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef } from 'react'

import {
  Button,
  FieldArea,
  type IconName,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  ProjectInk,
  ProjectMark,
  Spinner,
  SplitButton,
} from '@althar/ui'

import { navigate } from '../nav'
import { act, type Address, addressOf, clock, heardOf, type Live, lookingAt, OPEN, type Session, toLine, useLive, wordsIn } from '../voice'
import composer from '../../../../../packages/ui/src/composer/Composer/Composer.module.css'
import s from './common.module.css'

export interface View {
  readonly live: Live
  readonly session: Session
  /** Something to draw away from its composer: being said, written, or just sent or thrown away. */
  readonly shown: boolean
  /** Its own composer is on screen, and shows it there. */
  readonly inComposer: boolean
  readonly to: Address
  /** The task on screen, when it isn't who it goes to: it can go there instead. */
  readonly here: Address | null
  readonly settled: string
  readonly unsettled: string
  readonly elapsed: string
}

export const useView = (): View => {
  const live = useLive()
  const session = live.session
  const inComposer = (live.onScreen[session.to] ?? 0) > 0
  const lingering = session.phase === 'sent' || session.phase === 'cancelled'
  const here = lookingAt(live.path)
  const words = heardOf(session)
  return {
    live,
    session,
    inComposer,
    shown: live.idea !== 'T' && ((OPEN.has(session.phase) && !inComposer) || lingering),
    to: addressOf(session.to),
    here: here !== null && here !== session.to ? addressOf(here) : null,
    settled: words.settled,
    unsettled: words.unsettled,
    elapsed: clock(session.seconds),
  }
}

/** The voice, as the composer draws it while dictating: its own bars. */
export function Wave({ levels, className }: { levels: ReadonlyArray<number>; className?: string }) {
  return (
    <span className={`${composer.wave} ${className ?? ''}`} aria-hidden="true">
      {levels.map((level, index) => (
        <i key={index} style={{ '--l': Math.max(0, Math.min(1, level)) } as CSSProperties} />
      ))}
    </span>
  )
}

/** Who it goes to: the project's mark, then the coordinator or the task. */
export function To({
  address,
  className,
  children,
  short = false,
}: {
  address: Address
  className?: string
  children?: ReactNode
  /** Only who, where room is short: the project's mark beside it says where. */
  short?: boolean
}) {
  return (
    <span className={`${s.to} ${className ?? ''}`} title={short ? toLine(address) : undefined}>
      <ProjectMark seed="p1" ink={ProjectInk.Clay} size={14} />
      <span className={s.toText}>{short ? (address.kind === 'coordinator' ? 'To the coordinator' : 'To the lead') : toLine(address)}</span>
      {children}
    </span>
  )
}

/**
 * The words so far: settled ones dark, the end still changing faint. It
 * follows the newest words, until the person scrolls up to read; back at the
 * end, it follows again.
 */
export function Words({ view, className, style }: { view: View; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    if (following.current) element.scrollTop = element.scrollHeight
    // Words above, out of sight: the top edge fades, so a line cut there reads as more above.
    element.toggleAttribute('data-cut', element.scrollTop > 2)
  }, [view.settled, view.unsettled])
  return (
    <div
      ref={box}
      className={`${s.words} ${className ?? ''}`}
      style={style}
      onScroll={(event) => {
        const element = event.currentTarget
        following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 6
        element.toggleAttribute('data-cut', element.scrollTop > 2)
      }}
      aria-live="off"
    >
      <span className={s.settled}>{view.settled}</span> <span className={s.unsettled}>{view.unsettled}</span>
      {view.session.phase === 'listening' && <span className={s.caret} aria-hidden="true" />}
    </div>
  )
}

/** The last few words, for a line too short for more. */
export const tailOf = (view: View, words = 9) => {
  const all = `${view.settled} ${view.unsettled}`.trim().split(/\s+/)
  return { cut: all.length > words, text: all.slice(-words).join(' ') }
}

/** Written down: the person's to change before it goes. */
export function Editor({ view, rows = 5, className }: { view: View; rows?: number; className?: string }) {
  return (
    <FieldArea
      className={`${s.editor} ${className ?? ''}`}
      rows={rows}
      value={view.session.text}
      aria-label="What you said, to change before it goes"
      onChange={(event) => act.edit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          act.send(view.session.to)
        }
      }}
    />
  )
}

/** Where the dictation stands, in a few words. */
export const statusOf = (view: View): string => {
  const { session } = view
  switch (session.phase) {
    case 'listening':
      return `Listening · ${view.elapsed}`
    case 'paused':
      return `Paused · ${view.elapsed}`
    case 'writing':
      return session.slow ? 'Writing it down · your Mac is busy, so it takes longer' : 'Writing it down'
    case 'done':
      return `Written · ${wordsIn(session.text)} words, not sent`
    case 'failed':
      return 'Couldn’t write that down'
    case 'sent':
      return `Sent ${toLine(addressOf(session.sentTo ?? session.to)).replace(/^To/, 'to')}`
    case 'cancelled':
      return 'Thrown away'
    default:
      return ''
  }
}

/** Back to the composer it goes to, where it carries on. */
export const back = (to: Address) => navigate(to.path)

interface Control {
  readonly icon: IconName
  readonly label: string
  readonly onClick: () => void
  readonly kbd?: string
}

/** The small controls, by where it stands: pause or carry on, stop, throw away, back to its composer. */
export const controlsOf = (view: View): ReadonlyArray<Control> => {
  const { session, to } = view
  const backTo: Control = {
    icon: 'corner',
    label: `Back to ${to.kind === 'coordinator' ? 'the conversation' : 'the task'}`,
    onClick: () => back(to),
  }
  const away: Control = { icon: 'close', label: 'Throw it away', onClick: act.cancel }
  switch (session.phase) {
    case 'listening':
      return [
        { icon: 'hold', label: 'Pause', onClick: act.pause },
        { icon: 'square', label: 'Stop and write it down', onClick: act.stop, kbd: '⌘⇧D' },
        backTo,
        away,
      ]
    case 'paused':
      return [
        { icon: 'mic', label: 'Carry on', onClick: act.resume, kbd: '⌘⇧D' },
        { icon: 'square', label: 'Stop and write it down', onClick: act.stop },
        backTo,
        away,
      ]
    case 'writing':
      return [backTo, away]
    case 'done':
    case 'failed':
      return [backTo, away]
    default:
      return []
  }
}

export function Controls({ view, size = 'small' }: { view: View; size?: 'small' | 'medium' }) {
  return (
    <>
      {controlsOf(view).map((one) => (
        <IconButton
          key={one.label}
          icon={one.icon}
          label={one.label}
          size={size}
          onClick={one.onClick}
          {...(one.kbd === undefined ? {} : { kbd: one.kbd })}
        />
      ))}
    </>
  )
}

/** Send: to who it goes to, and, on a task, to that task instead. Still being said, it is written down first. */
export function Send({ view, size = 'small', short = false }: { view: View; size?: 'small' | 'medium'; short?: boolean }) {
  const { to, here, session } = view
  if (!OPEN.has(session.phase) || session.phase === 'failed') return null
  const waiting = session.sendWhenWritten !== null
  const label = waiting ? 'Sends once written' : short ? 'Send' : `Send to ${to.who}`
  if (here === null)
    return (
      <Button size={size} variant="ink" icon="up" busy={waiting} onClick={() => act.send(to.key)}>
        {label}
      </Button>
    )
  return (
    <SplitButton
      size={size}
      icon="up"
      busy={waiting}
      onClick={() => act.send(to.key)}
      moreLabel="Send it elsewhere"
      menu={(trigger) => (
        <Menu trigger={trigger} label="Send it to" align="end" placement="above" width={300}>
          <MenuItem icon="up" onSelect={() => act.send(to.key)} description={toLine(to)}>
            {`Send to ${to.who}`}
          </MenuItem>
          <MenuItem icon="arrow" onSelect={() => act.send(here.key)} description={here.name}>
            Send to this task’s lead instead
          </MenuItem>
        </Menu>
      )}
    >
      {label}
    </SplitButton>
  )
}

/** Couldn't write it down: it is kept, to try again. */
export function Failed({ view }: { view: View }) {
  return (
    <div className={s.failed}>
      <p className={s.failedHead}>Couldn’t write that down</p>
      <p className={s.failedNote}>What you said ({view.elapsed}) is kept; try again.</p>
      <div className={s.row}>
        <Button size="small" onClick={act.retry}>
          Try again
        </Button>
        <LinkButton onClick={act.cancel}>Throw it away</LinkButton>
      </div>
    </div>
  )
}

/** Writing it down: the microphone turns, and says when the Mac is busy. */
export function Writing({ view }: { view: View }) {
  return (
    <span className={s.writing}>
      <Spinner size="small" label="Writing it down" />
      {statusOf(view)}
    </span>
  )
}

/** Sent or thrown away, for a few seconds: where it went, or a way back. */
export function After({ view }: { view: View }) {
  const { session } = view
  if (session.phase === 'sent') {
    const went = addressOf(session.sentTo ?? session.to)
    return (
      <span className={s.after}>
        {statusOf(view)}
        <LinkButton onClick={() => navigate(went.path)}>Open</LinkButton>
      </span>
    )
  }
  if (session.phase === 'cancelled')
    return (
      <span className={s.after}>
        Thrown away
        <LinkButton onClick={act.undoCancel}>Undo</LinkButton>
      </span>
    )
  return null
}

/** The tasks looked at while it was open, when there were more than one. */
export function Seen({ view }: { view: View }) {
  const seen = view.session.seen
  if (seen.length < 2) return null
  return <p className={s.seen}>You looked at {seen.map((key) => `“${addressOf(key).name}”`).join(', then ')} while you talked.</p>
}
