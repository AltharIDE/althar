/*
 * Althar opening at login, in the background (docs/plans/automations.md,
 * "Where it runs"): the person's switch, `openAtLogin` in the app's
 * preferences, told to the system as they turn it on or off, so automations
 * run after a restart with nobody opening Althar. Opened so, it starts with
 * no window: the runtime starts as usual, and a window opens once the person
 * asks for one. A Mac says it opened Althar at login itself; Windows starts
 * it with an argument of Althar's own, which says so. Linux has no such
 * switch, so nothing is offered there.
 */

/** What Althar is started with at login on Windows, where the system can't say it opened it so. */
export const HIDDEN = '--hidden'

/** The system can open Althar at login: a Mac, and Windows. */
export const opensAtLogin = (platform: string): boolean => platform === 'darwin' || platform === 'win32'

/** What the system is told for the person's switch: on Windows, with the argument that says it was opened at login. */
export const loginItemOf = (openAtLogin: boolean, platform: string): { openAtLogin: boolean; args?: string[] } =>
  platform === 'win32' ? { openAtLogin, args: [HIDDEN] } : { openAtLogin }

/** Whether this launch is the system opening Althar at login: as a Mac says, or by the argument on Windows. */
export const openedAtLogin = (platform: string, argv: ReadonlyArray<string>, wasOpenedAtLogin: boolean): boolean =>
  platform === 'darwin' ? wasOpenedAtLogin : platform === 'win32' ? argv.includes(HIDDEN) : false
