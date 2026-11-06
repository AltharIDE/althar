// Scrappy: what the page holds: the direction shown, and for each, the conversation as it was cleared, forgotten or begun again.
import { useSyncExternalStore } from 'react'

import { items } from '../../../../apps/desktop/tests/fixtures'
import { conversation, REPLY, stillOpen, SUMMARY } from './data'
import type { SessionSummary, ThreadItem } from './deps'

export type Direction = 'A' | 'B' | 'C' | 'Today'

/** The directions in the switcher's order, each with its key: 1 to 4. */
export const DIRECTIONS: ReadonlyArray<{ readonly value: Direction; readonly name: string; readonly about: string }> = [
  {
    value: 'A',
    name: 'One clear, two kinds',
    about: 'Clear the conversation from ⋯: a confirm asks whether the coordinator forgets it too',
  },
  { value: 'B', name: 'Light clear', about: 'Clear at once, undo from the divider; forgetting is in Settings › Notes' },
  { value: 'C', name: 'New conversation', about: 'Start a new one carrying a summary; earlier ones kept to read, or deleted to forget' },
  { value: 'Today', name: 'Today', about: 'The conversation as built: nothing clears it' },
]

/** What the coordinator holds of the conversation: its session as it was, a summary in a fresh one, or nothing. */
export type Memory = 'kept' | 'summary' | 'fresh'

export interface Talk {
  /** Everything the thread holds, oldest first. */
  readonly items: ReadonlyArray<ThreadItem>
  /** A and B: where the view was cleared, by sequence, and whether what came before is shown above the divider. */
  readonly cleared: { readonly at: number; readonly open: boolean } | null
  /** A and B: the conversation was forgotten: what came before is gone, but for what is still open. */
  readonly wiped: boolean
  /** Something was said since the last clear: B's Undo and C's way back go. */
  readonly saidSince: boolean
  /** A: the undo at the composer's edge, until it goes. */
  readonly undo: { readonly kind: 'view' | 'wipe'; readonly until: number } | null
  /** C: where each conversation starts, by sequence, oldest first; the last is the current one. */
  readonly starts: ReadonlyArray<number>
  /** C: the earlier conversation open in place of the current one, by its place in `starts`. */
  readonly viewing: number | null
  /** C: conversations deleted, by their place in `starts`. */
  readonly deleted: ReadonlyArray<number>
  readonly memory: Memory
  /** How full the coordinator's context is, in tokens; null with no session yet. */
  readonly context: number | null
  /** The coordinator is answering. */
  readonly answering: boolean
  /** B: when the conversation was forgotten, from its settings. */
  readonly forgotten: string | null
  /** What it was before the last change, for undo. */
  readonly before: Talk | null
}

