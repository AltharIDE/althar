import { EdgeSpot, unreachable } from '@althar/ui'

import type { EdgePlace } from '../../main/edge'

/*
 * Where Althar shows while the person works in another app, as Settings
 * says it. On a Mac whose screen has a notch it is a choice: round the
 * notch, or in the menu bar. Elsewhere it is wherever the system has room:
 * the menu bar of a Mac without a notch, the system tray of Windows or of a
 * Linux desktop, or, on a desktop with no tray, only Althar's own window.
 * The main process keeps the choice and knows the rest (main/edge.ts).
 */

export type { EdgePlace }

export const edgePlaces: ReadonlyArray<{ readonly value: EdgePlace; readonly title: string; readonly note: string }> = [
  { value: 'island', title: 'Round the notch', note: 'Point at it to open it.' },
  { value: 'menu', title: 'In the menu bar', note: 'Click Althar’s mark to see what needs you and what runs.' },
]

export const isEdgePlace = (value: string): value is EdgePlace => edgePlaces.some((place) => place.value === value)

/** What the main process says of this computer: the system, and whether it has a notch and a tray. */
export interface EdgeRoom {
  readonly platform: string
  readonly notch: boolean
  readonly tray: boolean
}

/** Where Althar shows: the place chosen where a Mac's notch leaves a choice, and otherwise wherever the system has room. */
export const edgeSpotOf = (room: EdgeRoom, place: EdgePlace): EdgeSpot => {
  if (room.platform === 'darwin') return room.notch ? (place === 'menu' ? EdgeSpot.MenuBesideNotch : EdgeSpot.Island) : EdgeSpot.MenuBar
  if (!room.tray) return EdgeSpot.WindowOnly
  return room.platform === 'win32' ? EdgeSpot.WindowsTray : EdgeSpot.LinuxTray
}

/** Whether the person chooses where it shows there: only round a notch or beside it. */
export const choosing = (spot: EdgeSpot): boolean => spot === EdgeSpot.Island || spot === EdgeSpot.MenuBesideNotch

export interface EdgeWords {
  /** In a word, under its module's name. */
  readonly word: string
  /** In full, on its page. */
  readonly title: string
  /** How to reach what it shows. */
  readonly note: string
  /** Why it is there, or what the system may do with it. */
  readonly why?: string
}

const menuNote = 'Click Althar’s mark to open it.'

export const edgeWords = (spot: EdgeSpot): EdgeWords => {
  switch (spot) {
    case EdgeSpot.Island:
      return { word: 'Round the notch', title: 'Round the notch', note: 'Point at it to open it.' }
    case EdgeSpot.MenuBesideNotch:
      return { word: 'Menu bar', title: 'In the menu bar', note: menuNote }
    case EdgeSpot.MenuBar:
      return {
        word: 'Menu bar',
        title: 'In the menu bar',
        note: menuNote,
        why: 'This screen has no notch.',
      }
    case EdgeSpot.WindowsTray:
      return {
        word: 'System tray',
        title: 'In the system tray',
        note: 'Click Althar’s mark beside the clock to open it.',
        why: 'Windows may tuck it under the ^. Drag it onto the taskbar to keep it in sight.',
      }
    case EdgeSpot.LinuxTray:
      // A desktop may take the mark and not show it, which nothing tells Althar: said, in case.
      return {
        word: 'System tray',
        title: 'In the system tray',
        note: menuNote,
        why: 'Without a tray, Althar shows only in its window.',
      }
    case EdgeSpot.WindowOnly:
      return {
        word: 'No tray',
        title: 'Only in Althar’s window',
        note: 'This desktop has no system tray.',
      }
    default:
      return unreachable(spot)
  }
}
