import { useSyncExternalStore } from 'react'

import { GIFT } from './artifacts'

/*
 * The artifact a chat is on, which its top row names: beside Gift a class's
 * conversation, the artifact its lead drew, or another picked in the row's
 * switcher (A, C, D); in the project's Artifacts, the one opened there, if
 * any (B, and A's and D's table). And whether its canvas has the window to
 * itself, the conversation out of the way.
 */

interface Chat {
  readonly beside: string
  readonly room: string | null
  readonly wide: boolean
}

let now: Chat = { beside: GIFT, room: null, wide: false }
const listeners = new Set<() => void>()
const put = (change: Partial<Chat>) => {
  now = { ...now, ...change }
  for (const listener of listeners) listener()
}

export const chat = {
  get: () => now,
  /** A new moment: Gift a class beside its conversation, and the artifact the moment opens in the room. */
  reset: (room: string | null) => put({ beside: GIFT, room, wide: false }),
  beside: (id: string) => put({ beside: id }),
  room: (id: string | null) => put({ room: id, wide: false }),
  wide: (wide: boolean) => put({ wide }),
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useChat = () => useSyncExternalStore(chat.subscribe, chat.get)
