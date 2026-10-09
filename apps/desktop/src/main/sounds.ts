import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * The Mac's own alert sounds, which a notification can play by name: the
 * ones in System Settings › Sound, read from where macOS keeps them. Settings
 * offers them and plays one when it is chosen, so the person hears what a
 * notification will sound like. Nothing is bundled; off a Mac there are none.
 */

const SOUNDS = '/System/Library/Sounds'

/** The alert sounds here, by name, in order; none off a Mac or where they can't be read. */
export const alertSounds = async (folder = SOUNDS, platform: NodeJS.Platform = process.platform): Promise<ReadonlyArray<string>> => {
  if (platform !== 'darwin') return []
  try {
    return (await readdir(folder))
      .filter((file) => file.endsWith('.aiff'))
      .map((file) => file.slice(0, -'.aiff'.length))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** Plays one of them once, as a notification would; anything that isn't one of them is refused. */
export const playSound = async (name: unknown, folder = SOUNDS): Promise<void> => {
  const known = await alertSounds(folder)
  if (typeof name !== 'string' || !known.includes(name)) throw new Error(`The Mac has no sound ${String(name)}.`)
  await new Promise<void>((resolve) => execFile('afplay', [join(folder, `${name}.aiff`)], () => resolve()))
}
