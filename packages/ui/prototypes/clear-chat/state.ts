// Scrappy: what the page holds: the direction shown, and for each, the conversation as its page, brief or focus has it.
import { useSyncExternalStore } from 'react'

import { items } from '../../../../apps/desktop/tests/fixtures'
import { BRIEF, briefReply, type BriefLine, conversation, PAGE_OPENING, REPLY, stillOpen } from './data'
import type { SessionSummary, ThreadItem } from './deps'

export type Direction = 'A' | 'B' | 'C' | 'Today'

/** The directions in the switcher's order, each with its key: 1 to 4. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }> = [
  {
    value: 'A',
    name: 'Pages',
    about: 'A new page opens with the coordinator’s handover; earlier pages stay in the thread, folded',
  },
  {
    value: 'B',
    name: 'What it knows',
    about: 'The thread is disposable; a brief you can read and edit holds what the coordinator knows',
  },
  { value: 'C', name: 'Focus', about: 'Hide what’s settled and older talk; the last exchange and what’s open stay' },
  { value: 'Today', name: 'Today', about: 'The conversation as built: nothing clears it' },
]

/** What the coordinator holds: its session as it was, a page's handover, a brief, or nothing. */
export type Memory = 'kept' | 'summary' | 'brief' | 'fresh'

/** Where a page or a chat began and ended, by sequence and time. */
export interface Bound {
  readonly start: number
  readonly began: string | null
  readonly ended: string | null
}

export interface Talk {
  /** Everything the thread holds, oldest first. */
  readonly items: ReadonlyArray<ThreadItem>
  /** A: the pages closed, oldest first; the current page is the one begun after the last. */
  readonly pages: ReadonlyArray<Bound>
  /** A: where the current page begins, by sequence; null before the first new page. */
  readonly pageStart: number | null
  /** A: the earlier pages are shown above the current one. */
  readonly pageOpen: boolean
  /** B: the chats closed, oldest first; what comes after the last boundary is the current chat. */
  readonly chats: ReadonlyArray<Bound>
  /** B: where the current chat begins, by sequence; null before the first new chat. */
  readonly chatStart: number | null
  /** B: the earlier chat open in place of the current one, by its place in `chats`. */
  readonly viewingChat: number | null
  /** B: what it knows, as the person can read and edit it. */
  readonly brief: ReadonlyArray<BriefLine>
  /** C: what is settled and older talk is hidden. */
  readonly focused: boolean
  /** The conversation was forgotten: what is still open stays. */
  readonly wiped: boolean
  readonly memory: Memory
  /** How full the coordinator's context is, in tokens; null with no session yet. */
  readonly context: number | null
  /** The coordinator is answering. */
  readonly answering: boolean
  /** Something was said since the current page or chat began. */
  readonly saidSince: boolean
  /** B: when the conversation was forgotten. */
  readonly forgotten: string | null
  /** A: what it was before the last new page, for undo. */
  readonly before: Talk | null
}

const fresh = (): Talk => {
  const all = conversation()
  return {
    items: all,
    pages: [],
    pageStart: null,
    pageOpen: false,
    chats: [],
    chatStart: null,
    viewingChat: null,
    brief: BRIEF.map((line) => ({ ...line })),
    focused: false,
    wiped: false,
    memory: 'kept',
    context: 96_000,
    answering: false,
    saidSince: false,
    forgotten: null,
    before: null,
  }
}

export interface Proto {
  readonly direction: Direction
  /** No strip under the window: for screenshots. */
  readonly bare: boolean
  readonly talks: Readonly<Record<Direction, Talk>>
}

let state: Proto = {
  direction: 'A',
  bare: false,
  talks: { A: fresh(), B: fresh(), C: fresh(), Today: fresh() },
}
const listeners = new Set<() => void>()

const set = (next: Partial<Proto>) => {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** Changes the conversation of the direction shown. */
const change = (edit: (talk: Talk) => Talk) => {
  const direction = state.direction
  set({ talks: { ...state.talks, [direction]: edit(state.talks[direction]) } })
}

const lastSequence = (talk: Talk) => talk.items.at(-1)?.sequence ?? 0

/** An item said now, rather than when the fixtures say. */
const now = (item: ThreadItem): ThreadItem => ({ ...item, createdAt: new Date().toISOString() })

const within = (talk: Talk, from: number, to: number) => talk.items.filter((item) => item.sequence >= from && item.sequence < to)

/** The box the conversation scrolls in, whichever frame the app puts it in. */
const threadBox = (): HTMLElement | null => {
  const thread = document.querySelector('section[aria-label="Conversation"]')
  for (let box = thread?.parentElement ?? null; box !== null; box = box.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(box).overflowY)) return box
  return null
}

