import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * The desktop app's own preferences, kept in the profile beside its database
 * as desktop.json, so a test's profile keeps its own: the app's icon, and
 * where Althar shows while you work in another app. Each is a key of its
 * own; writing one keeps the rest, one write at a time.
 */

const fileIn = (profile: string) => join(profile, 'desktop.json')

/** What the file holds, or nothing where there is none or it isn't an object. */
export const readPreferences = async (profile: string): Promise<Record<string, unknown>> => {
  try {
    const read: unknown = JSON.parse(await readFile(fileIn(profile), 'utf8'))
    return typeof read === 'object' && read !== null && !Array.isArray(read) ? (read as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/* Writes in the order they were asked for, so two at once can't each keep the other's old value. */
let writing: Promise<unknown> = Promise.resolve()

/** Keeps one preference, and whatever else the file holds, making the profile where there is none. */
export const writePreference = (profile: string, key: string, value: unknown): Promise<void> => {
  const write = writing.then(async () => {
    const kept = await readPreferences(profile)
    await mkdir(profile, { recursive: true })
    await writeFile(fileIn(profile), `${JSON.stringify({ ...kept, [key]: value }, null, 2)}\n`)
  })
  writing = write.catch(() => undefined)
  return write
}
