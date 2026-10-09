/*
 * The app's own preferences, typed: each with what it starts as and what it
 * may hold. They are kept in the profile's desktop.json (preferences.ts),
 * a key each beside the icon and the edge; a value missing or not what the
 * key holds reads as where it starts. Settings reads and changes them
 * through the main process, which is where they take effect: keeping the
 * Mac awake while work runs, which notifications show, the Dock's count and
 * a sound. Which editor files open in is the window's to use. Nothing here
 * touches Node, so the window may read the defaults and keys too.
 */

interface Kind<T> {
  readonly starts: T
  readonly holds: (value: unknown) => value is T
}

const onOff = (starts: boolean): Kind<boolean> => ({ starts, holds: (value): value is boolean => typeof value === 'boolean' })

/** An editor by its id (the runtime's `ListEditors`); null for the first one found. */
const editor: Kind<string | null> = {
  starts: null,
  holds: (value): value is string | null => value === null || (typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value)),
}

export const PREFERENCES = {
  /** Keeps the Mac from sleeping while any work runs or waits; the display may still sleep. */
  keepAwake: onOff(true),
  /** And on battery too; otherwise only while it is plugged in. */
  awakeOnBattery: onOff(false),
  /** Which editor a task's files and folder open in. */
  editor,
  /** A notification when a call waits on the person: a permission, a plan, a question. */
  notifyCalls: onOff(true),
  /** A notification when a task is ready for them. */
  notifyReady: onOff(true),
  /** A notification when work stopped and couldn't start again. */
  notifyStopped: onOff(true),
  /** How many things wait, on the Dock icon. */
  badge: onOff(true),
  /** A sound with each notification. */
  sound: onOff(false),
} as const

type Kinds = typeof PREFERENCES
export type PreferenceKey = keyof Kinds
export type AppPreferences = { readonly [K in PreferenceKey]: Kinds[K]['starts'] }

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as ReadonlyArray<PreferenceKey>

export const DEFAULT_PREFERENCES = Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].starts])) as AppPreferences

export const isPreferenceKey = (key: unknown): key is PreferenceKey => typeof key === 'string' && Object.hasOwn(PREFERENCES, key)

/** Whether `value` is one `key` can hold. */
export const holds = <K extends PreferenceKey>(key: K, value: unknown): value is AppPreferences[K] =>
  (PREFERENCES[key].holds as (value: unknown) => boolean)(value)

/** The preferences in what a file held: each key's own value where it is one that key can hold, else where it starts. */
export const preferencesIn = (kept: Readonly<Record<string, unknown>>): AppPreferences =>
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, holds(key, kept[key]) ? kept[key] : PREFERENCES[key].starts])) as AppPreferences
