/*
 * What this computer is called on screen, by the system Althar runs on:
 * a Mac, a PC with Windows, or a computer with Linux, and where each keeps
 * an app's count. The system never changes while the window is open, so it
 * is read once, from the preload; anywhere without it (the tests) is a Mac.
 */

export interface DeviceWords {
  /** this Mac, this PC, this computer */
  readonly this: string
  /** This Mac, as a title */
  readonly This: string
  /** the Mac, the PC, the computer */
  readonly the: string
  /** Where an app's icon carries a count, where the system has one: the Dock, Linux's launcher; Windows has none. */
  readonly count: string | null
}

export const deviceWords = (platform: string): DeviceWords =>
  platform === 'darwin'
    ? { this: 'this Mac', This: 'This Mac', the: 'the Mac', count: 'the Dock icon' }
    : platform === 'win32'
      ? { this: 'this PC', This: 'This PC', the: 'the PC', count: null }
      : { this: 'this computer', This: 'This computer', the: 'the computer', count: 'the launcher icon' }

/** The system Althar runs on. */
export const platform: string = (typeof window === 'undefined' ? undefined : window.althar?.platform) ?? 'darwin'

/** The words for this computer. */
export const device: DeviceWords = deviceWords(platform)
