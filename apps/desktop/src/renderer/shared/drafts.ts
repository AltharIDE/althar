import { type Dispatch, type SetStateAction, useCallback, useSyncExternalStore } from 'react'

/*
 * What the person has written in a composer and not sent yet, kept by the
 * thread it is for (the coordinator's, or a task's) rather than by the
 * screen, so it is there again when they come back to it: from the home,
 * from another tab, or after their words were written down while they were
 * away. The words are kept in the window's storage too, so they outlive a
 * restart; the images and files only as long as the window, since an
 * image's bytes can be megabytes and a file's grant lasts the launch.
 * Sending clears it; a message Althar didn't take comes back to it.
 *
 * A draft also remembers whether any of its words were dictated, even if
 * the person edited them after: the message is sent marked, so the agent
 * knows to read past what was misheard. Emptying the words forgets it.
 *
 * The window holds the words; storage is written behind them, not on each
 * key: a moment after the person stops typing, or a little later while they
 * go on, and at once as the window goes. Only the threads whose words
 * changed are written, over what another window kept for the rest.
 */

/** Where the words are kept across launches, by thread. */
const STORED = 'althar.drafts'
/** Where the threads whose draft holds dictated words are kept, as a list. */
const STORED_DICTATED = 'althar.drafts.dictated'

export interface Draft<Image, File = unknown> {
  readonly text: string
  readonly images: ReadonlyArray<Image>
  /** Files and folders added, after the images. */
  readonly files: ReadonlyArray<File>
  /** Some of the words were dictated. */
  readonly dictated: boolean
}

const EMPTY: Draft<never, never> = { text: '', images: [], files: [], dictated: false }

const drafts = new Map<string, Draft<unknown, unknown>>()
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

/** How long after the last change storage is written, and how long the person typing on puts it off at most. */
const WRITE = { after: 300, within: 2000 } as const

/** Threads whose words changed since storage was last written, with their words now. */
const unwritten = new Map<string, string>()
let writing: ReturnType<typeof setTimeout> | undefined
/** When the oldest of what isn't written yet changed. */
let since: number | null = null
let listening = false

/** Writes the threads whose words changed, over what another window kept for other threads. */
const write = () => {
  clearTimeout(writing)
  writing = undefined
  since = null
  if (unwritten.size === 0) return
  const changed = [...unwritten]
  unwritten.clear()
  try {
    const now: unknown = JSON.parse(window.localStorage.getItem(STORED) ?? '{}')
    const all = typeof now === 'object' && now !== null ? { ...(now as Record<string, unknown>) } : {}
    for (const [key, text] of changed)
      if (text === '') delete all[key]
      else all[key] = text
    if (Object.keys(all).length === 0) window.localStorage.removeItem(STORED)
    else window.localStorage.setItem(STORED, JSON.stringify(all))
  } catch {
    // Kept for this window only.
  }
}

/** Keeps a thread's words: in the window at once, and in storage behind them. */
const keep = (key: string, text: string) => {
  const kept = readStored()
  if (text === '') delete kept[key]
  else kept[key] = text
  unwritten.set(key, text)
  // As the window goes, what is still unwritten is written then.
  if (!listening) {
    listening = true
    window.addEventListener('pagehide', write)
    window.addEventListener('beforeunload', write)
  }
  const at = Date.now()
  since ??= at
  clearTimeout(writing)
  writing = setTimeout(write, Math.max(0, Math.min(WRITE.after, since + WRITE.within - at)))
}

