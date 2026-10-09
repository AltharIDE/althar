import type { DictationTrayText } from '@althar/ui'

/*
 * Dictation's words for each system. The kit's own are the Mac's; Windows
 * and Linux name their machine and their settings in their own way, and
 * Linux has no settings Althar can open, so it says where to look instead.
 */

const windows: Partial<DictationTrayText> = {
  offer: 'Dictation needs a speech model on this PC',
  offerNote: 'It turns what you say into text here; nothing you say leaves this PC.',
  asking: 'Waiting for Windows to allow the microphone',
  askingNote: 'Answer the question Windows shows to go on.',
  deniedNote:
    'Turn on microphone access, and access for desktop apps, in Settings › Privacy & security › Microphone, then press the microphone again.',
  openPrivacy: 'Open Settings',
  noMicrophoneNote: 'Connect one, or choose an input in Settings › System › Sound.',
}

const linux: Partial<DictationTrayText> = {
  offer: 'Dictation needs a speech model on this computer',
  offerNote: 'It turns what you say into text here; nothing you say leaves this computer.',
  asking: 'Waiting for the system to allow the microphone',
  askingNote: 'Answer the question the system shows to go on.',
  deniedNote: 'The system refused the microphone. Allow it in your desktop’s privacy or sound settings, then press the microphone again.',
  noMicrophoneNote: 'Connect one, or choose an input in your desktop’s sound settings.',
}

export const trayText = (platform: string): Partial<DictationTrayText> => {
  if (platform === 'win32') return windows
  if (platform === 'darwin') return {}
  return linux
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
