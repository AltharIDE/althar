import { useSyncExternalStore } from 'react'

import type { PageState } from '../../../main/browser/page'
import type { PagesHost } from '../../data/services'

/*
 * The pages beside the conversations, as this window shows them (ADR-100):
 * where each owner's page is (beside its conversation, or in a tab of its
 * own), and how each stands, as the main process last said. The page itself
 * is main's, and outlives where it shows: hidden from beside a conversation
 * for a document, or while another task is on screen, it is still there to
 * show again, where it was. Where each shows is kept in the window's
 * storage too, so a window reloaded (as the runtime restarts) or opened
 * after (on a Mac) shows each page main still has where it was; the others,
 * closed with their tasks or as Althar quit, are forgotten.
 */

/** Where an owner's page shows: beside its conversation, or in a tab of its own. */
export type Where = 'beside' | 'tab'

/** The conversation a page came from, for its tab to go back beside, and the draft its comments go to. */
export type Origin =
  | { readonly kind: 'task'; readonly threadId: string; readonly draft: string }
  | { readonly kind: 'project'; readonly projectId: string; readonly draft: string }

const STORED = 'althar.pages'

/** What the window's storage keeps: where each page shows, in order, and where each came from. */
export interface Stored {
  readonly placed: ReadonlyArray<readonly [string, Where]>
  readonly origins: Readonly<Record<string, Origin>>
}

const isWhere = (value: unknown): value is Where => value === 'beside' || value === 'tab'

const originFrom = (value: unknown): Origin | null => {
  if (typeof value !== 'object' || value === null || !('draft' in value) || typeof value.draft !== 'string') return null
  if ('kind' in value && value.kind === 'task' && 'threadId' in value && typeof value.threadId === 'string')
    return { kind: 'task', threadId: value.threadId, draft: value.draft }
  if ('kind' in value && value.kind === 'project' && 'projectId' in value && typeof value.projectId === 'string')
    return { kind: 'project', projectId: value.projectId, draft: value.draft }
  return null
}

/** What the window's storage kept, as much of it as reads as it should; nothing where none does. */
export const storedFrom = (raw: string | null): Stored => {
  const none: Stored = { placed: [], origins: {} }
  if (raw === null) return none
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return none
    const placed =
      'placed' in parsed && Array.isArray(parsed.placed)
        ? parsed.placed.flatMap((entry: unknown) =>
            Array.isArray(entry) && typeof entry[0] === 'string' && isWhere(entry[1]) ? [[entry[0], entry[1]] as const] : [],
          )
        : []
    const origins: Record<string, Origin> = {}
    if ('origins' in parsed && typeof parsed.origins === 'object' && parsed.origins !== null)
      for (const [owner, value] of Object.entries(parsed.origins)) {
        const origin = originFrom(value)
        if (origin !== null) origins[owner] = origin
      }
    return { placed, origins }
  } catch {
    return none
  }
}

const placed = new Map<string, Where>()
const origins = new Map<string, Origin>()
/* Where the window's storage said pages showed, waiting for main's word on which it still has. */
const waking = new Map<string, Where>()
let woken = false
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

/** Takes up what the window's storage kept, once a window: where each came from at once, for its tab's address to open; where each shows once main says it still has it. */
const wake = () => {
  if (woken) return
  woken = true
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORED)
  } catch {
    // Nothing kept to take up.
  }
  const stored = storedFrom(raw)
  for (const [owner, where] of stored.placed) waking.set(owner, where)
  for (const [owner, origin] of Object.entries(stored.origins)) if (!origins.has(owner)) origins.set(owner, origin)
}

/** Keeps where each page shows, and where each came from, in the window's storage; what still waits for main's word too. */
const keep = () => {
  // What storage kept and isn't taken up yet stays kept.
  wake()
  const shown = [...placed, ...[...waking].filter(([owner]) => !placed.has(owner))]
  const stored: Stored = {
    placed: shown,
    origins: Object.fromEntries(
      shown.flatMap(([owner]) => {
        const origin = origins.get(owner)
        return origin === undefined ? [] : [[owner, origin] as const]
      }),
    ),
  }
  try {
    if (shown.length === 0) window.localStorage.removeItem(STORED)
    else window.localStorage.setItem(STORED, JSON.stringify(stored))
  } catch {
    // Kept for this window only.
  }
}

/*
 * Main's word on every page, heard once a window, from the first that asks:
 * how each stands, and that one closed of itself, its task done. A window
 * reloaded or opened after its pages asks how those stand, and shows each
 * main still has where its storage said it showed.
 */
let heard: PagesHost | null = null
const hear = (host: PagesHost | undefined) => {
  if (host === undefined || heard === host) return
  heard = host
  wake()
  host.onState((state) => {
    states.set(state.owner, state)
    changed()
  })
  host.onClosed((owner) => pages.forget(owner))
  void host
    .states()
    .then((open) => {
      // What main said since is newer than this.
      for (const state of open) if (!states.has(state.owner)) states.set(state.owner, state)
      // Shown again where it was, unless the person has placed it since; one main no longer has is forgotten.
      const has = new Set(open.map((state) => state.owner))
      for (const [owner, where] of waking) if (has.has(owner) && !placed.has(owner)) placed.set(owner, where)
    })
    .catch(() => undefined)
    .finally(() => {
      waking.clear()
      keep()
      changed()
    })
}

export const pages = {
  where: (owner: string): Where | null => placed.get(owner) ?? null,
  state: (owner: string): PageState | null => states.get(owner) ?? null,
  /** Shows an owner's page beside its conversation, or in its tab, remembering the conversation it came from. */
  place: (owner: string, where: Where, origin?: Origin) => {
    if (origin !== undefined) origins.set(owner, origin)
    if (placed.get(owner) !== where) {
      // A tab goes after the others: placed again, it moves to the end.
      placed.delete(owner)
      placed.set(owner, where)
      changed()
    }
    keep()
  },
  originOf: (owner: string): Origin | null => {
    wake()
    return origins.get(owner) ?? null
  },
  /** Whether the window's storage said where the owner's page shows, and main, heard from, has yet to say it still has it. */
  waking: (owner: string): boolean => heard !== null && waking.has(owner),
  /** Takes the page from where it shows; it is still there, to show again. */
  hide: (owner: string) => {
    if (!placed.delete(owner)) return
    keep()
    changed()
  },
  /** Forgets an owner's page, once it is closed; where it came from stays, for its tab to go back to. */
  forget: (owner: string) => {
    placed.delete(owner)
    waking.delete(owner)
    states.delete(owner)
    reopening.delete(owner)
    keep()
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

/** Forgets every page, as a window opened afresh would, with what its storage kept: for tests. */
export const forgetPages = () => {
  placed.clear()
  origins.clear()
  waking.clear()
  states.clear()
  reopening.clear()
  heard = null
  woken = false
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
