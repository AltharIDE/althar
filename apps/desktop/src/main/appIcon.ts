import { readPreferences, writePreference } from './preferences'

/*
 * The icon the person gave Althar, kept in the profile's desktop.json
 * (preferences.ts). Each icon is a picture in resources/icons; cobalt is the
 * one Althar starts with, and what any unreadable choice falls back to.
 */

export const APP_ICONS = ['cobalt', 'cobalt-dark', 'paper', 'ink', 'solid', 'solid-dark'] as const
export type AppIcon = (typeof APP_ICONS)[number]
export const DEFAULT_APP_ICON: AppIcon = 'cobalt'

export const isAppIcon = (value: unknown): value is AppIcon =>
  typeof value === 'string' && (APP_ICONS as ReadonlyArray<string>).includes(value)

export const readAppIcon = async (profile: string): Promise<AppIcon> => {
  const { icon } = await readPreferences(profile)
  return isAppIcon(icon) ? icon : DEFAULT_APP_ICON
}

/** Keeps the icon, and whatever else the file holds. */
export const writeAppIcon = (profile: string, icon: AppIcon) => writePreference(profile, 'icon', icon)
