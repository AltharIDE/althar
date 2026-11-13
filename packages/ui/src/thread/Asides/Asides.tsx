import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import s from './Asides.module.css'

/*
 * Asides (a task is a conversation plus parts, "Asides"): quick chats beside
 * the coordinator's conversation, with its tools, kept off the board. Pills
 * over the conversation: the coordinator first, with its mark, then each
 * aside, the latest first, a live dot while its agent is at it, and an × that
 * clears it; those left a week fold into "N older", which clears them
 * together; + starts one. In an open aside, its own moves sit over its
 * composer (AsideMoves).
 */

export interface Aside {
  id: string
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
  clear: (title: string) => string
  clearHint: string
}

export const asideTabsText: AsideTabsText = {
  label: 'Conversations',
  coordinator: 'Coordinator',
  newAside: 'New aside',
  add: 'New aside',
  older: (count) => `${count} older`,
  olderNote: 'Untouched for over a week. Cleared, ⌘K still finds them.',
  clearOlder: (count) => (count === 1 ? 'Clear it' : `Clear these ${count}`),
  clear: (title) => `Clear “${title}”`,
  clearHint: 'Clear: ⌘K still finds it',
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
    /** The one open, by its id; null for the coordinator's conversation. */
    current: string | null
    /** A new aside being started: its pill, open, first among the asides. */
    starting?: boolean
    onPick: (id: string | null) => void
    onNew: () => void
    /** Settles one, from the × on its pill. Without it, a pill has no ×. */
    onClear?: (id: string) => void
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
  starting = false,
  onPick,
  onNew,
  onClear,
  onClearOlder,
  newKbd,
  text,
  className,
  ...rest
}: AsideTabsProps) {
  const t = { ...asideTabsText, ...text }
  const onCoordinator = current === null && !starting
  return (
    <div className={cx(s.strip, className)} {...rest}>
      <div className={s.tabs} role="tablist" aria-label={t.label}>
        <button type="button" role="tab" aria-selected={onCoordinator} className={cx(s.pill, s.coordinator)} onClick={() => onPick(null)}>
          {mark}
          {t.coordinator}
        </button>
        {(asides.length > 0 || starting) && <span className={s.rule} aria-hidden />}
        {starting && (
          <button type="button" role="tab" aria-selected className={s.pill}>
            <span className={s.title}>{t.newAside}</span>
          </button>
        )}
        {[...asides, ...older.filter((one) => one.id === current)].map((aside) => (
          <span key={aside.id} className={cx(s.item, onClear !== undefined && s.clearable)} data-aside={aside.id}>
            <button
              type="button"
              role="tab"
              aria-selected={!starting && current === aside.id}
              className={s.pill}
              title={aside.said ?? aside.title}
              onClick={() => onPick(aside.id)}
            >
              {aside.running === true && <LiveDot pulse />}
              <span className={s.title}>{aside.title}</span>
            </button>
            {onClear !== undefined && (
              <Tooltip label={t.clearHint}>
                <button type="button" className={s.clear} aria-label={t.clear(aside.title)} onClick={() => onClear(aside.id)}>
                  <Icon name="close" size={10} />
                </button>
              </Tooltip>
            )}
          </span>
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
}

export const asideMovesText: AsideMovesText = {
  makeTask: 'Make it a task',
}

export type AsideMovesProps = RootProps<
  'div',
  {
    /** Moves it to the board, as work. */
    onMakeTask: () => void
    /** A quiet word at the end: when it was asked, or what it quotes. */
    note?: ReactNode
    busy?: boolean
    text?: Partial<AsideMovesText>
  }
>

/** An open aside's own moves, over its composer, where the person is when they have read the answer; its × on its pill clears it. */
export function AsideMoves({ onMakeTask, note, busy = false, text, className, ...rest }: AsideMovesProps) {
  const t = { ...asideMovesText, ...text }
  return (
    <div className={cx(s.moves, className)} {...rest}>
      <Button size="small" variant="quiet" icon="work" disabled={busy} onClick={onMakeTask}>
        {t.makeTask}
      </Button>
      {note !== undefined && <span className={s.note}>{note}</span>}
    </div>
  )
}
