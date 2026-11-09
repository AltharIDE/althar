import type { DictationSettingsText, DictationTrayText } from '@althar/ui'

import { device } from '../device'

/*
 * Dictation's words for each system. The kit's own are the Mac's; Windows
 * and Linux name their machine and their settings in their own way, and
 * Linux has no settings Althar can open, so it says where to look instead.
 */

const windows: Partial<DictationTrayText> = {
  offer: 'Dictation needs a speech model on this PC',
  offerNote: 'Runs on this PC.',
  asking: 'Waiting for Windows to allow the microphone',
  deniedNote:
    'Turn on microphone access, and access for desktop apps, in Settings › Privacy & security › Microphone, then press the microphone again.',
  openPrivacy: 'Open Settings',
  noMicrophoneNote: 'Connect one, or choose an input in Settings › System › Sound.',
}

const linux: Partial<DictationTrayText> = {
  offer: 'Dictation needs a speech model on this computer',
  offerNote: 'Runs on this computer.',
  asking: 'Waiting for the system to allow the microphone',
  deniedNote: 'The system refused the microphone. Allow it in your desktop’s privacy or sound settings, then press the microphone again.',
  noMicrophoneNote: 'Connect one, or choose an input in your desktop’s sound settings.',
}

export const trayText = (platform: string): Partial<DictationTrayText> => {
  if (platform === 'win32') return windows
  if (platform === 'darwin') return {}
  return linux
}

/** The Settings section's words for each system: the same names the tray uses, and this computer by its own name. */
export const settingsText = (platform: string): Partial<DictationSettingsText> => {
  const here = platform === 'win32' ? 'this PC' : platform === 'darwin' ? 'this Mac' : device.this
  const base: Partial<DictationSettingsText> = {
    absent: (name, size) => `${name} isn’t on ${here}. Dictating downloads it first (${size}).`,
    partial: (name, onDisk, size) => `${name} is only partly on ${here}: ${onDisk} of ${size} on disk.`,
  }
  if (platform === 'win32')
    return {
      ...base,
      denied: 'Microphone access is off for Althar, so dictation can’t hear you. Turn on microphone access, and access for desktop apps.',
      openSettings: 'Open Settings',
    }
  return base
}

/** Bytes, as the tray says them: megabytes, or gigabytes from a thousand of them. */
export const bytes = (n: number) => {
  const mb = n / 1_000_000
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}

/** How long is left, as the tray says it, from what is left and how fast it comes. */
export const timeLeft = (left: number, perSecond: number) => {
  if (!(perSecond > 0)) return undefined
  const seconds = Math.ceil(left / perSecond)
  return seconds < 60 ? `about ${Math.max(1, seconds)} s` : `about ${Math.ceil(seconds / 60)} min`
}

/** A recording’s length, as the composer’s clock shows it: 0:12. */
export const lengthOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
