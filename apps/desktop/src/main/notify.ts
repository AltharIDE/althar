import type { AppPreferences } from './appPreferences'

/*
 * What the person asked to be told outside the window (Linear DEV-14): each
 * kind of nudge the runtime says has a switch of its own, and the Dock's
 * count one more. A kind the app doesn't know is told, as a call would be.
 */

/** Whether a nudge of this kind shows as a notification. */
export const tells = (kind: unknown, preferences: AppPreferences): boolean =>
  kind === 'ready' ? preferences.notifyReady : kind === 'stopped' ? preferences.notifyStopped : preferences.notifyCalls

/** The system's own notification sound, where it has no alert sounds to choose from (Windows, Linux). */
export const SYSTEM_SOUND = 'default'

/** How a notification sounds: silent, the system's own sound, or the Mac alert sound the person chose. */
export const soundOf = (preferences: AppPreferences): { readonly silent: boolean; readonly sound?: string } =>
  preferences.sound === null
    ? { silent: true }
    : preferences.sound === SYSTEM_SOUND
      ? { silent: false }
      : { silent: false, sound: preferences.sound }

/** What the Dock counts: how many things wait, or nothing while its count is off. */
export const dockCount = (waiting: number, preferences: AppPreferences): number => (preferences.badge ? waiting : 0)
