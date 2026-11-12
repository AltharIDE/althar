import { existsSync, rmSync, writeFileSync } from 'node:fs'

import type { Holds } from './FakeAgent'

/** Holds shared with a fake agent in another process, for the named markers only. */
export const fileHolds = (files: Readonly<Record<string, string>>): Holds & {
  readonly close: (marker: string) => void
  readonly waiting: (marker: string) => boolean
} => {
  const fileOf = (marker: string) => {
    const file = files[marker]
    if (file === undefined) throw new Error(`No file holds ${marker}`)
    return file
  }
  return {
    has: (marker) => files[marker] !== undefined,
    opened: (marker) => {
      const file = files[marker]
      if (file === undefined) return false
      if (!existsSync(`${file}.waiting`)) writeFileSync(`${file}.waiting`, '')
      return existsSync(file)
    },
    waiting: (marker) => existsSync(`${fileOf(marker)}.waiting`),
    open: (marker) => writeFileSync(fileOf(marker), ''),
    close: (marker) => {
      const file = fileOf(marker)
      rmSync(file, { force: true })
      rmSync(`${file}.waiting`, { force: true })
    },
  }
}
