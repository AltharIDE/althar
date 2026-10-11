import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/*
 * latest-mac.yml, the feed the updater reads (ADR-023): electron-builder
 * writes each package's size and SHA-512 into it. Stapling a ticket to the
 * dmg changes the dmg, so its entry is written again from the file as it is
 * now. Everything else in the feed stays as electron-builder wrote it.
 */

/** The feed with the entry for `name` saying `sha512` and `size`; fails where the feed has no entry for it. */
export const withFile = (feed: string, name: string, sha512: string, size: number): string => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entry = new RegExp(`(- url: ${escaped}\\n(\\s+))sha512: \\S+\\n\\s+size: \\d+`)
  if (!entry.test(feed)) throw new Error(`The feed has no entry for ${name}`)
  return feed.replace(entry, (_whole, head: string, indent: string) => `${head}sha512: ${sha512}\n${indent}size: ${size}`)
}

/** Writes the entry for a package in the feed again, from the package as it is now. */
export const refresh = (feed: string, file: string) => {
  const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64')
  writeFileSync(feed, withFile(readFileSync(feed, 'utf8'), basename(file), sha512, statSync(file).size))
}

/** A package the feed names, as it says it is. */
export interface FeedEntry {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

/** The packages the feed names, and the one it points the updater at (`path`, with its digest). */
export const entriesOf = (feed: string) => {
  const files = [...feed.matchAll(/- url: (\S+)\n\s+sha512: (\S+)\n\s+size: (\d+)/g)].map(([, url, sha512, size]): FeedEntry => ({
    url: url ?? '',
    sha512: sha512 ?? '',
    size: Number(size),
  }))
  const path = /^path: (\S+)$/m.exec(feed)?.[1] ?? null
  const sha512 = /^sha512: (\S+)$/m.exec(feed)?.[1] ?? null
  return { files, path, sha512 }
}

/**
 * What in the feed doesn't match the packages beside it: a package missing,
 * of another size, or with another digest, or the updater's own path not
 * among the packages or not matching its entry. Empty when it all holds.
 */
export const mismatches = (feed: string, folder: string, expected: ReadonlyArray<string>): ReadonlyArray<string> => {
  const { files, path, sha512 } = entriesOf(feed)
  const found: Array<string> = []
  for (const name of expected) if (!files.some((file) => file.url === name)) found.push(`The feed has no entry for ${name}.`)
  for (const file of files) {
    let bytes: Buffer
    try {
      bytes = readFileSync(join(folder, file.url))
    } catch {
      found.push(`${file.url} is in the feed but not beside it.`)
      continue
    }
    if (bytes.length !== file.size) found.push(`${file.url} is ${bytes.length} bytes; the feed says ${file.size}.`)
    if (createHash('sha512').update(bytes).digest('base64') !== file.sha512) found.push(`${file.url}'s digest isn't the feed's.`)
  }
  const pointed = files.find((file) => file.url === path)
  if (pointed === undefined) found.push(`The feed's path, ${path ?? 'none'}, isn't one of its packages.`)
  else if (pointed.sha512 !== sha512) found.push(`The feed's digest for ${pointed.url} differs between its entry and its path.`)
  return found
}
