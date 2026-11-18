import { useSyncExternalStore } from 'react'

/*
 * A bringing in the runtime never got: refused before it answered (gone, restarting), so it can say nothing of it in the
 * project's conversation (Elsewhere.ts says what it got and couldn't bring in). The window has moved on by then, so the
 * window keeps it, by project, past the screen it was picked on and a reload (the window reloads as the runtime restarts),
 * and the project's conversation says it with Try again until another try goes through.
 */

export interface Unsent {
  readonly projectId: string
  /** What was picked, by name, as the tiles showed it. */
  readonly names: ReadonlyArray<string>
  readonly worktrees: ReadonlyArray<string>
  readonly setups: ReadonlyArray<string>
  readonly conversations: ReadonlyArray<string>
  /** Why it didn't go, in a line. */
  readonly why: string
}

const STORED = 'althar.unsentBringIns'

const strings = (value: unknown): value is ReadonlyArray<string> => Array.isArray(value) && value.every((one) => typeof one === 'string')

/** What the window's storage kept, as much of it as reads as it should. */
export const unsentFrom = (raw: string | null): Readonly<Record<string, Unsent>> => {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return Object.fromEntries(
      Object.values(parsed).flatMap((one: unknown) => {
        if (typeof one !== 'object' || one === null) return []
        const { projectId, names, worktrees, setups, conversations, why } = one as Record<string, unknown>
        return typeof projectId === 'string' &&
          typeof why === 'string' &&
          strings(names) &&
          strings(worktrees) &&
          strings(setups) &&
          strings(conversations)
          ? [[projectId, { projectId, names, worktrees, setups, conversations, why }]]
          : []
      }),
    )
  } catch {
    return {}
  }
}

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

let all: Readonly<Record<string, Unsent>> = unsentFrom(storage()?.getItem(STORED) ?? null)
const listeners = new Set<() => void>()

const set = (next: Readonly<Record<string, Unsent>>) => {
  all = next
  try {
    storage()?.setItem(STORED, JSON.stringify(all))
  } catch {
    // Kept for this window all the same.
  }
  for (const listener of listeners) listener()
}

export const unsent = {
  /** Keeps one the runtime never got; a later one for the same project takes in what both picked. */
  keep: (one: Unsent) => {
    const was = all[one.projectId]
    const both = (a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string>) => [...new Set([...(a ?? []), ...b])]
    set({
      ...all,
      [one.projectId]: {
        ...one,
        names: both(was?.names, one.names),
        worktrees: both(was?.worktrees, one.worktrees),
        setups: both(was?.setups, one.setups),
        conversations: both(was?.conversations, one.conversations),
      },
    })
  },
  /** Gone through on another try: the runtime says from then on what didn't come in. */
  drop: (projectId: string) => {
    if (all[projectId] === undefined) return
    const { [projectId]: _gone, ...rest } = all
    set(rest)
  },
  of: (projectId: string): Unsent | undefined => all[projectId],
  /** For the tests: as a window just opened, with nothing kept. */
  reset: () => set({}),
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useUnsent = (projectId: string): Unsent | undefined =>
  useSyncExternalStore(
    subscribe,
    () => all[projectId],
    () => all[projectId],
  )
