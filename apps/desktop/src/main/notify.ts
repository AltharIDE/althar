import type { AppPreferences } from './appPreferences'

/*
 * What the person asked to be told outside the window (Linear DEV-14): each
 * kind of nudge the runtime says has a switch of its own, and the Dock's
 * count one more. A kind the app doesn't know is told, as a call would be.
 */

/** Whether a nudge of this kind shows as a notification. */
export const tells = (kind: unknown, preferences: AppPreferences): boolean =>
  kind === 'ready' ? preferences.notifyReady : kind === 'stopped' ? preferences.notifyStopped : preferences.notifyCalls

/** What the Dock counts: how many things wait, or nothing while its count is off. */
export const dockCount = (waiting: number, preferences: AppPreferences): number => (preferences.badge ? waiting : 0)
