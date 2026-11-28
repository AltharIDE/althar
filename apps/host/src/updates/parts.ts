import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { HostError } from '../errors'
import { extractRelease } from './archive'
import { downloadRelease, type UpdateFetch } from './network'
import type { ReleasePart } from './release'

/*
 * A worker's release in parts (release.ts `ReleaseParts`). Nearly all of a worker's release is its agents' own programs,
 * Claude Code's and Codex's, which change less often than Althar does: from host 0.2.0 to 0.3.0, Claude Code's not once.
 * So each is a part of its own, known by what it holds (`treeDigest`), and a worker puts a release together from its base
 * and its parts: a part the release it runs already has is lent from it, hard-linked where they share a disk, and only
 * the rest is downloaded. A part's folder lands inside the release, as in a whole one, so everything that finds a
 * program there (Node's resolution, the sandbox's AppArmor rule for `bundle-…/**`) finds it the same.
 */

const rejected = () =>
  new HostError({
    code: 'ReleaseRejected',
    message: 'A part of the worker release doesn’t hold what its signed manifest says. It will not be installed.',
  })

const hashFile = async (path: string) => {
  const hash = createHash('sha256')
  const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk as Buffer)
  } finally {
    await file.close()
  }
  return hash.digest('hex')
}

/**
 * What a folder holds, whichever archive brought it or however it was compressed: each file's path, whether it runs,
 * its size and its SHA-256, in order. Only regular files and folders; a link or anything else is refused.
 */
export const treeDigest = async (folder: string): Promise<string> => {
  const lines: string[] = []
  const walk = async (at: string): Promise<void> => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const stat = await fs.lstat(path)
        const name = relative(folder, path).split(sep).join('/')
        lines.push(`${name}\0${(stat.mode & 0o100) !== 0 ? 'x' : '-'}\0${stat.size}\0${await hashFile(path)}`)
      } else throw rejected()
    }
  }
  await walk(folder)
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex')
}

/** A copy of a folder that costs nothing on the same disk: each file hard-linked, or copied where it can't be. */
const lend = async (from: string, to: string): Promise<void> => {
  await fs.mkdir(to, { mode: 0o700 })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await lend(source, target)
    else if (entry.isFile())
      await fs.link(source, target).catch(async () => {
        await fs.copyFile(source, target, constants.COPYFILE_EXCL)
        await fs.chmod(target, ((await fs.lstat(source)).mode & 0o100) !== 0 ? 0o700 : 0o600)
      })
    else throw rejected()
  }
}

const isFolder = (path: string) =>
  fs.lstat(path).then(
    (stat) => stat.isDirectory(),
    () => false,
  )

export const freeBytes = async (folder: string) => {
  const found = await fs.statfs(folder)
  return found.bavail * found.bsize
}

/** This computer's disk hasn't the room for a part: `needed` bytes, its archive and what it unpacks to. */
export class NoRoom extends Error {
  constructor(readonly needed: number) {
    super(`This computer needs ${Math.ceil(needed / 1_048_576)} MB free for the worker’s agents.`)
  }
}

export interface Completed {
  /** The parts lent from a release already here, by name. */
  readonly lent: ReadonlyArray<string>
  /** The parts downloaded, by name, and their archives' bytes in all. */
  readonly downloaded: ReadonlyArray<string>
  /** The parts left out, by name, where only lending was asked for. */
  readonly missing: ReadonlyArray<string>
  readonly bytes: number
}

/**
 * Puts each part into `release`: kept where it is there already and holds what it should, lent from the first of
 * `donors` (releases already on this computer) that has it, else downloaded, checked against its signed digest and
 * size, unpacked and checked against what it should hold. `scratch` is an empty private folder on the same disk.
 * `progress` hears the bytes downloaded so far, out of what all the parts this needs downloaded weigh.
 */
export const completeRelease = async (
  release: string,
  parts: ReadonlyArray<ReleasePart>,
  options: {
    readonly donors: ReadonlyArray<string>
    readonly scratch: string
    readonly fetcher?: UpdateFetch | undefined
    readonly signal?: AbortSignal
    readonly progress?: (bytes: number) => void
    /** The bytes free on the disk a folder is on. */
    readonly free?: (folder: string) => Promise<number>
    /** Only what a donor lends: a part none has is left out, and said in `missing`. */
    readonly lendOnly?: boolean
  },
): Promise<Completed> => {
  const lent: string[] = []
  const downloaded: string[] = []
  const missing: string[] = []
  let bytes = 0
  for (const [index, part] of parts.entries()) {
    const at = join(release, part.path)
    if (await isFolder(at)) {
      if ((await treeDigest(at)) === part.tree) continue
      await fs.rm(at, { recursive: true, force: true })
    }
    let donor: string | undefined
    for (const other of options.donors) {
      const from = join(other, part.path)
      if (from !== at && (await isFolder(from)) && (await treeDigest(from).catch(() => undefined)) === part.tree) {
        donor = from
        break
      }
    }
    const staged = join(options.scratch, `part-${index}`)
    await fs.rm(staged, { recursive: true, force: true })
    if (donor !== undefined) {
      await lend(donor, staged)
      lent.push(part.name)
    } else if (options.lendOnly === true) {
      missing.push(part.name)
      continue
    } else {
      const file = join(options.scratch, `part-${index}.archive`)
      await fs.rm(file, { force: true })
      // Its archive and what it unpacks to, at once, with room to spare: else it would fail partway, in words that blame
      // the archive.
      if ((await (options.free ?? freeBytes)(options.scratch)) < part.bytes + part.unpackedBytes + 64 * 1_048_576)
        throw new NoRoom(part.bytes + part.unpackedBytes)
      try {
        await downloadRelease(part, file, options.fetcher, options.signal, undefined, (received) => options.progress?.(bytes + received))
        await extractRelease(file, staged, part, options.signal)
      } finally {
        await fs.rm(file, { force: true })
      }
      if ((await treeDigest(staged)) !== part.tree) throw rejected()
      bytes += part.bytes
      options.progress?.(bytes)
      downloaded.push(part.name)
    }
    await fs.mkdir(dirname(at), { recursive: true, mode: 0o700 })
    await fs.rename(staged, at)
  }
  return { lent, downloaded, missing, bytes }
}