const fresh = (): Talk => {
  const all = conversation()
  return {
    items: all,
    cleared: null,
    wiped: false,
    saidSince: false,
    undo: null,
    starts: [all[0]!.sequence],
    viewing: null,
    deleted: [],
    memory: 'kept',
    context: 96_000,
    answering: false,
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

/** How long A's undo stays at the composer's edge. */
const UNDO_FOR = 10_000

export const proto = {
  get: () => state,
  set,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Back to the conversation as it was this morning, in the direction shown. */
  startOver: () => change(() => fresh()),

  /** A and B: what is on screen starts empty; the coordinator keeps its session. */
  clearView: (undoable: boolean) =>
    change((talk) => ({
      ...talk,
      cleared: { at: lastSequence(talk), open: false },
      saidSince: false,
      undo: undoable ? { kind: 'view', until: Date.now() + UNDO_FOR } : null,
      before: talk,
    })),

  /** A and B: what came before the clear, shown above the divider or put away again. */
  showEarlier: (open: boolean) => change((talk) => (talk.cleared === null ? talk : { ...talk, cleared: { ...talk.cleared, open } })),

  /** A and B: the conversation and the coordinator's session go; what is still open stays. */
  forget: (undoable: boolean) =>
    change((talk) => ({
      ...talk,
      items: talk.items.filter(stillOpen),
      cleared: null,
      wiped: true,
      saidSince: false,
      undo: undoable ? { kind: 'wipe', until: Date.now() + UNDO_FOR } : null,
      memory: 'fresh',
      context: null,
      forgotten: new Date().toISOString(),
      before: talk,
    })),

  /** Puts back what the last clear or forgetting took. */
  undo: () => change((talk) => (talk.before === null ? talk : { ...talk.before, undo: null })),

  /** A's undo goes, once its time is up: the runtime forgets then, or keeps the clear. */
  expire: () => change((talk) => (talk.undo === null ? talk : { ...talk, undo: null, before: null })),

  /** C: a new conversation, the coordinator's summary of the last its first word, in a fresh session. */
  newConversation: () =>
    change((talk) => {
      const summary = { ...now(items.says(SUMMARY)), id: `summary-${talk.starts.length}` }
      return {
        ...talk,
        items: [...talk.items, summary],
        starts: [...talk.starts, summary.sequence],
        viewing: null,
        saidSince: false,
        memory: 'summary',
        context: 11_000,
        before: talk,
      }
    }),

  /** C: an earlier conversation open in place of the current one, or the current one again. */
  view: (index: number | null) => change((talk) => ({ ...talk, viewing: index })),

  /** C: an earlier conversation gone, and the summary carried from it; a current one it was carried into starts afresh. */
  deleteConversation: (index: number) =>
    change((talk) => {
      const from = talk.starts[index]!
      const to = talk.starts[index + 1] ?? Number.POSITIVE_INFINITY
      const current = index + 1 === talk.starts.length - 1
      return {
        ...talk,
        items: talk.items.filter(
          (item) => stillOpen(item) || ((item.sequence < from || item.sequence >= to) && item.id !== `summary-${index + 1}`),
        ),
        deleted: [...talk.deleted, index],
        viewing: null,
        ...(current ? { memory: 'fresh' as const, context: null } : {}),
        before: null,
      }
    }),

  /** What the person says: it goes in the thread, and the coordinator answers from what it remembers. */
  say: (body: string) => {
    const direction = state.direction
    change((talk) => ({
      ...talk,
      items: [...talk.items, now(items.you(body))],
      saidSince: true,
      undo: null,
      viewing: null,
      answering: true,
      context: talk.context ?? 14_000,
      before: null,
    }))
    window.setTimeout(() => {
      const talk = state.talks[direction]
      set({
        talks: {
          ...state.talks,
          [direction]: {
            ...talk,
            items: [...talk.items, now(items.says(REPLY[talk.memory]))],
            answering: false,
            context: (talk.context ?? 14_000) + 1_800,
          },
        },
      })
    }, 1_600)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

/** C: the conversations, by where each starts, but for those deleted: when it began, and what was first said in it. */
export const conversationsOf = (talk: Talk) =>
  talk.starts.flatMap((start, index) => {
    if (talk.deleted.includes(index)) return []
    const end = talk.starts[index + 1] ?? Number.POSITIVE_INFINITY
    const own = talk.items.filter((item) => item.sequence >= start && item.sequence < end)
    const first = own.find((item) => item.kind === 'user_message')
    return [
      {
        index,
        current: index === talk.starts.length - 1,
        began: own[0]?.createdAt ?? null,
        ended: own.at(-1)?.createdAt ?? null,
        first: first?.kind === 'user_message' ? first.content.text : null,
      },
    ]
  })

export interface Shown {
  /** What shows above the divider: before the clear, where it is shown. */
  readonly earlier: ReadonlyArray<ThreadItem>
  /** What the thread holds now. */
  readonly current: ReadonlyArray<ThreadItem>
  /** Whether there is a divider at all, and so whether the blocks are split. */
  readonly divided: boolean
}

/** What the thread shows of the conversation, in the direction shown: what is still open always in the current part, at its start. */
export const shownOf = (direction: Direction, talk: Talk): Shown => {
  if (direction === 'C') {
    if (talk.viewing !== null) {
      const from = talk.starts[talk.viewing]!
      const to = talk.starts[talk.viewing + 1] ?? Number.POSITIVE_INFINITY
      return { earlier: [], current: talk.items.filter((item) => item.sequence >= from && item.sequence < to), divided: true }
    }
    const from = talk.starts.at(-1)!
    if (talk.starts.length === 1) return { earlier: [], current: talk.items, divided: false }
    const carried = talk.items.filter((item) => item.sequence < from && stillOpen(item))
    const now = talk.items.filter((item) => item.sequence >= from)
    const summary = now.filter((item) => item.id.startsWith('summary-'))
    // The coordinator's summary first, then what is still open, then what was said since.
    return { earlier: [], current: [...summary, ...carried, ...now.filter((item) => !summary.includes(item))], divided: true }
  }
  if (talk.wiped) return { earlier: [], current: talk.items, divided: true }
  if (talk.cleared === null) return { earlier: [], current: talk.items, divided: false }
  const at = talk.cleared.at
  const before = talk.items.filter((item) => item.sequence <= at && !stillOpen(item))
  const carried = talk.items.filter((item) => item.sequence <= at && stillOpen(item))
  const after = talk.items.filter((item) => item.sequence > at)
  return { earlier: talk.cleared.open ? before : [], current: [...carried, ...after], divided: true }
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
