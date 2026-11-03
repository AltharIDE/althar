/*
 * The keys of the system Althar runs on, so a shortcut is drawn and heard
 * the way that system has it: ⌘, ⌥ and ⇧ on a Mac; Ctrl, Alt and Shift
 * elsewhere, joined with a plus. The system never changes while the window
 * is open (see device.ts); anywhere without it is a Mac.
 */

import { platform } from './device'

export const isMac = platform === 'darwin'

export const keys = {
  /** The primary modifier: ⌘ on a Mac, Ctrl elsewhere. */
  mod: isMac ? '⌘' : 'Ctrl',
  alt: isMac ? '⌥' : 'Alt',
  shift: isMac ? '⇧' : 'Shift',
  /** The enter key, as the composer draws it: ↵ on a Mac. */
  enter: isMac ? '↵' : 'Enter',
  /** The return key, as the start screen draws it: ⏎ on a Mac. */
  return: isMac ? '⏎' : 'Enter',
}

/** Keys pressed together, as the system draws them: ⌘N, Ctrl+N; ⌘⇧5, Ctrl+Shift+5. */
export const chord = (...parts: ReadonlyArray<string>): string => parts.join(isMac ? '' : '+')

/** The primary modifier plus a key: ⌘N, Ctrl+N. */
export const modKey = (key: string): string => chord(keys.mod, key)

/** Whether the primary modifier is down, and not the other: ⌘ on a Mac, Ctrl elsewhere (Super, the Windows key, is no modifier of ours). */
export const primaryDown = (event: Modifiers): boolean => (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)

/** Whether a shortcut's modifier is down: ⌘ or Ctrl on a Mac, as it has always been, Ctrl elsewhere. */
export const commandDown = (event: Modifiers): boolean => (isMac ? event.metaKey || event.ctrlKey : event.ctrlKey)

interface Modifiers {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}
