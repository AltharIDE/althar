import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type AppPreferences, holds, type PreferenceKey, preferencesIn } from './appPreferences'

/*
 * The desktop app's own preferences, kept in the profile beside its database
 * as desktop.json, so a test's profile keeps its own: the app's icon,
 * where Althar shows while you work in another app, and the app's own
 * preferences (appPreferences.ts). Each is a key of its own; writing one
 * keeps the rest, one write at a time, and whole: a new file takes the old
 * one's place, so a write cut short never leaves half of one.
 */

const fileIn = (profile: string) => join(profile, 'desktop.json')

/** What the file holds, nothing where there is none, and whether it is there but couldn't be read as an object. */
const readFileIn = async (profile: string): Promise<{ readonly kept: Record<string, unknown>; readonly damaged: boolean }> => {
  let text: string
  try {
    text = await readFile(fileIn(profile), 'utf8')
  } catch (error) {
    return { kept: {}, damaged: (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  }
  try {
    const read: unknown = JSON.parse(text)
    const object = typeof read === 'object' && read !== null && !Array.isArray(read)
    return { kept: object ? (read as Record<string, unknown>) : {}, damaged: !object }
  } catch {
    return { kept: {}, damaged: true }
  }
}

/** What the file holds, or nothing where there is none or it isn't an object. */
export const readPreferences = async (profile: string): Promise<Record<string, unknown>> => (await readFileIn(profile)).kept

/* Writes in the order they were asked for, so two at once can't each keep the other's old value. */
let writing: Promise<unknown> = Promise.resolve()

/** Keeps one preference, and whatever else the file holds, making the profile where there is none. */
export const writePreference = (profile: string, key: string, value: unknown): Promise<void> => {
  const write = writing.then(async () => {
    const kept = await readPreferences(profile)
    await mkdir(profile, { recursive: true })
    const next = `${fileIn(profile)}.${process.pid}.next`
    await writeFile(next, `${JSON.stringify({ ...kept, [key]: value }, null, 2)}\n`)
    await rename(next, fileIn(profile))
  })
  writing = write.catch(() => undefined)
  return write
}

/**
 * The app's own preferences (appPreferences.ts), each as kept or where it
 * starts. A file that is there but can't be read keeps usage data and crash
 * reports off, and is written again so: the person may have turned them
 * off, and nothing else in it can be read back.
 */
export const readAppPreferences = async (profile: string): Promise<AppPreferences> => {
  const { kept, damaged } = await readFileIn(profile)
  if (!damaged) return preferencesIn(kept)
  await writePreference(profile, 'usageData', false)
    .then(() => writePreference(profile, 'crashReports', false))
    .catch(() => undefined)
  return { ...preferencesIn(kept), usageData: false, crashReports: false }
}

/** Keeps one of the app's preferences, refusing a value its key can't hold. */
export const writeAppPreference = async <K extends PreferenceKey>(profile: string, key: K, value: unknown): Promise<AppPreferences[K]> => {
  if (!holds(key, value)) throw new Error(`Althar's ${key} can't be ${JSON.stringify(value)}.`)
  await writePreference(profile, key, value)
  return value
}
