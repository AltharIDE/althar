import { createContext, type FunctionComponent, useContext } from 'react'

import type { Room } from '@althar/ui'

import type { Chat } from './data'

/** How the coordinator is marked, beside its name. */
export type MarkKind = 'althar' | 'project' | 'glyph' | 'word'

export const MARKS: ReadonlyArray<{ readonly kind: MarkKind; readonly label: string }> = [
  { kind: 'althar', label: 'Althar mark' },
  { kind: 'project', label: 'Project mark' },
  { kind: 'glyph', label: 'Glyph' },
  { kind: 'word', label: 'Word only' },
]

/** How the asides' bar over the conversation looks (keys 4–8). */
export type BarKind = 'pills' | 'tabs' | 'sheets' | 'title' | 'switch'

export const BARS: ReadonlyArray<{ readonly kind: BarKind; readonly label: string }> = [
  { kind: 'pills', label: 'Pills' },
  { kind: 'tabs', label: 'Tabs' },
  { kind: 'sheets', label: 'Sheets' },
  { kind: 'title', label: 'Title + asides' },
  { kind: 'switch', label: 'Switcher' },
]

/** How the bar inside an open aside looks (keys G H J K). */
export type InnerKind = 'head' | 'tab' | 'composer' | 'context'

export const INNERS: ReadonlyArray<{ readonly kind: InnerKind; readonly key: string; readonly label: string }> = [
  { kind: 'head', key: 'G', label: 'Head row' },
  { kind: 'tab', key: 'H', label: 'In the tab' },
  { kind: 'composer', key: 'J', label: 'By the composer' },
  { kind: 'context', key: 'K', label: 'Where it came from' },
]

export type Direction = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface DirectionOf {
  readonly key: Direction
  readonly label: string
  /** A line on the bar: what it is, in a few words. */
  readonly note: string
  /** Where the board has its chats: on Scratch, as today; on its lanes as work; or none, the direction drawing them. */
  readonly board: 'scratch' | 'quiet' | 'none'
  /** What it puts in the window's bar, at its end. */
  readonly Chrome: FunctionComponent
  /** What it lays over or into the screen. */
  readonly Overlay: FunctionComponent
  /** Its chats show in the coordinator's conversation, where they began. */
  readonly inThread?: boolean
}

/** The lab's state, for the directions to draw from and change. */
export interface LabState {
  readonly direction: DirectionOf
  readonly room: Room
  readonly mark: MarkKind
  readonly bar: BarKind
  readonly inner: InnerKind
  readonly visit: number
  /** The task open in the window, by its thread; null for the project. */
  readonly open: string | null
  readonly version: number
  readonly chats: ReadonlyArray<Chat>
  readonly promoted: ReadonlySet<string>
  readonly openTask: (threadId: string) => void
  readonly close: () => void
  readonly clear: (ids: ReadonlyArray<string>) => void
  readonly promote: (id: string) => void
  readonly start: (title: string) => Chat
  readonly reset: () => void
}

export const LabContext = createContext<LabState | null>(null)

export const useLab = () => {
  const lab = useContext(LabContext)
  if (lab === null) throw new Error('No lab')
  return lab
}