/** After something was said, the thread goes to it, even where a clear had left the view at the top. */
export const scrollThreadToEnd = () =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = threadBox()
      if (box !== null) box.scrollTop = box.scrollHeight
    }),
  )

/** An earlier page or chat opens at its own beginning. */
export const scrollThreadToTop = () =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = threadBox()
      if (box !== null) box.scrollTop = 0
    }),
  )

/** When a page or a chat ran, by its own items. */
const boundOf = (talk: Talk, from: number, to: number): Bound => {
  const own = within(talk, from, to)
  return { start: from, began: own[0]?.createdAt ?? null, ended: own.at(-1)?.createdAt ?? null }
}

/** What the person said on the page or in the chat shown: nothing to start one from, otherwise. */
export const saidOnPage = (talk: Talk) => talk.items.some((item) => item.kind === 'user_message' && item.sequence >= (talk.pageStart ?? 0))
export const saidInChat = (talk: Talk) =>
  talk.items.some((item) => item.kind === 'user_message' && item.sequence > (talk.chatStart ?? Number.NEGATIVE_INFINITY))

/** What the coordinator answers, from what it remembers. */
const answerFor = (talk: Talk): string =>
  talk.wiped ? REPLY.fresh : talk.memory === 'brief' ? briefReply(talk.brief) : REPLY[talk.memory === 'summary' ? 'summary' : 'kept']

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Back to the conversation as it was this morning, in the direction shown. */
  startOver: () => change(() => fresh()),

  /** A: the current page closes into the ones above, and a fresh session opens with what it carries over. */
  newPage: () =>
    change((talk) => {
      if (!saidOnPage(talk)) return talk
      const from = talk.pageStart ?? talk.items[0]!.sequence
      const handover = now(items.says(PAGE_OPENING, 'claude-code', `page-${talk.pages.length + 2}`))
      return {
        ...talk,
        items: [...talk.items, handover],
        pages: [...talk.pages, boundOf(talk, from, handover.sequence)],
        pageStart: handover.sequence,
        pageOpen: false,
        saidSince: false,
        memory: 'summary',
        context: 12_000,
        before: talk,
      }
    }),

  /** A: the new page goes, and the session that was before it comes back, until something is said on it. */
  undoPage: () => change((talk) => (talk.before === null || talk.saidSince ? talk : { ...talk.before, before: null })),

  /** A: the earlier pages are shown above the current one, or put away again. */
  showPages: (open: boolean) => change((talk) => ({ ...talk, pageOpen: open })),

  /** B: the thread starts empty; the brief and the earlier chat stay, and a fresh session is briefed from the brief. */
  newChat: () =>
    change((talk) => {
      if (!saidInChat(talk)) return talk
      const from =
        talk.chatStart === null
          ? talk.items[0]!.sequence
          : (talk.items.find((item) => item.sequence > talk.chatStart!)?.sequence ?? talk.chatStart + 1)
      const end = lastSequence(talk)
      return {
        ...talk,
        chats: [...talk.chats, boundOf(talk, from, end + 1)],
        chatStart: end,
        viewingChat: null,
        saidSince: false,
        memory: 'brief',
        context: 12_000,
      }
    }),

  /** B: an earlier chat open in place of the current one. */
  viewChat: (index: number | null) => change((talk) => ({ ...talk, viewingChat: index })),

  /** B: one thing the brief holds is forgotten. */
  forgetLine: (id: string) => change((talk) => ({ ...talk, brief: talk.brief.filter((line) => line.id !== id) })),

  /** C: what is settled and older talk is hidden, or shown again. */
  toggleFocus: () => change((talk) => ({ ...talk, focused: !talk.focused })),

  /** What the person says: it goes in the thread, and the coordinator answers from what it remembers. */
  say: (body: string) => {
    const direction = state.direction
    change((talk) => ({
      ...talk,
      items: [...talk.items, now(items.you(body))],
      saidSince: true,
      viewingChat: null,
      answering: true,
      context: talk.context ?? 14_000,
      before: null,
    }))
    scrollThreadToEnd()
    window.setTimeout(() => {
      const talk = state.talks[direction]
      set({
        talks: {
          ...state.talks,
          [direction]: {
            ...talk,
            items: [...talk.items, now(items.says(answerFor(talk)))],
            answering: false,
            context: (talk.context ?? 14_000) + 1_800,
          },
        },
      })
      scrollThreadToEnd()
    }, 1_600)
  },

  /** The conversation and everything the coordinator learned from it go; what is still open stays. */
  forget: () =>
    change((talk) => ({
      ...talk,
      items: talk.items.filter(stillOpen),
      pages: [],
      pageStart: null,
      pageOpen: false,
      chats: [],
      chatStart: null,
      viewingChat: null,
      brief: [],
      focused: false,
      wiped: true,
      memory: 'fresh',
      context: null,
      answering: false,
      saidSince: false,
      forgotten: new Date().toISOString(),
      before: null,
    })),
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

