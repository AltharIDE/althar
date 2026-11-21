import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './StatusLine.module.css'

/*
 * The window's status line: a quiet line of words along its foot, as an
 * editor's status bar is, there once a project runs something or the person
 * opens a terminal. Each run by its mark, its name and how it stands; each
 * terminal by its folder, and what runs in it in front where that isn't its
 * shell. A press raises the drawer over the window's lower part, which moves
 * nothing under it; the same press lowers it. Pointed at or focused, each has
 * an X in its mark's place: a run that ended and an idle terminal go at once; a run still
 * running, or a terminal with something running in it, first says that
 * closing it stops it.
 */

export type RunPhase = 'starting' | 'up' | 'failed' | 'finished' | 'stopped'

export type StatusItem =
  | {
      readonly kind: 'run'
      readonly id: string
      readonly name: string
      readonly phase: RunPhase
      /** Where it answers, once it does. */
      readonly url?: string
      /** How it ended, where it failed: its exit code. */
      readonly code?: number | null
    }
  | {
      readonly kind: 'terminal'
      readonly id: string
      /** Its folder, by its name. */
      readonly name: string
      /** What runs in it in front, where that isn't its shell: closing it stops that. */
      readonly busy?: string
      /** How its shell ended, where it did, not well. */
      readonly code?: number
    }

export interface StatusLineText {
  label: string
  starting: string
  finished: string
  stopped: string
  failed: (code: number | null | undefined) => string
  newTerminal: string
  close: (name: string) => string
  stopRun: (name: string) => string
  stopRunWhy: string
  stop: string
  closeTerminal: string
  closeTerminalWhy: (busy: string) => string
  keep: string
  ended: (code: number) => string
}

export const statusLineText: StatusLineText = {
  label: 'Runs and terminals',
  starting: 'Starting…',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: (code) => (code == null ? 'Failed' : `Exited ${code}`),
  newTerminal: 'New terminal',
  close: (name) => `Close ${name}`,
  stopRun: (name) => `Stop ${name}?`,
  stopRunWhy: 'It’s still running. Closing it stops it.',
  stop: 'Stop',
  closeTerminal: 'Close terminal',
  closeTerminalWhy: (busy) => `${busy} is still running in it. Closing the terminal stops it.`,
  keep: 'Keep',
  ended: (code) => `Exited ${code}`,
}

/** Closing it stops something still running: it asks first. */
export const asksFirst = (item: StatusItem) =>
  item.kind === 'run' ? item.phase === 'starting' || item.phase === 'up' : item.busy !== undefined && item.code === undefined

export interface StatusLineProps {
  items: ReadonlyArray<StatusItem>
  /** The one the drawer shows, while it is up. */
  chosen?: string
  onPress: (id: string) => void
  /** Closes it: a run stopped or cleared, a terminal closed. Asked first where that stops something. */
  onDismiss: (id: string) => void
  onNewTerminal: () => void
  /** The key that opens a terminal, as the system draws it. */
  newTerminalKbd?: string
  className?: string
  text?: Partial<StatusLineText>
}

/** A run's mark: on its way, running, how it ended. */
export function RunMark({ phase }: { phase: RunPhase }) {
  return (
    <span className={s.mark} aria-hidden="true">
      {phase === 'starting' && <Spinner size="small" />}
      {phase === 'up' && <LiveDot />}
      {phase === 'failed' && <Icon name="close" size={11} className={s.bad} />}
      {phase === 'finished' && <Icon name="check" size={11} />}
      {phase === 'stopped' && <Icon name="square" size={10} className={s.faint} />}
    </span>
  )
}

/** How a run stands, in words: on its way, where it answers, how it ended. */
export function RunWords({ item, text }: { item: Extract<StatusItem, { kind: 'run' }>; text?: Partial<StatusLineText> }) {
  const t = { ...statusLineText, ...text }
  if (item.phase === 'up') return item.url === undefined ? null : <span className={s.address}>{addressOf(item.url)}</span>
  if (item.phase === 'failed') return <span className={s.bad}>{t.failed(item.code)}</span>
  return <span className={s.faint}>{item.phase === 'starting' ? t.starting : item.phase === 'finished' ? t.finished : t.stopped}</span>
}

/** Where it answers, as it reads at a glance: localhost:5173. */
export const addressOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

export function StatusLine({ items, chosen, onPress, onDismiss, onNewTerminal, newTerminalKbd, className, text }: StatusLineProps) {
  const t = { ...statusLineText, ...text }
  return (
    <footer className={cx(s.line, className)} aria-label={t.label}>
      <div className={s.items} role="list">
        {items.map((item) => (
          <Item key={item.id} item={item} chosen={chosen === item.id} onPress={onPress} onDismiss={onDismiss} text={t} />
        ))}
      </div>
      <IconButton
        icon="terminal"
        label={t.newTerminal}
        {...(newTerminalKbd === undefined ? {} : { kbd: newTerminalKbd })}
        size="small"
        tooltip="above"
        tooltipAlign="end"
        className={s.end}
        onClick={onNewTerminal}
      />
    </footer>
  )
}

