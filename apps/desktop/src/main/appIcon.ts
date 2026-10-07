import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * The icon the person gave Althar, kept in the profile beside its database
 * as the desktop app's own preferences, so a test's profile keeps its own.
 * Each icon is a picture in resources/icons; cobalt is the one Althar starts
 * with, and what any unreadable choice falls back to.
 */

export const APP_ICONS = ['cobalt', 'cobalt-dark', 'paper', 'ink', 'solid', 'solid-dark'] as const
export type AppIcon = (typeof APP_ICONS)[number]
export const DEFAULT_APP_ICON: AppIcon = 'cobalt'

export const isAppIcon = (value: unknown): value is AppIcon =>
  typeof value === 'string' && (APP_ICONS as ReadonlyArray<string>).includes(value)

const preferencesIn = (profile: string) => join(profile, 'desktop.json')

/** What the preferences file holds, or nothing where there is none or it isn't an object. */
const preferences = async (profile: string): Promise<Record<string, unknown>> => {
  try {
    const read: unknown = JSON.parse(await readFile(preferencesIn(profile), 'utf8'))
    return typeof read === 'object' && read !== null && !Array.isArray(read) ? (read as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const readAppIcon = async (profile: string): Promise<AppIcon> => {
  const { icon } = await preferences(profile)
  return isAppIcon(icon) ? icon : DEFAULT_APP_ICON
}

/** Keeps the icon, and whatever else the file holds. */
export const writeAppIcon = async (profile: string, icon: AppIcon) => {
  const kept = await preferences(profile)
  await mkdir(profile, { recursive: true })
  await writeFile(preferencesIn(profile), `${JSON.stringify({ ...kept, icon }, null, 2)}\n`)
}
