import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

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
