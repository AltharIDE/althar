import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import s from './ScratchShelf.module.css'

/*
 * Scratch (a task is a conversation plus parts, "Asides"): the
 * chats the coordinator started, off the board's lanes, behind one chip at
 * the head of Up next. Opened in place, never a sidebar, it lists them by
 * their latest exchange, the latest first: each by its title, what was said
 * last and by whom, and when, with a still live dot while its lead is at
 * it. A press on one opens it; Clear settles it, and ⌘K still finds it.
 */

export interface ScratchChat {
  id: string
  title: string
  /** What was said last, its first line: by the person, or by its lead. */
  said?: { by: 'person' | 'lead'; text: string }
  /** When, in a word or two: 4m, yesterday. */
  at?: string
  /** Its lead is at it now. */
  running?: boolean
}

export interface ScratchShelfText {
  chip: (count: number) => string
  label: string
  you: string
  clear: (title: string) => string
  empty: string
}

export const scratchShelfText: ScratchShelfText = {
  chip: (count) => `Scratch · ${count}`,
  label: 'Chats on Scratch',
  you: 'You',
  clear: (title) => `Clear “${title}”`,
  empty: 'Nothing on Scratch.',
}

export type ScratchShelfProps = RootProps<
  'div',
  {
    /** The latest exchange first. */
    chats: readonly ScratchChat[]
    onOpen: (id: string) => void
    /** Settles a chat: it leaves Scratch, and ⌘K still finds it. Without it, no Clear. */
    onClear?: (id: string) => void
    /** Open at first: for a story, or a test. */
    defaultOpen?: boolean
    text?: Partial<ScratchShelfText>
  }
>

export function ScratchShelf({ chats, onOpen, onClear, defaultOpen, text, className, ...rest }: ScratchShelfProps) {
  const t = { ...scratchShelfText, ...text }
  if (chats.length === 0) return null
  return (
    <div className={cx(s.shelf, className)} {...rest}>
      <Popover
        label={t.label}
        placement="below"
        align="start"
        width={360}
        padded={false}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        trigger={<LinkButton>{t.chip(chats.length)}</LinkButton>}
      >
        <ul className={s.list} aria-label={t.label}>
          {chats.map((chat) => (
            <li key={chat.id} className={s.chat}>
              <button type="button" className={s.open} onClick={() => onOpen(chat.id)}>
                {/* The titles line up; a live dot, still, goes with when. */}
                <span className={s.top}>
                  <span className={s.title}>{chat.title}</span>
                  {chat.running === true && <LiveDot />}
                  {chat.at !== undefined && <span className={s.at}>{chat.at}</span>}
                </span>
                {chat.said !== undefined && chat.said.text !== '' && (
                  <span className={s.said}>
                    {chat.said.by === 'person' && <span className={s.you}>{t.you}: </span>}
                    {chat.said.text}
                  </span>
                )}
              </button>
              {onClear !== undefined && (
                <IconButton className={s.clear} icon="close" label={t.clear(chat.title)} size="small" onClick={() => onClear(chat.id)} />
              )}
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  )
}
