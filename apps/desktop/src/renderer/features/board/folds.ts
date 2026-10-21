import { useSyncExternalStore } from 'react'

import { BoardLane, type BoardFolds, NO_FOLDS } from '@althar/ui'

/*
 * Which of the board's lanes the person collapsed, and which they opened
 * from a rail, kept by this window across launches, for every project alike:
 * collapsing is about the room on the screen and the person's habit, not about
 * a project, so switching tabs doesn't bring a lane back. The board on its own
 * and the board beside the conversation keep theirs apart: the narrow one is
 * where lanes collapse. Lanes that don't fit collapse by themselves (the kit's
 * board); these are only what the person chose.
 */

/** Where the board is: on its own, or beside the conversation. */
export type BoardPlace = 'alone' | 'beside'

type Kept = Readonly<Record<BoardPlace, BoardFolds>>

const STORED = 'althar.lanes'
const NONE: Kept = { alone: NO_FOLDS, beside: NO_FOLDS }
const LANES: ReadonlyArray<string> = Object.values(BoardLane)
const listeners = new Set<() => void>()
let last: { readonly raw: string | null; readonly kept: Kept } = { raw: null, kept: NONE }

/** The lanes a stored list names, and nothing else it holds. */
const lanesOf = (value: unknown): ReadonlyArray<BoardLane> =>
  Array.isArray(value) ? value.filter((lane): lane is BoardLane => typeof lane === 'string' && LANES.includes(lane)) : []

const foldsOf = (value: unknown): BoardFolds => {
  if (typeof value !== 'object' || value === null) return NO_FOLDS
  const { collapsed, opened } = value as { collapsed?: unknown; opened?: unknown }
  return { collapsed: lanesOf(collapsed), opened: lanesOf(opened) }
}

/** What storage holds, read again only when it changed. Storage that can't be read keeps nothing. */
const read = (): Kept => {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORED)
  } catch {
    return last.kept
  }
  if (raw === last.raw) return last.kept
  let kept = NONE
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const { alone, beside } = parsed as { alone?: unknown; beside?: unknown }
      kept = { alone: foldsOf(alone), beside: foldsOf(beside) }
    }
  } catch {
    kept = NONE
  }
  last = { raw, kept }
  return kept
}

const write = (kept: Kept) => {
  let raw: string | null = JSON.stringify(kept)
  try {
    window.localStorage.setItem(STORED, raw)
  } catch {
    // Kept for this window only: what storage still holds reads as this choice, until storage changes.
    try {
      raw = window.localStorage.getItem(STORED)
    } catch {
      // Storage can't be read either, so `read` keeps `last` anyway.
    }
  }
  last = { raw, kept }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The lanes the person collapsed and opened on the board where it is, and how to keep what they choose next. */
export const useFolds = (place: BoardPlace): readonly [BoardFolds, (folds: BoardFolds) => void] => {
  const kept = useSyncExternalStore(subscribe, read)
  return [kept[place], (folds: BoardFolds) => write({ ...read(), [place]: folds })]
}
