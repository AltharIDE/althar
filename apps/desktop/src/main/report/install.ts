import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * This install's id: a random UUID made the first time it is asked for and
 * kept in the profile as install.json, so reports, and later crash reports
 * and analytics, can be matched up without saying who anyone is. It is
 * nothing but random: no machine, account or person goes into it. A file
 * that is missing, or doesn't hold one, gets a new one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const isInstallId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

const fileIn = (profile: string) => join(profile, 'install.json')

/* The id of each profile asked about, once read or made. */
const ids = new Map<string, Promise<string>>()

/** The id kept in the profile, made and kept there the first time. Asked for twice at once, it is made once. */
export const installId = (profile: string): Promise<string> => {
  const known = ids.get(profile)
  if (known !== undefined) return known
  const making = (async () => {
    try {
      const kept: unknown = JSON.parse(await readFile(fileIn(profile), 'utf8'))
      if (typeof kept === 'object' && kept !== null && 'id' in kept && isInstallId(kept.id)) return kept.id
    } catch {
      // None yet, or not one: a new one.
    }
    const id = randomUUID()
    await mkdir(profile, { recursive: true })
    await writeFile(fileIn(profile), `${JSON.stringify({ id, createdAt: new Date().toISOString() }, null, 2)}\n`)
    return id
  })().catch((error: unknown) => {
    ids.delete(profile)
    throw error
  })
  ids.set(profile, making)
  return making
}
