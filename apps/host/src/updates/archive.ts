import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join, posix } from 'node:path'

import { Parser, x, type ReadEntry } from 'tar'

import { HostError } from '../errors'
import { privateDirectory } from '../privateFiles'
import type { ReleaseManifest } from './release'

const unsafe = () =>
  new HostError({
    code: 'ReleaseRejected',
    message: 'The host archive contains unsafe paths, links, permissions, duplicates or unexpected sizes. It will not be installed.',
  })
const inventory = (manifest: Pick<ReleaseManifest, 'files' | 'unpackedBytes'>) => {
  const seen = new Map<string, string>()
  const parents = new Set<string>()
  let files = 0
  let bytes = 0
  return {
    add: (entry: ReadEntry) => {
      const path = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path
      if (
        path === '' ||
        path.length > 1024 ||
        path.includes('\\') ||
        posix.isAbsolute(path) ||
        posix.normalize(path) !== path ||
        path.split('/').some((part) => part === '.' || part === '..' || part === '') ||
        Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw unsafe()
      if (
        !['File', 'Directory'].includes(entry.type) ||
        ((entry.mode ?? 0) & 0o7000) !== 0 ||
        seen.has(path) ||
        seen.size >= manifest.files * 2 + 1000
      )
        throw unsafe()
      if (entry.type === 'File' && parents.has(path)) throw unsafe()
      let parent = posix.dirname(path)
      while (parent !== '.') {
        if (seen.get(parent) === 'File') throw unsafe()
        parents.add(parent)
        parent = posix.dirname(parent)
      }
      seen.set(path, entry.type)
      if (entry.type === 'File') {
        files++
        bytes += entry.size
      }
      if (files > manifest.files || bytes > manifest.unpackedBytes || entry.size < 0 || !Number.isSafeInteger(entry.size)) throw unsafe()
    },
    finish: () => {
      if (files !== manifest.files || bytes !== manifest.unpackedBytes) throw unsafe()
    },
  }
}

/** Validate the entire archive before extracting anything, including PAX-resolved names and entry types. */
export const inspectArchive = async (file: string, manifest: Pick<ReleaseManifest, 'files' | 'unpackedBytes'>, signal?: AbortSignal) => {
  const entries = inventory(manifest)
  const input = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw unsafe()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const source = input.createReadStream()
      const parser = new Parser({
        strict: true,
        maxMetaEntrySize: 4096,
        maxDecompressionRatio: 256,
        onReadEntry: (entry) => {
          try {
            entries.add(entry)
            entry.resume()
          } catch {
            parser.abort(unsafe())
          }
        },
      })
      const abort = () => parser.abort(unsafe())
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        source.destroy()
      }
      parser.once('error', () => {
        cleanup()
        reject(unsafe())
      })
      source.once('error', () => parser.abort(unsafe()))
      parser.once('end', () => {
        cleanup()
        resolve()
      })
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      source.pipe(parser)
    })
  } finally {
    await input.close().catch(() => undefined)
  }
  entries.finish()
}

export const syncReleaseTree = async (folder: string): Promise<void> => {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      await fs.chmod(path, 0o700)
      await syncReleaseTree(path)
    } else if (entry.isFile()) {
      const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const mode = (await file.stat()).mode
        await file.chmod((mode & 0o111) !== 0 ? 0o700 : 0o600)
        await file.sync()
      } finally {
        await file.close()
      }
    } else throw unsafe()
  }
  const directory = await fs.open(folder, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export const extractRelease = async (
  archive: string,
  destination: string,
  manifest: Pick<ReleaseManifest, 'files' | 'unpackedBytes'>,
  signal?: AbortSignal,
) => {
  await inspectArchive(archive, manifest, signal)
  await privateDirectory(destination, true)
  if ((await fs.readdir(destination)).length !== 0) throw unsafe()
  try {
    await x({
      file: archive,
      cwd: destination,
      strict: true,
      preservePaths: false,
      preserveOwner: false,
      noMtime: true,
      umask: 0o077,
      dmode: 0o700,
      fmode: 0o600,
      maxMetaEntrySize: 4096,
      maxDecompressionRatio: 256,
    })
    signal?.throwIfAborted()
    await syncReleaseTree(destination)
  } catch {
    throw unsafe()
  }
}
