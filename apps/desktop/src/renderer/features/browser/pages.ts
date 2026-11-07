import { useSyncExternalStore } from 'react'

import type { PageState } from '../../../main/browser/page'
import type { PagesHost } from '../../data/services'

/*
 * The pages beside the conversations, as this window shows them (ADR-099):
 * where each owner's page is (beside its conversation, or in a tab of its
 * own), and how each stands, as the main process last said. The page itself
 * is main's, and outlives where it shows: hidden from beside a conversation
 * for a document, or while another task is on screen, it is still there to
 * show again, where it was. Kept for the window's life.
 */

/** Where an owner's page shows: beside its conversation, or in a tab of its own. */
export type Where = 'beside' | 'tab'

/** The conversation a page came from, for its tab to go back beside, and the draft its comments go to. */
export type Origin =
  | { readonly kind: 'task'; readonly threadId: string; readonly draft: string }
  | { readonly kind: 'project'; readonly projectId: string; readonly draft: string }

const placed = new Map<string, Where>()
const origins = new Map<string, Origin>()
const states = new Map<string, PageState>()
/* A comment to open again on its page, by its owner, for the page's view to take once it shows. */
const reopening = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

const changed = () => {
  version += 1
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/* Main's word on every page, heard once a window, from the first that asks. */
let heard: PagesHost | null = null
const hear = (host: PagesHost | undefined) => {
  if (host === undefined || heard === host) return
  heard = host
  host.onState((state) => {
    states.set(state.owner, state)
    changed()
  })
}

export const pages = {
  where: (owner: string): Where | null => placed.get(owner) ?? null,
  state: (owner: string): PageState | null => states.get(owner) ?? null,
  /** Shows an owner's page beside its conversation, or in its tab, remembering the conversation it came from. */
  place: (owner: string, where: Where, origin?: Origin) => {
    if (origin !== undefined) origins.set(owner, origin)
    if (placed.get(owner) === where) return
    // A tab goes after the others: placed again, it moves to the end.
    placed.delete(owner)
    placed.set(owner, where)
    changed()
  },
  originOf: (owner: string): Origin | null => origins.get(owner) ?? null,
  /** Takes the page from where it shows; it is still there, to show again. */
  hide: (owner: string) => {
    if (!placed.delete(owner)) return
    changed()
  },
  /** Forgets an owner's page, once it is closed. */
  forget: (owner: string) => {
    placed.delete(owner)
    states.delete(owner)
    origins.delete(owner)
    reopening.delete(owner)
    changed()
  },
  known: (state: PageState) => {
    states.set(state.owner, state)
    changed()
  },
  /** Asks the owner's page to open a comment again on the page, as its chip was pressed. */
  reopen: (owner: string, commentId: string) => {
    reopening.set(owner, commentId)
    changed()
  },
  /** The comment waiting to be opened again on an owner's page, taken. */
  takeReopen: (owner: string): string | null => {
    const id = reopening.get(owner) ?? null
    if (id !== null) reopening.delete(owner)
    return id
  },
  reopenWaiting: (owner: string): string | null => reopening.get(owner) ?? null,
  /** The tabs' pages, in the order they were opened as tabs. */
  tabs: (): ReadonlyArray<string> => [...placed].flatMap(([owner, where]) => (where === 'tab' ? [owner] : [])),
}

/** Forgets every page: for tests. */
export const forgetPages = () => {
  placed.clear()
  origins.clear()
  states.clear()
  reopening.clear()
  heard = null
  changed()
}

/** Where an owner's page shows and how it stands, as they change; the window hears main's word on pages from here on. */
export const usePage = (owner: string | null, host: PagesHost | undefined) => {
  hear(host)
  useSyncExternalStore(subscribe, () => version)
  return {
    where: owner === null ? null : pages.where(owner),
    state: owner === null ? null : pages.state(owner),
    reopen: owner === null ? null : pages.reopenWaiting(owner),
  }
}

/** The pages in tabs of their own, as they change. */
export const usePageTabs = (host: PagesHost | undefined): ReadonlyArray<{ readonly owner: string; readonly state: PageState | null }> => {
  hear(host)
  useSyncExternalStore(subscribe, () => version)
  return pages.tabs().map((owner) => ({ owner, state: pages.state(owner) }))
}