function Item({
  item,
  chosen,
  onPress,
  onDismiss,
  text: t,
}: {
  item: StatusItem
  chosen: boolean
  onPress: (id: string) => void
  onDismiss: (id: string) => void
  text: StatusLineText
}) {
  const [asking, setAsking] = useState(false)
  const close = () => {
    if (asksFirst(item)) setAsking(true)
    else onDismiss(item.id)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    close()
  }
  const running = item.kind === 'run' && item.phase === 'up'
  return (
    <div className={cx(s.item, chosen && s.chosen, asking && s.held)} role="listitem">
      <button
        type="button"
        className={s.press}
        aria-pressed={chosen}
        onClick={() => onPress(item.id)}
        onKeyDown={onKeyDown}
        title={item.name}
      >
        {item.kind === 'run' ? <RunMark phase={item.phase} /> : <Icon name="terminal" size={12} className={cx(s.mark, s.faint)} />}
        <span className={s.name}>{item.name}</span>
        {item.kind === 'run' ? (
          <span className={cx(s.state, running && s.giving)}>
            <RunWords item={item} text={t} />
          </span>
        ) : item.code !== undefined ? (
          <span className={cx(s.state, s.bad)}>{t.ended(item.code)}</span>
        ) : item.busy !== undefined ? (
          <span className={cx(s.state, s.giving, s.faint)}>{item.busy}</span>
        ) : null}
      </button>
      <Popover
        label={item.kind === 'run' ? t.stopRun(item.name) : t.closeTerminal}
        trigger={
          <button type="button" className={s.close} aria-label={t.close(item.name)} title={t.close(item.name)}>
            <Icon name="close" size={10} />
          </button>
        }
        placement="above"
        align="start"
        width={280}
        open={asking}
        onOpenChange={(open) => {
          if (open) close()
          else setAsking(false)
        }}
      >
        <div className={s.ask}>
          {item.kind === 'run' ? (
            <>
              <p className={s.askTitle}>{t.stopRun(item.name)}</p>
              <p className={s.askWhy}>{t.stopRunWhy}</p>
            </>
          ) : (
            <p className={s.askWhy}>{t.closeTerminalWhy(item.busy ?? '')}</p>
          )}
          <div className={s.askActions}>
            <Button size="small" variant="quiet" onClick={() => setAsking(false)}>
              {t.keep}
            </Button>
            <Button
              size="small"
              variant="danger"
              onClick={() => {
                setAsking(false)
                onDismiss(item.id)
              }}
            >
              {item.kind === 'run' ? t.stop : t.closeTerminal}
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  )
}

export interface StatusDrawerProps {
  /** What it shows, at its head: the chosen one's name and how it stands. */
  title: ReactNode
  /** Its ways, at the end of its head. */
  actions?: ReactNode
  children: ReactNode
  /** How tall it is, and how tall it may be. */
  height: number
  max: number
  onHeight: (height: number) => void
  /** Lowers it: Escape, outside a terminal, which takes Escape itself. */
  onLower: () => void
  label: string
  className?: string
}

/** How short the drawer may be. */
const LEAST = 160

/**
 * The drawer the status line raises: over the window's lower part, floating,
 * so nothing under it moves; its top edge drags it taller or shorter.
 */
export function StatusDrawer({ title, actions, children, height, max, onHeight, onLower, label, className }: StatusDrawerProps) {
  const shown = Math.max(LEAST, Math.min(height, max))
  return (
    <section
      className={cx(s.drawer, className)}
      style={{ height: shown }}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        // A terminal takes Escape for what runs in it (vim, a prompt): the drawer stays.
        if (event.target instanceof Element && event.target.closest('.xterm') !== null) return
        event.preventDefault()
        onLower()
      }}
    >
      <HeightEdge value={shown} min={LEAST} max={max} onChange={onHeight} label={label} />
      <div className={s.head}>
        <div className={s.title}>{title}</div>
        {actions !== undefined && <div className={s.actions}>{actions}</div>}
      </div>
      <div className={s.body}>{children}</div>
    </section>
  )
}

/** The drawer's top edge, to drag it taller or shorter; ↑ ↓ move it a step. */
function HeightEdge({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (height: number) => void
  label: string
}) {
  const drag = useRef<{ readonly y: number; readonly height: number } | null>(null)
  const clamp = (height: number) => Math.round(Math.min(Math.max(height, min), Math.max(min, max)))
  const end = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={clamp(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      tabIndex={0}
      className={s.edge}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { y: event.clientY, height: value }
      }}
      onPointerMove={(event) => {
        const from = drag.current
        if (from !== null) onChange(clamp(from.height + from.y - event.clientY))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const by = event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0
        if (by === 0) return
        event.preventDefault()
        onChange(clamp(value + by))
      }}
    />
  )
}
