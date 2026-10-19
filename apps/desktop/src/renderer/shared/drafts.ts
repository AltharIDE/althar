import { type Dispatch, type SetStateAction, useCallback, useSyncExternalStore } from 'react'

/*
 * What the person has written in a composer and not sent yet, kept by the
 * thread it is for (the coordinator's, or a task's) rather than by the
 * screen, so it is there again when they come back to it: from the home,
 * from another tab, or after their words were written down while they were
 * away. The words are kept in the window's storage too, so they outlive a
 * restart; the images only as long as the window, since their bytes can be
 * megabytes. Sending clears it; a message Althar didn't take comes back to
 * it.
 *
 * A draft also remembers whether any of its words were dictated, even if
 * the person edited them after: the message is sent marked, so the agent
 * knows to read past what was misheard. Emptying the words forgets it.
 */

/** Where the words are kept across launches, by thread. */
const STORED = 'althar.drafts'
/** Where the threads whose draft holds dictated words are kept, as a list. */
const STORED_DICTATED = 'althar.drafts.dictated'

export interface Draft<Image> {
  readonly text: string
  readonly images: ReadonlyArray<Image>
  /** Some of the words were dictated. */
  readonly dictated: boolean
}

const EMPTY: Draft<never> = { text: '', images: [], dictated: false }

const drafts = new Map<string, Draft<unknown>>()
const listeners = new Map<string, Set<() => void>>()
/* The words kept in storage, read once a window. */
let stored: Record<string, string> | null = null

const readStored = (): Record<string, string> => {
  if (stored !== null) return stored
  stored = {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORED) ?? '{}')
    if (typeof parsed === 'object' && parsed !== null)
      for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string' && value !== '') stored[key] = value
  } catch {
    // Nothing kept, or nothing readable: every draft starts empty.
  }
  return stored
}

/** Keeps a thread's words in storage, over what another window kept for other threads. */
const keep = (key: string, text: string) => {
  const kept = readStored()
  if (text === '') delete kept[key]
  else kept[key] = text
  try {
    const now: unknown = JSON.parse(window.localStorage.getItem(STORED) ?? '{}')
    const all = typeof now === 'object' && now !== null ? { ...(now as Record<string, unknown>) } : {}
    if (text === '') delete all[key]
    else all[key] = text
    if (Object.keys(all).length === 0) window.localStorage.removeItem(STORED)
    else window.localStorage.setItem(STORED, JSON.stringify(all))
  } catch {
    // Kept for this window only.
  }
}

/** A thread's draft as it stands. */
export const draftOf = <Image>(key: string): Draft<Image> => {
  const draft = drafts.get(key)
  if (draft !== undefined) return draft as Draft<Image>
  const text = readStored()[key] ?? ''
  if (text === '') return EMPTY
  const read = { text, images: [], dictated: readDictated().includes(key) }
  drafts.set(key, read)
  return read
}

/** The threads whose kept words hold dictated ones. */
const readDictated = (): ReadonlyArray<string> => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORED_DICTATED) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

/** Keeps whether a thread's words hold dictated ones, over what another window kept for other threads. */
const keepDictated = (key: string, dictated: boolean) => {
  try {
    const others = readDictated().filter((one) => one !== key)
    const all = dictated ? [...others, key] : others
    if (all.length === 0) window.localStorage.removeItem(STORED_DICTATED)
    else window.localStorage.setItem(STORED_DICTATED, JSON.stringify(all))
  } catch {
    // Kept for this window only.
  }
}

const put = (key: string, next: Draft<unknown>) => {
  const was = draftOf(key)
  // No words, nothing dictated.
  const now = next.text === '' && next.dictated ? { ...next, dictated: false } : next
  if (now.text === was.text && now.images === was.images && now.dictated === was.dictated) return
  if (now.text === '' && now.images.length === 0) drafts.delete(key)
  else drafts.set(key, now)
  if (now.text !== was.text) keep(key, now.text)
  if (now.dictated !== was.dictated) keepDictated(key, now.dictated)
  listeners.get(key)?.forEach((listener) => listener())
}

/** Changes a thread's words, on screen or not. */
export const setDraftText = (key: string, change: SetStateAction<string>) => {
  const was = draftOf(key)
  put(key, { ...was, text: typeof change === 'function' ? change(was.text) : change })
}

/** Notes that some of a thread's words were dictated (or, with false, that none are), on screen or not. */
export const setDraftDictated = (key: string, dictated: boolean) => {
  const was = draftOf(key)
  put(key, { ...was, dictated })
}

/** Changes a thread's images, on screen or not. */
export const setDraftImages = <Image>(key: string, change: (now: ReadonlyArray<Image>) => ReadonlyArray<Image>) => {
  const was = draftOf<Image>(key)
  put(key, { ...was, images: change(was.images) })
}

export const subscribeDraft = (key: string, listener: () => void) => {
  const set = listeners.get(key) ?? new Set()
  listeners.set(key, set)
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

/** A thread's draft, as it changes. */
export const useDraftOf = <Image>(key: string): Draft<Image> =>
  useSyncExternalStore(
    useCallback((listener: () => void) => subscribeDraft(key, listener), [key]),
    () => draftOf<Image>(key),
  )

/** A thread's words, and the way to change them: as useState, but kept by the thread. */
export const useDraft = (key: string): readonly [string, Dispatch<SetStateAction<string>>] => {
  const { text } = useDraftOf(key)
  const set = useCallback((change: SetStateAction<string>) => setDraftText(key, change), [key])
  return [text, set]
}

/* Each image's id, unique in the window, so ones kept in a draft from before never share one with ones added since. */
let images = 0
export const nextImageId = () => {
  images += 1
  return `image-${images}`
}

/** Forgets every draft this window holds, as each test starts. */
export const forgetDrafts = () => {
  drafts.clear()
  stored = null
  images = 0
}

/** The key of the coordinator's draft in a project, and of a task's. */
export const draftKey = {
  coordinator: (projectId: string) => `coordinator:${projectId}`,
  task: (threadId: string) => `thread:${threadId}`,
}
