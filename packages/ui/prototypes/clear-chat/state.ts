// Scrappy: what the page holds: the direction shown, and the conversation as each placement has cleared it.
import { useSyncExternalStore } from 'react'

import { items } from '../../../../apps/desktop/tests/fixtures'
import { conversation, REPLY, stillOpen } from './data'
import type { SessionSummary, ThreadItem } from './deps'

export type Direction = 'A' | 'B' | 'C' | 'Today'

/** The directions in the switcher's order, each with its key: 1 to 4. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }> = [
  { value: 'A', name: 'Composer', about: 'Clear sits in the composer, beside the model; /clear does it from the field' },
  { value: 'B', name: 'Thread head', about: 'A conversation bar above the thread holds Clear, beside what it clears' },
  { value: 'C', name: 'Session ring', about: 'Clear chat… sits in the ring’s foot, beside Compact, and asks before it ends the session' },
  { value: 'Today', name: 'Today', about: 'The conversation as built: nothing clears it' },
]

/** What the coordinator holds after a clear: the same session, or a fresh one. */
export type Memory = 'kept' | 'fresh'

export interface Talk {
  /** Everything the thread holds, oldest first; a wipe leaves only what is still open. */
  readonly items: ReadonlyArray<ThreadItem>
  /** Where the cleared view begins, by sequence; null until the view is cleared. */
  readonly mark: number | null
  /** The conversation before the mark is open above the divider. */
  readonly earlierOpen: boolean
  /** The conversation and what the coordinator learned from it are gone. */
  readonly wiped: boolean
  readonly memory: Memory
  /** How full the coordinator's context is, in tokens; null with no session. */
  readonly context: number | null
  /** The coordinator is answering. */
  readonly answering: boolean
  /** What the view was before the last clear, for Undo. */
  readonly before: { readonly mark: number | null; readonly earlierOpen: boolean } | null
}

const fresh = (): Talk => ({
  items: conversation(),
  mark: null,
  earlierOpen: false,
  wiped: false,
  memory: 'kept',
  context: 96_000,
  answering: false,
  before: null,
})

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

/** A clear puts the view at the top, where its divider is; so does opening or closing the earlier conversation. */
export const scrollThreadToTop = () =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = threadBox()
      if (box !== null) box.scrollTop = 0
    }),
  )

/** Whether the coordinator holds any conversation at all: open work alone isn't one, so a wipe leaves nothing to clear. */
export const hasConversation = (talk: Talk): boolean => talk.items.some((item) => !stillOpen(item))

/** Whether the view shown has anything to clear: open work stays, and the earlier view is read, not cleared. */
export const canClearView = (talk: Talk): boolean =>
  !talk.earlierOpen && talk.items.some((item) => item.sequence >= (talk.mark ?? Number.NEGATIVE_INFINITY) && !stillOpen(item))

/** What the coordinator answers, from what it remembers. */
const answerFor = (talk: Talk): string => (talk.memory === 'fresh' ? REPLY.fresh : REPLY.kept)

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Back to the conversation as it was this morning, in the direction shown. */
  startOver: () => {
    change(() => fresh())
    scrollThreadToEnd()
  },

  /** The view starts empty; the same session goes on, so the coordinator still knows the conversation. */
  clearView: () => {
    if (!canClearView(state.talks[state.direction])) return
    change((talk) => ({
      ...talk,
      mark: lastSequence(talk) + 1,
      earlierOpen: false,
      before: { mark: talk.mark, earlierOpen: talk.earlierOpen },
    }))
    scrollThreadToTop()
  },

  /** The clear is taken back: the whole conversation shows again. */
  undoClear: () => {
    change((talk) =>
      talk.before === null ? talk : { ...talk, mark: talk.before.mark, earlierOpen: talk.before.earlierOpen, before: null },
    )
    scrollThreadToEnd()
  },

  /** The conversation before the clear is read above the divider, or put away again. */
  showEarlier: (open: boolean) => {
    change((talk) => ({ ...talk, earlierOpen: open }))
    scrollThreadToTop()
  },

  /** What the person says: it goes in the thread, and the coordinator answers from what it remembers. */
  say: (body: string) => {
    const direction = state.direction
    change((talk) => ({
      ...talk,
      items: [...talk.items, now(items.you(body))],
      answering: true,
      // A wiped coordinator starts a session with this turn; the fresh line belongs to the empty view before it.
      wiped: false,
      context: talk.context ?? 14_000,
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
  forget: () => {
    change((talk) => ({
      ...talk,
      items: talk.items.filter(stillOpen),
      mark: null,
      earlierOpen: false,
      wiped: true,
      memory: 'fresh',
      context: null,
      answering: false,
      before: null,
    }))
    scrollThreadToTop()
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

export interface Shown {
  /** What shows above the divider: the conversation before the clear. */
  readonly earlier: ReadonlyArray<ThreadItem>
  /** What the thread holds now: what is still open, then what came after the clear. */
  readonly current: ReadonlyArray<ThreadItem>
  /** Whether there is a divider at all, and so whether the blocks are split. */
  readonly divided: boolean
  /** What the clear took out of the view. */
  readonly hidden: ReadonlyArray<ThreadItem>
}

const EMPTY: ReadonlyArray<ThreadItem> = []

/** What the thread shows of the conversation, in the direction shown: what is still open is carried into the whole of it. */
export const shownOf = (direction: Direction, talk: Talk): Shown => {
  if (talk.wiped) return { earlier: EMPTY, current: talk.items, divided: true, hidden: EMPTY }
  if (direction === 'Today' || talk.mark === null) return { earlier: EMPTY, current: talk.items, divided: false, hidden: EMPTY }

  const before = talk.items.filter((item) => item.sequence < talk.mark!)
  const after = talk.items.filter((item) => item.sequence >= talk.mark!)
  const carried = before.filter(stillOpen)
  const hidden = before.filter((item) => !stillOpen(item))
  // The earlier conversation is read in the thread's place, the divider at the top saying how to come back.
  if (talk.earlierOpen) return { earlier: EMPTY, current: hidden, divided: hidden.length > 0, hidden }
  return {
    earlier: EMPTY,
    current: [...carried, ...after],
    divided: hidden.length > 0,
    hidden,
  }
}

/** The coordinator's session as the composer shows it: none after a wipe, else how full its context is. */
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
