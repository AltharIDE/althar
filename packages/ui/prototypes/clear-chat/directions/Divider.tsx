// Scrappy: what each direction draws where its page, chat or focus begins, and at the top of a conversation begun again.
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { ThreadDivider } from '../../../src/thread/Furniture/Furniture'
import { messagesIn, proto, scrollThreadToTop, shownOf, type Direction, type Talk } from '../state'

export const dividerText = {
  page: (n: number, at: string) => `Page ${n} · ${at}`,
  readPage: (n: number) => `Read page ${n}`,
  readEarlier: 'Read earlier',
  hideEarlier: 'Hide earlier',
  undo: 'Undo',
  chat: (messages: number) => `Earlier chat · ${messages} messages`,
  chats: (n: number, messages: number) => `${n} earlier chats · ${messages} in the last`,
  read: 'Read',
  readLast: 'Read the last',
  back: 'Back to now',
  hidden: (what: string) => `${what} hidden`,
  showAll: 'Show all',
  fresh: 'Started fresh',
  messages: (n: number) => `${n} ${n === 1 ? 'message' : 'messages'}`,
  task: (n: number) => `${n} finished ${n === 1 ? 'task' : 'tasks'}`,
  issue: (n: number) => `${n} filed ${n === 1 ? 'issue' : 'issues'}`,
}
const t = dividerText

const clock = (iso: string | null) =>
  iso === null ? '' : new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** When a page or chat ran, as its divider says it: from its first word to its last. */
export const span = (began: string | null, ended: string | null) => `${clock(began)}–${clock(ended)}`

/** The divider where it first appears, at the top of the thread's view: what came before is above it, what stays below. */
export function Divider({ direction, talk }: { direction: Direction; talk: Talk }) {
  // C keeps the thread where it was: the last exchange stays in view, and the header's Show all is the way back.
  if (direction === 'C' && !talk.wiped) return <Line direction={direction} talk={talk} />
  const key =
    direction === 'A'
      ? `a-${talk.pageStart}-${talk.pageOpen}`
      : direction === 'B'
        ? `b-${talk.chatStart}-${talk.viewingChat}`
        : `c-${talk.focused}-${talk.wiped}`
  const top = direction === 'A' ? talk.pageOpen : direction === 'B' ? talk.viewingChat !== null : false
  return (
    <AtTop key={key} top={top}>
      <Line direction={direction} talk={talk} />
    </AtTop>
  )
}

function AtTop({ children, top = false }: { children: ReactNode; top?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // Once the thread has followed its end, as it does when what it holds changes.
    const timer = window.setTimeout(() => {
      if (top) scrollThreadToTop()
      else box.current?.scrollIntoView({ block: 'start' })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [top])
  return <div ref={box}>{children}</div>
}

function Line({ direction, talk }: { direction: Direction; talk: Talk }) {
  if (talk.wiped) return <ThreadDivider icon="plus">{t.fresh}</ThreadDivider>
  if (direction === 'A') return <PageLine talk={talk} />
  if (direction === 'B') return <ChatLine talk={talk} />
  if (direction === 'C') return <FocusLine talk={talk} />
  return null
}

/** A: the page that begins here, and the pages above it, shown or put away; a new page can go back until it is written on. */
function PageLine({ talk }: { talk: Talk }) {
  if (talk.pageStart === null) return null
  const current = talk.pages.length + 1
  const last = talk.pages.at(-1)
  const when = talk.items.find((item) => item.sequence === talk.pageStart)?.createdAt ?? null
  const words = (
    <>
      {t.page(current, clock(when))}
      {talk.before !== null && !talk.saidSince && (
        <>
          {' · '}
          <LinkButton onClick={proto.undoPage}>{t.undo}</LinkButton>
        </>
      )}
    </>
  )
  if (last === undefined) return <ThreadDivider icon="create">{words}</ThreadDivider>
  const action = talk.pageOpen ? t.hideEarlier : talk.pages.length === 1 ? t.readPage(talk.pages.length) : t.readEarlier
  return (
    <ThreadDivider icon="create" action={action} onAction={() => proto.showPages(!talk.pageOpen)}>
      {words}
    </ThreadDivider>
  )
}

/** B: the chat before this one, always readable; reading one takes the thread until it is put back. */
function ChatLine({ talk }: { talk: Talk }) {
  if (talk.viewingChat !== null) {
    const one = talk.chats[talk.viewingChat]
    return (
      <ThreadDivider icon="clock" action={t.back} onAction={() => proto.viewChat(null)}>
        Earlier chat · {span(one?.began ?? null, one?.ended ?? null)}
      </ThreadDivider>
    )
  }
  const last = talk.chats.at(-1)
  if (last === undefined) return null
  const end = talk.chatStart ?? Number.POSITIVE_INFINITY
  const count = messagesIn(talk.items.filter((item) => item.sequence >= last.start && item.sequence <= end))
  return (
    <ThreadDivider
      icon="clock"
      action={talk.chats.length === 1 ? t.read : t.readLast}
      onAction={() => proto.viewChat(talk.chats.length - 1)}
    >
      {talk.chats.length === 1 ? t.chat(count) : t.chats(talk.chats.length, count)}
    </ThreadDivider>
  )
}

/** C: what focus hides, and the way to see it again; nothing is deleted, so the line is the undo. */
function FocusLine({ talk }: { talk: Talk }) {
  const hidden = shownOf('C', talk).hidden
  if (hidden.length === 0) return null
  const messages = messagesIn(hidden)
  const tasks = hidden.filter((item) => item.kind === 'task').length
  const issues = hidden.filter((item) => item.kind === 'issue_draft' || item.kind === 'issue_changes').length
  const what = [messages > 0 ? t.messages(messages) : null, tasks > 0 ? t.task(tasks) : null, issues > 0 ? t.issue(issues) : null]
    .filter((one): one is string => one !== null)
    .join(' · ')
  return (
    <ThreadDivider icon="compress" action={t.showAll} onAction={proto.toggleFocus}>
      {t.hidden(what)}
    </ThreadDivider>
  )
}
