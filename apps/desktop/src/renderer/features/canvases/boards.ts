import { useCallback, useEffect, useRef, useState } from 'react'

import { type CanvasBoards, type CanvasCommentFacts, readBoards } from '@althar/contracts'

import type { CanvasGroundNews, CanvasPointed } from '../../../main/canvases/boards'
import type { GroundChange, GroundPin, GroundState } from '../../../overlay/ground'
import { useServices } from '../../data/services'
import type { GatheredComment } from '../../shared/comments'

/*
 * A canvas of boards in the window (ADR-104): its pages and boards, read from
 * its entry's words; how its ground shows them, which the window changes at
 * once and the ground confirms; the part the person pointed at; and the pins
 * of the comments made on parts of its boards.
 */

/** A canvas's pages and boards from its entry's words; null where they can't be read. Every file is taken as there: the runtime checked them as it published. */
export const boardsOfText = (words: string): CanvasBoards | null => {
  const read = readBoards(words, () => true)
  return read.ok ? read.boards : null
}

export const FIRST_STATE: GroundState = { view: 'every', page: 0, board: { page: 0, board: 0 }, zoom: 1, tool: 'point' }

/** How each canvas last showed, by its id: opened again, it shows the same. */
const kept = new Map<string, Omit<GroundState, 'zoom'>>()

/** A change shown at once, before the ground says so: what the ground will make of it. */
export const changedState = (state: GroundState, change: GroundChange, boards: CanvasBoards | null): GroundState => {
  let next = state
  if (change.tool !== undefined) next = { ...next, tool: change.tool }
  if (change.board !== undefined)
    next = { ...next, board: change.board, ...(next.page !== -1 && next.view === 'every' ? { page: change.board.page } : {}) }
  if (change.page !== undefined && change.page !== next.page) {
    next = {
      ...next,
      page: change.page,
      ...(change.page !== -1 && next.board.page !== change.page ? { board: { page: change.page, board: 0 } } : {}),
    }
  }
  if (change.view !== undefined) next = { ...next, view: change.view }
  if (change.step !== undefined && boards !== null) {
    const all = boards.pages.flatMap((page, p) => page.boards.map((_, b) => ({ page: p, board: b })))
    const here = all.findIndex((one) => one.page === next.board.page && one.board === next.board.board)
    const to = all[Math.min(all.length - 1, Math.max(0, here + change.step))]
    if (to !== undefined) next = { ...next, board: to, ...(next.page !== -1 ? { page: to.page } : {}) }
  }
  if (typeof change.zoom === 'number') next = { ...next, zoom: change.zoom }
  return next
}

/**
 * How a canvas of boards beside a thread shows, as its ground last said or
 * as the person just changed it; and the part pointed at, the pins and the
 * keys pressed in it, to their handlers.
 */
export const useGround = (
  threadId: string,
  canvasId: string,
  boards: CanvasBoards | null,
  on: {
    readonly pointed: (pointed: CanvasPointed) => void
    readonly pin: (n: number) => void
    readonly key: (key: 'escape' | 'older' | 'newer') => void
  },
) => {
  const views = useServices().host.canvases
  const [state, setState] = useState<GroundState>(() => ({ ...FIRST_STATE, ...kept.get(canvasId) }))
  const handlers = useRef(on)
  useEffect(() => {
    handlers.current = on
  })
  useEffect(
    () =>
      views?.onGround?.((key, news: CanvasGroundNews) => {
        if (key !== threadId) return
        switch (news.kind) {
          case 'state':
            kept.set(canvasId, { view: news.state.view, page: news.state.page, board: news.state.board, tool: news.state.tool })
            return setState(news.state)
          case 'pointed':
            return handlers.current.pointed(news.pointed)
          case 'pin':
            return handlers.current.pin(news.n)
          case 'key':
            return handlers.current.key(news.key)
        }
      }),
    [views, threadId, canvasId],
  )
  const change = useCallback(
    (asked: GroundChange) => {
      // Shown at once; the ground's word follows, and stands.
      setState((was) => changedState(was, asked, boards))
      views?.ground?.(threadId, asked)
    },
    [views, threadId, boards],
  )
  /** What the ground should show as it starts: how this canvas last showed. */
  const wanted = useCallback(() => kept.get(canvasId) ?? null, [canvasId])
  return { state, change, wanted }
}

/** A comment's place on a board, where it is on one. */
const onBoard = (anchor: CanvasCommentFacts['anchor']) =>
  anchor.kind === 'element' && anchor.board !== undefined && anchor.page !== undefined
    ? { page: anchor.page, board: anchor.board, selector: anchor.selector }
    : null

/**
 * The pins a canvas of boards shows: each comment sent on a part of a board,
 * numbered as its list numbers them, and then those waiting in the person's
 * message, after them.
 */
export const pinsOf = (
  sent: ReadonlyArray<{ readonly id: string; readonly anchor: CanvasCommentFacts['anchor']; readonly answered: boolean }>,
  drafts: ReadonlyArray<GatheredComment>,
  canvasId: string,
): { readonly pins: ReadonlyArray<GroundPin>; readonly numbers: ReadonlyMap<string, number> } => {
  const pins: Array<GroundPin> = []
  const numbers = new Map<string, number>()
  for (const one of sent) {
    const at = onBoard(one.anchor)
    if (at === null) continue
    const n = pins.length + 1
    numbers.set(one.id, n)
    pins.push({ n, ...at, answered: one.answered, draft: false })
  }
  for (const one of drafts) {
    if (one.on.kind !== 'canvas' || one.on.canvasId !== canvasId) continue
    const at = onBoard(one.on.anchor)
    if (at === null) continue
    const n = pins.length + 1
    numbers.set(one.id, n)
    pins.push({ n, ...at, answered: false, draft: true })
  }
  return { pins, numbers }
}