export interface Shown {
  /** What shows above the divider: before the page, chat or focus shown. */
  readonly earlier: ReadonlyArray<ThreadItem>
  /** What the thread holds now. */
  readonly current: ReadonlyArray<ThreadItem>
  /** Whether there is a divider at all, and so whether the blocks are split. */
  readonly divided: boolean
  /** C: what focus hides. */
  readonly hidden: ReadonlyArray<ThreadItem>
}

const EMPTY: ReadonlyArray<ThreadItem> = []

/** What the thread shows of the conversation, in the direction shown: what is still open is carried into the whole of it. */
export const shownOf = (direction: Direction, talk: Talk): Shown => {
  if (talk.wiped) return { earlier: EMPTY, current: talk.items.filter(stillOpen), divided: true, hidden: EMPTY }

  if (direction === 'A') {
    if (talk.pageStart === null) return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }
    const carried = talk.items.filter((item) => item.sequence < talk.pageStart! && stillOpen(item))
    const own = talk.items.filter((item) => item.sequence >= talk.pageStart!)
    const earlier = talk.pageOpen ? talk.items.filter((item) => item.sequence < talk.pageStart! && !stillOpen(item)) : EMPTY
    // The page opens with the coordinator's word, then what is still open, then what is said on it.
    const opening = own.slice(0, 1)
    return { earlier, current: [...opening, ...carried, ...own.slice(1)], divided: true, hidden: EMPTY }
  }

  if (direction === 'B') {
    if (talk.viewingChat !== null) {
      const one = talk.chats[talk.viewingChat]
      if (one === undefined) return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }
      const end = talk.chats[talk.viewingChat + 1]?.start ?? (talk.chatStart ?? Number.POSITIVE_INFINITY) + 1
      const current = talk.items.filter((item) => item.sequence >= one.start && item.sequence < end)
      return { earlier: EMPTY, current, divided: true, hidden: EMPTY }
    }
    if (talk.chatStart === null) return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }
    const carried = talk.items.filter((item) => item.sequence <= talk.chatStart! && stillOpen(item))
    const after = talk.items.filter((item) => item.sequence > talk.chatStart!)
    return { earlier: EMPTY, current: [...carried, ...after], divided: talk.chats.length > 0, hidden: EMPTY }
  }

  if (direction === 'C') {
    if (!talk.focused) return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }
    const last = [...talk.items].reverse().find((item) => item.kind === 'user_message')?.sequence ?? Number.POSITIVE_INFINITY
    const carried = talk.items.filter((item) => item.sequence < last && stillOpen(item))
    const own = talk.items.filter((item) => item.sequence >= last)
    const current = [...carried, ...own]
    const shown = new Set(current.map((item) => item.id))
    const hidden = talk.items.filter((item) => !shown.has(item.id))
    return { earlier: EMPTY, current, divided: hidden.length > 0, hidden }
  }

  return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }
}

/** The coordinator's session as the composer shows it: none until a fresh one starts, else how full its context is. */
export const sessionOf = (talk: Talk): SessionSummary | null =>
  talk.context === null
    ? null
    : {
        id: `ses-${talk.memory}`,
        agentId: 'claude-code',
        agentName: 'Claude Code',
        state: 'running',
        model: 'claude-opus-5-5',
        account: null,
        effort: 'high',
        models: ['claude-opus-5-5'],
        turnRunning: talk.answering,
        turnStartedAt: talk.answering ? new Date().toISOString() : null,
        turnEndedAt: talk.answering ? null : new Date(Date.now() - 5 * 60_000).toISOString(),
        held: true,
        context: { used: talk.context, size: 200_000 },
        background: [],
      }

/** How many messages a part of the thread holds, apart from the cards that stand for work. */
export const messagesIn = (part: ReadonlyArray<ThreadItem>) =>
  part.filter((item) => item.kind !== 'task' && item.kind !== 'issue_draft' && item.kind !== 'issue_changes').length
