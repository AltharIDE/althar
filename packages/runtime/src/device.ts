/*
 * What this computer is called in the words the runtime writes for people:
 * a Mac, a PC with Windows, or a computer with Linux. The UI's own table
 * (@althar/ui, foundations/device.ts) names the same three; a test in the
 * desktop app keeps the two alike.
 */

/** this Mac, this PC, this computer */
export const thisDevice = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'darwin' ? 'this Mac' : platform === 'win32' ? 'this PC' : 'this computer'