/** A thread's draft as it stands. */
export const draftOf = <Image, File = unknown>(key: string): Draft<Image, File> => {
  const draft = drafts.get(key)
  if (draft !== undefined) return draft as Draft<Image, File>
  const text = readStored()[key] ?? ''
  if (text === '') return EMPTY
  const read = { text, images: [], files: [], dictated: readDictated().includes(key) }
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

const put = (key: string, next: Draft<unknown, unknown>) => {
  const was = draftOf(key)
  // No words, nothing dictated.
  const now = next.text === '' && next.dictated ? { ...next, dictated: false } : next
  if (now.text === was.text && now.images === was.images && now.files === was.files && now.dictated === was.dictated) return
  if (now.text === '' && now.images.length === 0 && now.files.length === 0) drafts.delete(key)
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

/** Changes a thread's files and folders, on screen or not. */
export const setDraftFiles = <File>(key: string, change: (now: ReadonlyArray<File>) => ReadonlyArray<File>) => {
  const was = draftOf<unknown, File>(key)
  put(key, { ...was, files: change(was.files) })
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
export const useDraftOf = <Image, File = unknown>(key: string): Draft<Image, File> =>
  useSyncExternalStore(
    useCallback((listener: () => void) => subscribeDraft(key, listener), [key]),
    () => draftOf<Image, File>(key),
  )

/** A thread's words, and the way to change them: as useState, but kept by the thread. */
export const useDraft = (key: string): readonly [string, Dispatch<SetStateAction<string>>] => {
  const { text } = useDraftOf(key)
  return [text, useSetDraft(key)]
}

/**
 * The way to change a thread's words, for a screen that doesn't show them itself: its composer does
 * (`DraftComposer`), so the screen isn't drawn again for each word typed.
 */
export const useSetDraft = (key: string): Dispatch<SetStateAction<string>> =>
  useCallback((change: SetStateAction<string>) => setDraftText(key, change), [key])

/** What a screen reads of a thread's words, as it changes: drawn again only where that does, not for each word typed. */
export const useDraftWords = <T>(key: string, read: (text: string) => T): T =>
  useSyncExternalStore(
    useCallback((listener: () => void) => subscribeDraft(key, listener), [key]),
    () => read(draftOf(key).text),
  )

/** A thread's images and files, and whether its words were dictated, as they change: each the same until it does, whatever is typed. */
export const useDraftAttached = <Image, File = unknown>(key: string): Pick<Draft<Image, File>, 'images' | 'files' | 'dictated'> => {
  const subscribe = useCallback((listener: () => void) => subscribeDraft(key, listener), [key])
  const images = useSyncExternalStore(subscribe, () => draftOf<Image, File>(key).images)
  const files = useSyncExternalStore(subscribe, () => draftOf<Image, File>(key).files)
  const dictated = useSyncExternalStore(subscribe, () => draftOf(key).dictated)
  return { images, files, dictated }
}

/* Each image's id, unique in the window, so ones kept in a draft from before never share one with ones added since. */
let images = 0
export const nextImageId = () => {
  images += 1
  return `image-${images}`
}

/** Forgets every draft this window holds, as each test starts: what wasn't written to storage yet isn't. */
export const forgetDrafts = () => {
  drafts.clear()
  stored = null
  images = 0
  clearTimeout(writing)
  writing = undefined
  since = null
  unwritten.clear()
  focusing.clear()
}

/** The threads whose composer is to take the focus as it next shows: words were put in it for the person to go on with. */
const focusing = new Set<string>()

/** Asks a thread's composer to take the focus, its caret after the words, as it next shows (`DraftComposer`). */
export const focusDraft = (key: string) => {
  focusing.add(key)
  listeners.get(key)?.forEach((listener) => listener())
}

/** Whether a thread's composer is asked to take the focus, not yet taken. */
export const wantsDraftFocus = (key: string) => focusing.has(key)

/** Whether a thread's composer was asked to take the focus: asked once, taken once. */
export const takeDraftFocus = (key: string) => focusing.delete(key)

/** The key of the coordinator's draft in a project, and of a task's. */
export const draftKey = {
  coordinator: (projectId: string) => `coordinator:${projectId}`,
  task: (threadId: string) => `thread:${threadId}`,
  /** What was dictated with no composer to say it to, until it is placed (`dictation/Loose.tsx`). */
  loose: 'dictation:loose',
}
