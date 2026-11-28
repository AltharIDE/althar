import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

import { claudeProgram, codexProgram } from '@althar/provider-adapters'
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
  const placedAs = new Map<string, string>()
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
    placedAs.set(target, name)
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await fs.cp(source, target, {
      recursive: true,
      dereference: true,
      filter: async (path) => {
        const parts = relative(source, path).split(/[\\/]/)
        if (path !== source && parts.includes('node_modules')) return false
        // What node-gyp left of compiling a native package (node-pty's): its link to the build machine's Python.
        if (parts.includes('node_gyp_bins')) return false
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
  /** Where each package went, relative to `destination`, by its name. */
  return [...placedAs.entries()].map(([target, name]) => ({ name, path: relative(destination, target).split(/[\\/]/).join('/') }))
}

export interface BundleSource {
  readonly entry: string
  readonly node: string
  readonly version: string
  readonly license?: string
  /**
   * The native worker, built for this release's system. A worker installs from a release of its own (`workerEntry`);
   * the home's carries it too, for workers installed from a home's release before they had their own, until they move.
   */
  readonly worker?: string
  /** The worker's own release's JavaScript (`dist/worker/althar-worker.js`): its setup's commands, without the home. */
  readonly workerEntry?: string
  /**
   * What the worker's agents' sandbox needs beside what Codex's package carries (scripts/worker-sandbox-tools.sh): its
   * `bin` (socat) goes to the release's `tools/bin`, its `licenses` to `tools/licenses`.
   */
  readonly workerTools?: string
}
export const copyHostAssets = async (entry: string, destination: string) => {
  const assets = join(dirname(entry), 'assets')
  try {
    await fs.cp(assets, join(destination, 'assets'), { recursive: true, errorOnExist: true, force: false })
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
    // Builds with a single entry file have no separate assets.
  }
}
/** The license and notices a built entry keeps beside it, or, in a portable release, at its root. */
const copyNotices = async (entry: string, destination: string) => {
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    try {
      await fs.copyFile(join(dirname(entry), name), join(destination, name), constants.COPYFILE_EXCL)
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
      // Built entries keep assets beside the entry; portable releases keep them at their root.
      await fs.copyFile(join(dirname(entry), '..', name), join(destination, name), constants.COPYFILE_EXCL)
    }
  }
}

/** Node, its license and the release's package.json: what every release runs on. */
const copyNode = async (source: BundleSource, destination: string, name: string) => {
  await fs.mkdir(join(destination, 'node/bin'), { recursive: true, mode: 0o700 })
  await fs.copyFile(source.node, join(destination, 'node/bin/node'), constants.COPYFILE_EXCL)
  await fs.chmod(join(destination, 'node/bin/node'), 0o700)
  const license = source.license ?? resolve(dirname(source.node), '..', 'LICENSE')
  await fs.copyFile(license, join(destination, 'node/LICENSE'), constants.COPYFILE_EXCL)
  await writePrivate(
    join(destination, 'package.json'),
    JSON.stringify({ name, type: 'module', version: source.version, license: 'Apache-2.0' }),
    false,
  )
}

/** The native worker and what its agents' sandbox needs beside Codex's package: `tools/bin` and `tools/licenses`. */
const copyWorker = async (source: BundleSource, destination: string) => {
  if (source.worker !== undefined) {
    await fs.copyFile(source.worker, join(destination, 'althar-worker'), constants.COPYFILE_EXCL)
    await fs.chmod(join(destination, 'althar-worker'), 0o700)
  }
  if (source.workerTools !== undefined)
    for (const [part, mode] of [
      ['bin', 0o700],
      ['licenses', 0o600],
    ] as const) {
      const from = join(source.workerTools, part)
      await fs.mkdir(join(destination, 'tools', part), { recursive: true, mode: 0o700 })
      for (const name of await fs.readdir(from)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name) || !(await fs.lstat(join(from, name))).isFile()) throw failed()
        await fs.copyFile(join(from, name), join(destination, 'tools', part, name), constants.COPYFILE_EXCL)
        await fs.chmod(join(destination, 'tools', part, name), mode)
      }
    }
}

/** The agents a worker runs, as their ACP adapters, each with the agent's own program among its dependencies. */
const AGENT_ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']

/**
 * node-pty, which the runtime loads as a terminal first opens: only this machine's build of it. Its package carries
 * every platform's prebuilds and Windows' ConPTY; a Linux home has none of those, as npm compiles it into `build/`.
 */
export const keepOwnPty = async (destination: string) => {
  const folder = join(destination, 'node_modules', 'node-pty')
  const own = `${process.platform}-${process.arch}`
  const prebuilds = join(folder, 'prebuilds')
  for (const name of await fs.readdir(prebuilds).catch(() => [])) if (name !== own) await fs.rm(join(prebuilds, name), { recursive: true })
  if (process.platform !== 'win32') await fs.rm(join(folder, 'third_party'), { recursive: true, force: true })
  const built = await Promise.all(
    [join(folder, 'build', 'Release', 'pty.node'), join(prebuilds, own, 'pty.node')].map((path) =>
      fs.access(path).then(
        () => true,
        () => false,
      ),
    ),
  )
  if (!built.includes(true)) throw failed()
}

