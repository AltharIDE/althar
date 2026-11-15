import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

import { Schema } from 'effect'

import { HostError } from '../errors'
import { privateDirectory, writePrivate } from '../privateFiles'

const Package = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependenciesMeta: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optional(Schema.Boolean) }))),
  os: Schema.optional(Schema.Array(Schema.String)),
  cpu: Schema.optional(Schema.Array(Schema.String)),
  libc: Schema.optional(Schema.Array(Schema.String)),
})
const decodePackage = Schema.decodeUnknownSync(Package)
const failed = () =>
  new HostError({
    code: 'UpdateFailed',
    message: 'A complete host release could not be assembled from the installed, locked dependencies.',
  })
const validName = (name: string) => /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)
const matches = (values: ReadonlyArray<string> | undefined, target: string) =>
  values === undefined || (!values.includes(`!${target}`) && (!values.some((value) => !value.startsWith('!')) || values.includes(target)))
const packageAt = async (from: string, name: string): Promise<string | undefined> => {
  if (!validName(name)) throw failed()
  for (const folder of createRequire(from).resolve.paths(name) ?? []) {
    const candidate = join(folder, name)
    try {
      await fs.access(join(candidate, 'package.json'))
      return await fs.realpath(candidate)
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
  return undefined
}

/** Copy the actual locked dependency graph, including Bun's applied patches; never resolve fresh npm ranges. */
export const copyDependencies = async (from: string, destination: string, names: ReadonlyArray<string>) => {
  const placements = new Map<string, string>()
  const root = join(destination, 'node_modules')
  const place = async (name: string, source: string, consumer: string, optional = false): Promise<void> => {
    const metadata = decodePackage(JSON.parse(await fs.readFile(join(source, 'package.json'), 'utf8')))
    // Official Node Linux releases target glibc. Bun may have fetched musl or
    // other optional binaries too; those do not belong in this native bundle.
    if (!matches(metadata.os, process.platform) || !matches(metadata.cpu, process.arch) || !matches(metadata.libc, 'glibc')) {
      if (optional) return
      throw failed()
    }
    let parent = consumer
    for (;;) {
      const found = placements.get(join(parent, 'node_modules', name))
      if (found === source) return
      // Node stops at the nearest visible package. A conflicting ancestor
      // shadows an otherwise matching root copy, so this consumer needs its own.
      if (found !== undefined) break
      if (parent === destination) break
      const next = dirname(parent)
      if (next === parent || relative(destination, next).startsWith('..')) break
      parent = next
    }
    const global = join(root, name)
    const target = placements.has(global) ? join(consumer, 'node_modules', name) : global
    if (placements.has(target)) throw failed()
    placements.set(target, source)
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await fs.cp(source, target, {
      recursive: true,
      dereference: true,
      filter: async (path) => {
        if (path !== source && relative(source, path).split(/[\\/]/).includes('node_modules')) return false
        if ((await fs.lstat(path)).isSymbolicLink() && relative(source, await fs.realpath(path)).startsWith('..')) throw failed()
        return true
      },
    })
    const optionalDependencies = metadata.optionalDependencies ?? {}
    const peers = metadata.peerDependencies ?? {}
    const dependencies = new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(optionalDependencies), ...Object.keys(peers)])
    for (const dependency of dependencies) {
      const located = await packageAt(join(source, 'package.json'), dependency)
      if (located === undefined) {
        if (dependency in optionalDependencies || metadata.peerDependenciesMeta?.[dependency]?.optional === true) continue
        throw failed()
      }
      await place(
        dependency,
        located,
        target,
        dependency in optionalDependencies || metadata.peerDependenciesMeta?.[dependency]?.optional === true,
      )
    }
  }
  for (const name of names) {
    const source = await packageAt(from, name)
    if (source === undefined) throw failed()
    await place(name, source, destination)
  }
}

export interface BundleSource {
  readonly entry: string
  readonly node: string
  readonly version: string
  readonly license?: string
}
export const assembleBundle = async (source: BundleSource, destination: string) => {
  await privateDirectory(destination, true)
  if ((await fs.readdir(destination)).length !== 0) throw failed()
  const dist = join(destination, 'dist')
  await fs.mkdir(dist, { mode: 0o700 })
  await fs.copyFile(source.entry, join(dist, 'althar-host.js'), constants.COPYFILE_EXCL)
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    try {
      await fs.copyFile(join(dirname(source.entry), name), join(destination, name), constants.COPYFILE_EXCL)
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
      // Built entries keep assets beside the entry; portable releases keep them at their root.
      await fs.copyFile(join(dirname(source.entry), '..', name), join(destination, name), constants.COPYFILE_EXCL)
    }
  }
  await fs.mkdir(join(destination, 'node/bin'), { recursive: true, mode: 0o700 })
  await fs.copyFile(source.node, join(destination, 'node/bin/node'), constants.COPYFILE_EXCL)
  await fs.chmod(join(destination, 'node/bin/node'), 0o700)
  const license = source.license ?? resolve(dirname(source.node), '..', 'LICENSE')
  await fs.copyFile(license, join(destination, 'node/LICENSE'), constants.COPYFILE_EXCL)
  await writePrivate(
    join(destination, 'package.json'),
    JSON.stringify({ name: '@althar/host-release', type: 'module', version: source.version, license: 'Apache-2.0' }),
    false,
  )
  await copyDependencies(source.entry, destination, ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'])
}

/** Publicly readable is fine; another user must not be able to change the selected trust anchor. */
export const readReleaseKey = async (path: string) => {
  let file: fs.FileHandle | undefined
  try {
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.size > 4096 ||
      (stat.mode & 0o022) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid() && stat.uid !== 0)
    )
      throw failed()
    const buffer = Buffer.alloc(4097)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 4096) throw failed()
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } catch {
    throw new HostError({
      code: 'UpdateNotConfigured',
      message: 'Supply a regular, protected host-release public key file from an independently trusted source.',
    })
  } finally {
    await file?.close().catch(() => undefined)
  }
}
