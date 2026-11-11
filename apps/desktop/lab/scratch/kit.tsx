import { type ReactNode, useMemo, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'
import { Button, Composer, IconButton, LinkButton, LiveDot, Thread, ThreadShellProvider } from '@althar/ui'

import { ago } from '../../src/renderer/shared/time'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { items } from '../../tests/fixtures'
import { type Chat, isOld, OLD_DAYS } from './data'
import { useLab } from './lab'
import s from './kit.module.css'

/*
 * What every direction draws a chat with: its row in a list, its thread with
 * a composer, the line that offers to clear the old ones, and the box that
 * starts one. Built from the kit's own parts and the app's thread.
 */

/** When, in a word: 4m, 3h, yesterday, 9d. */
export const when = (minutes: number) => {
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 48) return 'yesterday'
  return `${Math.round(minutes / 60 / 24)}d`
}

/** The words a direction calls its things by. */
export interface Words {
  /** What one is: chat, aside. */
  readonly one: string
  readonly many: string
}

export function ChatRow({
  chat,
  current,
  onOpen,
  project,
}: {
  chat: Chat
  current?: boolean
  onOpen: () => void
  words: Words
  /** Says its project, where the list reaches across them. */
  project?: boolean
}) {
  const lab = useLab()
  return (
    <li className={s.row} aria-current={current || undefined} data-old={isOld(chat) || undefined}>
      <button type="button" className={s.open} onClick={onOpen}>
        <span className={s.top}>
          {chat.running === true && <LiveDot pulse />}
          <span className={s.title}>{chat.title}</span>
          <span className={s.at}>{when(chat.minutes)}</span>
        </span>
        <span className={s.said}>
          {project === true && chat.project !== undefined && <span className={s.project}>{chat.project} · </span>}
          {chat.by === 'person' && <span className={s.you}>You: </span>}
          {chat.said}
        </span>
      </button>
      <span className={s.actions}>
        <LinkButton onClick={() => lab.promote(chat.id)}>Make it a task</LinkButton>
        <IconButton icon="close" size="small" label={`Clear “${chat.title}”`} onClick={() => lab.clear([chat.id])} />
      </span>
    </li>
  )
}

/** The old ones, offered to clear: only where some are. */
export function OldLine({ chats, words }: { chats: ReadonlyArray<Chat>; words: Words }) {
  const lab = useLab()
  const old = chats.filter(isOld)
  if (old.length === 0) return null
  return (
    <p className={s.old}>
      {old.length === 1 ? `1 ${words.one}` : `${old.length} ${words.many}`} untouched for over {OLD_DAYS} days.{' '}
      <LinkButton onClick={() => lab.clear(old.map((chat) => chat.id))}>Clear {old.length === 1 ? 'it' : 'them'}</LinkButton>
    </p>
  )
}

/** A composer that starts one: what's sent is its first message. */
export function StartBox({
  placeholder,
  onStarted,
  picker,
  className,
}: {
  placeholder: string
  onStarted: (chat: Chat) => void
  picker?: ReactNode
  className?: string
}) {
  const lab = useLab()
  const [value, setValue] = useState('')
  return (
    <div className={className}>
      <Composer
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        {...(picker === undefined ? {} : { picker })}
        onSubmit={(text) => {
          if (text.trim() === '') return
          setValue('')
          onStarted(lab.start(text.trim()))
        }}
      />
    </div>
  )
}

const threadItems = (chat: Chat): ReadonlyArray<ThreadItem> =>
  chat.minutes === 0
    ? [items.you(chat.title)]
    : [
        items.you(chat.title),
        items.says(chat.by === 'lead' ? chat.said : 'Here’s what I found.'),
        ...(chat.by === 'person' ? [items.you(chat.said)] : []),
      ]

/** A chat open in place: its head, with what it can become, its thread, and a composer. */
export function ChatFace({ chat, words, head, onDone }: { chat: Chat; words: Words; head?: ReactNode; onDone?: () => void }) {
  const lab = useLab()
  const [said, setSaid] = useState<ReadonlyArray<ThreadItem>>([])
  const [value, setValue] = useState('')
  const promoted = lab.promoted.has(chat.id)
  const blocks = useMemo(
    () =>
      blocksOf(
        { items: [...threadItems(chat), ...said], turnRunning: chat.running === true, turnStarted: null, turnEnded: null, worktree: null },
        new Map(),
        (iso) => ago(iso),
      ),
    [chat, said],
  )
  return (
    <div className={s.face}>
      <div className={s.head}>
        {head}
        <span className={s.headTitle}>{chat.title}</span>
        {promoted ? (
          <span className={s.moved}>A task now, on the board</span>
        ) : (
          <>
            <Button size="small" icon="work" onClick={() => lab.promote(chat.id)}>
              Make it a task
            </Button>
            <LinkButton
              title={`Clear this ${words.one}: it leaves the list, and ⌘K still finds it`}
              onClick={() => {
                lab.clear([chat.id])
                onDone?.()
              }}
            >
              Clear
            </LinkButton>
          </>
        )}
      </div>
      <div className={s.thread}>
        <Thread label={chat.title}>
          <ThreadShellProvider value={{}}>
            <ThreadBlocks
              blocks={blocks}
              threadId={`chat-${chat.id}`}
              session={{ agentId: 'claude-code', model: 'sonnet', account: null }}
            />
          </ThreadShellProvider>
        </Thread>
      </div>
      <div className={s.composer}>
        <Composer
          value={value}
          onChange={setValue}
          placeholder="Reply"
          onSubmit={(text) => {
            setValue('')
            setSaid((was) => [...was, items.you(text)])
          }}
        />
      </div>
    </div>
  )
}