const emptyDestination = async (destination: string) => {
  await privateDirectory(destination, true)
  if ((await fs.readdir(destination)).length !== 0) throw failed()
  const dist = join(destination, 'dist')
  await fs.mkdir(dist, { mode: 0o700 })
  return dist
}

/**
 * A home's release: its runtime and the adapters, and none of the agents' own programs, which come on first use
 * (docs/plans/agents-on-first-use.md). Where it carries the worker too, for workers installed from a home's release,
 * it carries the sandbox's bubblewrap and ripgrep in its own `tools/bin`, from Codex's package, before that goes.
 */
export const assembleBundle = async (source: BundleSource, destination: string) => {
  const dist = await emptyDestination(destination)
  await fs.copyFile(source.entry, join(dist, 'althar-host.js'), constants.COPYFILE_EXCL)
  await copyHostAssets(source.entry, dist)
  await copyNotices(source.entry, destination)
  await copyNode(source, destination, '@althar/host-release')
  const placed = await copyDependencies(source.entry, destination, [...AGENT_ADAPTERS, 'sharp', 'node-pty'])
  await keepOwnPty(destination)
  await copyWorker(source, destination)
  const programs = agentPrograms()
  for (const one of placed) {
    const agent = programs.get(one.name)
    if (agent === undefined) continue
    if (agent === 'codex' && source.worker !== undefined) await sandboxFromCodex(join(destination, one.path), destination)
    await fs.rm(join(destination, one.path), { recursive: true, force: true })
  }
}

/**
 * The packages that bring the agents' own programs for this system, as their adapters find them: nearly all of a worker's
 * release, and each a part of its own (parts.ts).
 */
const agentPrograms = (platform: string = process.platform, arch: string = process.arch): ReadonlyMap<string, WorkerAgentId> =>
  new Map([
    ...claudeProgram(platform, arch, false).platforms.map((name) => [name, 'claude-code'] as const),
    ...(codexProgram(platform, arch)?.platforms ?? []).map((name) => [name, 'codex'] as const),
  ])

/**
 * What Codex's package brings that a worker never runs: its voice, a program and the GStreamer libraries it plays sound
 * with (51 MB, 17 MB of the download). Codex talks only where a person speaks to it.
 */
const pruneCodex = async (folder: string) => {
  const vendor = join(folder, 'vendor')
  for (const target of await fs.readdir(vendor).catch(() => [] as string[]))
    await fs.rm(join(vendor, target, 'codex-resources', 'voice'), { recursive: true, force: true })
}

/**
 * The sandbox's bubblewrap and ripgrep, from Codex's package, where every worker has them: in the release's own
 * `tools/bin`, beside socat, so its sandbox starts whichever agents it has, Codex or not.
 */
const sandboxFromCodex = async (folder: string, destination: string) => {
  await fs.mkdir(join(destination, 'tools', 'bin'), { recursive: true, mode: 0o700 })
  const vendor = join(folder, 'vendor')
  for (const target of await fs.readdir(vendor).catch(() => [] as string[]))
    for (const [from, name] of [
      [join(vendor, target, 'codex-resources', 'bwrap'), 'bwrap'],
      [join(vendor, target, 'codex-path', 'rg'), 'rg'],
    ] as const) {
      const to = join(destination, 'tools', 'bin', name)
      await fs.copyFile(from, to, constants.COPYFILE_EXCL)
      await fs.chmod(to, 0o700)
    }
}

/**
 * A worker's own release: its native program, Node, its setup's commands (`dist/althar-worker.js`), the agents' adapters
 * and their own programs, and its sandbox's tools. None of the home: no runtime, store or pictures. Says where its agents'
 * own programs are: the release's parts, which a worker downloads only for the agents signed in on it (parts.ts).
 */
export const assembleWorkerBundle = async (
  source: BundleSource,
  destination: string,
): Promise<{ readonly parts: ReadonlyArray<WorkerPart> }> => {
  if (source.workerEntry === undefined || source.worker === undefined || source.workerTools === undefined) throw failed()
  const dist = await emptyDestination(destination)
  await fs.copyFile(source.workerEntry, join(dist, 'althar-worker.js'), constants.COPYFILE_EXCL)
  await copyHostAssets(source.workerEntry, dist)
  await copyNotices(source.workerEntry, destination)
  await copyNode(source, destination, '@althar/worker-release')
  const placed = await copyDependencies(source.entry, destination, AGENT_ADAPTERS)
  await copyWorker(source, destination)
  const programs = agentPrograms()
  const parts: WorkerPart[] = []
  for (const one of placed) {
    const agent = programs.get(one.name)
    if (agent === undefined) continue
    if (agent === 'codex') {
      await pruneCodex(join(destination, one.path))
      await sandboxFromCodex(join(destination, one.path), destination)
    }
    parts.push({ name: one.name.replace(/^@[^/]+\//u, ''), path: one.path, agent })
  }
  return { parts }
}

/** The agents a worker runs. */
export type WorkerAgentId = 'claude-code' | 'codex'

/** An agent's own program in a worker's release: its name, as its archive says it, its folder there, and whose it is. */
export interface WorkerPart {
  readonly name: string
  readonly path: string
  readonly agent: WorkerAgentId
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
