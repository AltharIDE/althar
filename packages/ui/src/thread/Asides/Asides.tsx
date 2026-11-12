import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import s from './Asides.module.css'

/*
 * Asides (a task is a conversation plus parts, "Asides"): quick chats beside
 * the coordinator's conversation, with its tools, kept off the board. Pills
 * over the conversation: the coordinator first, with its mark, then each
 * aside, the latest first, a live dot while its agent is at it; those left a
 * week fold into "N older", which clears them together; + starts one. In an
 * open aside, its own moves sit over its composer (AsideMoves).
 */

export interface Aside {
  id: string
  /** Its title; empty for one just started, whose pill says it is new until its first words name it. */
  title: string
  /** What was said last, its first line: the pill's hover. */
  said?: string
  /** Its agent is at it now. */
  running?: boolean
}

export interface AsideTabsText {
  label: string
  coordinator: string
  newAside: string
  add: string
  older: (count: number) => string
  olderNote: string
  clearOlder: (count: number) => string
}

export const asideTabsText: AsideTabsText = {
  label: 'Conversations',
  coordinator: 'Coordinator',
  newAside: 'New aside',
  add: 'New aside',
  older: (count) => `${count} older`,
  olderNote: 'Untouched for over a week. Cleared, ⌘K still finds them.',
  clearOlder: (count) => (count === 1 ? 'Clear it' : `Clear these ${count}`),
}

export type AsideTabsProps = RootProps<
  'div',
  {
    /** The coordinator's mark, before its name. */
    mark: ReactNode
    /** The latest first. */
    asides: readonly Aside[]
    /** Those left untouched for a week, folded into one pill. */
    older?: readonly Aside[]
    /**
     * The one open, by its id; null for the coordinator's conversation. A new one is among `asides` from the moment it is
     * started, by the id it keeps, so its pill is the one pill it has as its title fills in.
     */
    current: string | null
    onPick: (id: string | null) => void
    onNew: () => void
    /** Settles the older ones together. Without it, they can only be opened. */
    onClearOlder?: (ids: readonly string[]) => void
    /** The keys that start one, as its tooltip says them. */
    newKbd?: string
    text?: Partial<AsideTabsText>
  }
>

export function AsideTabs({
  mark,
  asides,
  older = [],
  current,
  onPick,
  onNew,
  onClearOlder,
  newKbd,
  text,
  className,
  ...rest
}: AsideTabsProps) {
  const t = { ...asideTabsText, ...text }
  const onCoordinator = current === null
  return (
    <div className={cx(s.strip, className)} {...rest}>
      <div className={s.tabs} role="tablist" aria-label={t.label}>
        <button type="button" role="tab" aria-selected={onCoordinator} className={cx(s.pill, s.coordinator)} onClick={() => onPick(null)}>
          {mark}
          {t.coordinator}
        </button>
        {asides.length > 0 && <span className={s.rule} aria-hidden />}
        {[...asides, ...older.filter((one) => one.id === current)].map((aside) => (
          <button
            key={aside.id}
            type="button"
            role="tab"
            aria-selected={current === aside.id}
            className={s.pill}
            data-aside={aside.id}
            title={aside.said ?? (aside.title || t.newAside)}
            onClick={() => onPick(aside.id)}
          >
            {aside.running === true && <LiveDot pulse />}
            <span className={s.title}>{aside.title || t.newAside}</span>
          </button>
        ))}
      </div>
      {older.length > 0 && (
        <Menu
          label={t.older(older.length)}
          note={t.olderNote}
          trigger={
            <button type="button" className={s.older}>
              {t.older(older.length)}
            </button>
          }
        >
          {older.map((aside) => (
            <MenuItem key={aside.id} onSelect={() => onPick(aside.id)}>
              {aside.title}
            </MenuItem>
          ))}
          {onClearOlder !== undefined && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => onClearOlder(older.map((aside) => aside.id))}>{t.clearOlder(older.length)}</MenuItem>
            </>
          )}
        </Menu>
      )}
      <IconButton icon="plus" size="small" label={t.add} {...(newKbd === undefined ? {} : { kbd: newKbd })} onClick={onNew} />
    </div>
  )
}

export interface AsideMovesText {
  makeTask: string
  clear: string
  clearHint: string
}

export const asideMovesText: AsideMovesText = {
  makeTask: 'Make it a task',
  clear: 'Clear',
  clearHint: 'It leaves the asides; ⌘K still finds it',
}

export type AsideMovesProps = RootProps<
  'div',
  {
    /** Moves it to the board, as work. */
    onMakeTask: () => void
    /** Settles it: it leaves the asides, and ⌘K still finds it. */
    onClear: () => void
    /** A quiet word at the end: when it was asked, or what it quotes. */
    note?: ReactNode
    busy?: boolean
    text?: Partial<AsideMovesText>
  }
>

/** An open aside's own moves, over its composer, where the person is when they have read the answer. */
export function AsideMoves({ onMakeTask, onClear, note, busy = false, text, className, ...rest }: AsideMovesProps) {
  const t = { ...asideMovesText, ...text }
  return (
    <div className={cx(s.moves, className)} {...rest}>
      <Button size="small" variant="quiet" icon="work" disabled={busy} onClick={onMakeTask}>
        {t.makeTask}
      </Button>
      <Button size="small" variant="quiet" icon="close" disabled={busy} title={t.clearHint} onClick={onClear}>
        {t.clear}
      </Button>
      {note !== undefined && <span className={s.note}>{note}</span>}
    </div>
  )
}
