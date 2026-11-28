import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createWriteStream,
  linkSync,
  readFileSync,
  statfsSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

import type { Fetch } from '@althar/connectors'
import {
  type AgentDefinition,
  type AgentDownload,
  agentVersion,
  cleanUp,
  isMusl,
  type LaunchSpec,
  locate,
  type Located,
  type NpmDownload,
  type PinnedDownload,
  programName,
  removeFully,
} from '@althar/provider-adapters'
import { Context, Duration, Effect, Layer, Option, Ref, Schema } from 'effect'
import { Unzip, UnzipInflate } from 'fflate'
import { makeKeyedLock } from './keyedLock'

/*
 * Agents Althar downloads for a person who doesn't have one (docs/
 * architecture/03): only an agent whose license lets anyone fetch and run
 * its releases, or whose maker publishes them for any ACP client to run, and
 * only when the person asks. Either its latest release on GitHub, the file
 * for this platform and processor, checked against the sha256 GitHub
 * publishes for it, and the command asked its version; or one version from
 * its maker's address, the archive and each file in it checked against the
 * sha256 it was pinned by (Antigravity's server), all kept together. Nothing
 * in it runs before then. It is unpacked into a folder of its own under the
 * profile, `<root>/<agent>/<version>`, with `current` pointing at the one in
 * use, and the version before stays until the new one is ready. Nothing is
 * put on the person's PATH, and their own install, where they have one, is
 * always the one that runs (provider-adapters' installs).
 */

export class InstallFailed extends Schema.TaggedError<InstallFailed>()('InstallFailed', {
  agentId: Schema.String,
  /** Everything that went wrong, for the log. */
  reason: Schema.String,
  /** What went wrong, in a sentence a person reads. */
  summary: Schema.String,
}) {}

/** A release's metadata, including its response body, must arrive within this time. */
export const RELEASE_WITHIN = Duration.seconds(30)

/** Large archives, including the pinned server, have longer; a stalled body still ends the download. */
export const DOWNLOAD_WITHIN = Duration.minutes(10)

/** Where an agent stands on this device, for Settings: where its command is, and whether Althar can fetch it. */
export interface InstallState {
  /** Where its command is, whose; null where it is nowhere. */
  readonly located: Located | null
  /** Althar can download it here: it says where, for this platform, and Althar keeps agents somewhere. */
  readonly downloadable: boolean
  /** About how big the download is. */
  readonly size: string | null
  /** The one version it is pinned at, from its maker's address (Antigravity's server); null for a GitHub release's latest. */
  readonly pinned: string | null
  /** A download of it is under way. */
  readonly installing: boolean
  /** Althar's download is the only way to have it, and its maker publishes none for this platform and processor. */
  readonly noBuild: boolean
}

/**
 * The device outside this process's sandbox: where the person's own commands
 * are, and how one runs there. A Flatpak's app fills it in — the sandbox
 * cannot see the person's installs, `flatpak-spawn` reaches them — and every
 * other way of running has none, so nothing changes (the desktop binds it).
 */
export interface OnDevice {
  /** Whether the device can be reached at all; where it can't, a run still goes out there so the failure says what to put right (`words.ts`). */
  readonly reachable: boolean
  /** Where a command by this name is on the device: its full path, or null where it isn't there. */
  where(command: string): string | null
  /** How a launch that names one of the person's own commands runs on the device, with this cwd and environment. */
  run(spec: LaunchSpec, at: { readonly cwd?: string; readonly env: Readonly<Record<string, string | undefined>> }): LaunchSpec
}

export interface InstallsOptions {
  /** Where downloaded agents are kept; without it, Althar downloads none. */
  readonly root?: string | undefined
  readonly fetch?: Fetch | undefined
  readonly platform?: string
  readonly arch?: string
  /** A Linux on musl, as Alpine is, which takes the release's musl build where it has one. */
  readonly musl?: boolean
  /** Where the person's own commands are looked for: their PATH and the usual places; tests give their own. */
  readonly search?: { readonly env: Readonly<Record<string, string | undefined>>; readonly dirs: ReadonlyArray<string> } | undefined
  /**
   * The device outside a sandbox that cannot see it (a Flatpak): the person's
   * own commands are found and run out there, before any copy that is here;
   * without it, everything is looked for and run here, as always.
   */
  readonly onDevice?: OnDevice | undefined
}

interface Release {
  readonly tag: string
  readonly url: string
  readonly digest: string
}

/** A download from its maker's own address, pinned, rather than a GitHub release. */
const pinned = (download: AgentDownload): download is PinnedDownload => 'version' in download && !('npm' in download)

/** The exact npm package the lockfile pins (Claude Code's and Codex's programs). */
const fromNpm = (download: AgentDownload): download is NpmDownload => 'npm' in download

/** Hears a download's bytes as they come, and its whole where known. */
export type Progress = (received: number, total: number | undefined) => void

/** The bytes free on the disk a folder is on; undefined where that can't be said. */
const freeBytes = (folder: string): number | undefined => {
  try {
    mkdirSync(folder, { recursive: true })
    const found = statfsSync(folder)
    return found.bavail * found.bsize
  } catch {
    return undefined
  }
}

/** A copy of a folder that costs nothing on the same disk: each file hard-linked, or copied where it can't be; no links. */
const lendInto = (from: string, to: string): void => {
  mkdirSync(to, { recursive: true, mode: 0o700 })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) lendInto(source, target)
    else if (entry.isFile())
      try {
        linkSync(source, target)
      } catch {
        copyFileSync(source, target)
        chmodSync(target, lstatSync(source).mode & 0o777)
      }
  }
}

/** About how big a download is, as the person reads it. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

/** Ten minutes, or as long as the download takes at 128 KiB/s where that's longer: a slow line still gets it. */
const downloadWithin = (bytes: number | undefined) =>
  bytes === undefined ? DOWNLOAD_WITHIN : Duration.max(DOWNLOAD_WITHIN, Duration.seconds(Math.ceil(bytes / 131_072)))

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A file's sha256, read a few megabytes at a time: Antigravity's server is nearly 1 GB. */
const fileSha256 = (path: string) => {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const chunk = Buffer.alloc(4 << 20)
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) hash.update(chunk.subarray(0, read))
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * Unpacks a zip into `folder`, a file at a time as it is read, so a large one
 * is never whole in memory unpacked: only the files it is expected to hold,
 * each at its top, nothing else (no folder, no link, no other name).
 */
const unzipInto = (bytes: Uint8Array, folder: string, names: ReadonlySet<string>) =>
  new Promise<void>((resolve, reject) => {
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    const open = new Set<number>()
    let failed = false
    const failWith = (error: Error) => {
      if (failed) return
      failed = true
      for (const fd of open) closeSync(fd)
      reject(error)
    }
    unzip.onfile = (file) => {
      if (failed) return
      if (!names.has(file.name)) return failWith(new Error(`It holds ${file.name}, which it shouldn't.`))
      const fd = openSync(join(folder, file.name), 'w', 0o700)
      open.add(fd)
      file.ondata = (error, chunk, final) => {
        if (failed) return
        if (error !== null) return failWith(error)
        writeSync(fd, chunk)
        if (final) {
          closeSync(fd)
          open.delete(fd)
        }
      }
      file.start()
    }
    try {
      const step = 1 << 20
      for (let at = 0; at < bytes.length && !failed; at += step) unzip.push(bytes.subarray(at, at + step), at + step >= bytes.length)
    } catch (error) {
      return failWith(error instanceof Error ? error : new Error(String(error)))
    }
    if (!failed) resolve()
  })

const fail = (agentId: string, summary: string, reason: unknown = summary) =>
  new InstallFailed({ agentId, summary, reason: reason instanceof Error ? reason.message : String(reason) })

/** Uses the runtime's clock: timing out interrupts the request and aborts its signal before the install is cleaned up. */
const within = <A>(effect: Effect.Effect<A, InstallFailed>, bound: Duration.Duration, error: InstallFailed) =>
  Effect.flatMap(Effect.timeoutOption(effect, bound), (result) =>
    Option.isSome(result) ? Effect.succeed(result.value) : Effect.fail(error),
  )

/** The bsdtar this computer has. */
const tarHere = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

const run = (command: string, args: ReadonlyArray<string>, timeout = 60_000) =>
  Effect.callback<string, Error>((resume) => {
    execFile(command, [...args], { timeout, windowsHide: true }, (error, stdout, stderr) =>
      resume(error === null ? Effect.succeed(stdout) : Effect.fail(new Error(`${error.message}\n${stderr}`))),
    )
  })

/**
 * The first file named `name` under `dir`, a level or two down, as archives
 * nest it. Never by a link: a link in the archive could point at a file the
 * digest never covered, so neither a linked file nor a linked folder counts.
 */
const findIn = (dir: string, name: string, depth = 3): string | null => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const found = lstatSync(path)
    if (found.isSymbolicLink()) continue
    if (entry === name && found.isFile()) return path
    if (depth > 0 && found.isDirectory()) {
      const found = findIn(path, name, depth - 1)
      if (found !== null) return found
    }
  }
  return null
}

/** Whether the agent can be started here: one with no command of its own always can, any other where its command is found. */
export const isInstalled = (installs: Pick<Installs['Service'], 'locate'>, definition: AgentDefinition): boolean =>
  definition.cli === undefined || installs.locate(definition) !== null

export class Installs extends Context.Service<
  Installs,
  {
    /** Where the agent stands on this device. */
    state(definition: AgentDefinition): Effect.Effect<InstallState>
    /** The agent's CLI version, shared by every client of this runtime. */
    version(definition: AgentDefinition): Effect.Effect<string | null>
    /** Where its command is, looked up now: the person's, or Althar's copy. */
    locate(definition: AgentDefinition): Located | null
    /** Where Althar's own copy of its command is kept, whether or not it is there yet; null where Althar keeps none. */
    keptAt(definition: AgentDefinition): string | null
    /** Downloads its latest release, checks it and makes it the copy in use; `progress` hears the bytes as they come. */
    install(definition: AgentDefinition, progress?: Progress): Effect.Effect<void, InstallFailed>
    /** Keeps the pinned package from a folder already here, as its download would have (`adopt` above); false where it isn't one. */
    adopt(definition: AgentDefinition, from: string): Effect.Effect<boolean, InstallFailed>
  }
>()('@althar/runtime/Installs') {
  static readonly layer = (options: InstallsOptions): Layer.Layer<Installs> =>
    Layer.effect(
      Installs,
      Effect.gen(function* () {
        const root = options.root
        const fetch = options.fetch ?? globalThis.fetch
        const platform = options.platform ?? process.platform
        const target = `${platform}-${options.arch ?? process.arch}`
        const musl = options.musl ?? isMusl(platform)
        /** The release's file for this computer: musl's build on a musl Linux where there is one. */
        const assetOf = <A>(assets: Readonly<Record<string, A>>): A | undefined =>
          musl ? (assets[`${target}-musl`] ?? assets[target]) : assets[target]
        const installing = yield* Ref.make(new Set<string>())
        const versions = new Map<string, string>()
        const versionChecks = makeKeyedLock()
        const version = (definition: AgentDefinition) =>
          versionChecks.withLock(
            definition.id,
            Effect.suspend(() => {
              const cached = versions.get(definition.id)
              if (cached !== undefined) return Effect.succeed(cached)
              return Effect.map(agentVersion(definition), (found) => {
                if (found !== null) versions.set(definition.id, found)
                return found
              })
            }),
          )

        /**
         * Where Althar's downloaded copy of the agent's command is, whether or not it is there: in a package it keeps
         * whole, where the package has it.
         */
        const kept = (definition: AgentDefinition, name: string) => {
          if (root === undefined) return null
          const spec = definition.cli?.download
          if (spec !== undefined && fromNpm(spec)) {
            const asset = assetOf(spec.assets)
            return asset === undefined ? null : join(root, definition.id, 'current', ...asset.program.split('/'))
          }
          return join(root, definition.id, 'current', programName(name, platform))
        }

        const locateOf = (definition: AgentDefinition): Located | null => {
          const cli = definition.cli
          if (cli === undefined) return null
          if (cli.managed === true)
            return locate(cli.name, { bundled: cli.bundled?.() ?? null, kept: kept(definition, cli.name) }, { platform, env: {}, dirs: [] })
          const fits = cli.fits === undefined ? {} : { fits: cli.fits }
          const onDevice = options.onDevice
          const outThere = (command: string): Located =>
            onDevice === undefined
              ? { command, whose: 'theirs' }
              : { command, whose: 'theirs', out: (spec) => (at) => onDevice.run(spec, at) }
          const keptCopy = cli.download === undefined ? null : kept(definition, cli.name)
          // In a sandbox that cannot see the device, a copy downloaded at the person's asking keeps running in the sandbox, where it was kept;
          // the person's own install on the device is the one that runs where they have none of Althar's.
          if (onDevice?.reachable === true) {
            const downloaded =
              keptCopy === null ? null : locate(cli.name, { bundled: null, kept: keptCopy }, { platform, env: {}, dirs: [] })
            if (downloaded !== null) return downloaded
            const there = onDevice.where(cli.name)
            if (there !== null && (cli.fits === undefined || cli.fits(there))) return outThere(there)
          }
          const copies = { bundled: cli.bundled?.() ?? null, kept: keptCopy }
          const here = locate(cli.name, copies, {
            platform,
            ...fits,
            ...(options.search === undefined ? {} : { env: options.search.env, dirs: options.search.dirs }),
          })
          if (here !== null || onDevice === undefined || onDevice.reachable) return here
          // The device cannot be reached, and there is no copy here: the run goes out there anyway, so the person hears what to put right, not "isn't installed".
          return outThere(cli.name)
        }

        /** The agent's latest release, or the newest on its line, and its file for this device with the digest GitHub gives it. */
        const latest = (definition: AgentDefinition, install: Exclude<AgentDownload, PinnedDownload | NpmDownload>) =>
          Effect.gen(function* () {
            const asset = assetOf(install.assets)
            if (asset === undefined) return yield* fail(definition.id, `There's no ${definition.name} for this computer to download.`)
            const line = install.line
            // One abort signal spans headers and body: ending the headers' effect must not cancel the body still being read.
            const answer = yield* within(
              Effect.tryPromise({
                try: async (signal): Promise<unknown> => {
                  const response = await fetch(
                    `https://api.github.com/repos/${install.repository}/releases${line === undefined ? '/latest' : '?per_page=30'}`,
                    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Althar' }, signal },
                  )
                  if (!response.ok)
                    throw fail(definition.id, `GitHub didn't say where ${definition.name}'s latest release is.`, response.status)
                  return await response.json().catch((error: unknown) => {
                    throw fail(definition.id, `GitHub's answer about ${definition.name} couldn't be read.`, error)
                  })
                },
                catch: (error) =>
                  error instanceof InstallFailed
                    ? error
                    : fail(definition.id, `GitHub couldn't be reached to find ${definition.name}.`, error),
              }),
              RELEASE_WITHIN,
              fail(definition.id, `GitHub took too long to find ${definition.name}. Try again.`),
            )
            type Answer = {
              readonly tag_name?: unknown
              readonly draft?: unknown
              readonly prerelease?: unknown
              readonly assets?: ReadonlyArray<{
                readonly name?: unknown
                readonly browser_download_url?: unknown
                readonly digest?: unknown
              }>
            }
            // Newest first, as GitHub lists them: the first published release on the line.
            const body: Answer =
              line === undefined
                ? (answer as Answer)
                : ((Array.isArray(answer) ? (answer as ReadonlyArray<Answer>) : []).find(
                    (each) =>
                      each.draft !== true &&
                      each.prerelease !== true &&
                      typeof each.tag_name === 'string' &&
                      each.tag_name.startsWith(line),
                  ) ?? {})
            const found = body.assets?.find((each) => each.name === asset)
            const digest = typeof found?.digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(found.digest)?.[1] : undefined
            if (typeof body.tag_name !== 'string' || !/^[\w.-]{1,40}$/.test(body.tag_name) || found === undefined)
              return yield* fail(definition.id, `${definition.name}'s latest release has no download for this computer.`)
            if (digest === undefined || typeof found.browser_download_url !== 'string')
              return yield* fail(definition.id, `${definition.name}'s download can't be checked, so Althar won't run it.`)
            return { tag: body.tag_name, url: found.browser_download_url, digest } satisfies Release
          })

        /** The one version pinned, from its maker's address, by the sha256 it was seen with. */
        const pinnedRelease = (definition: AgentDefinition, install: PinnedDownload) => {
          const asset = assetOf(install.assets)
          return asset === undefined
            ? Effect.fail(fail(definition.id, `There's no ${definition.name} for this computer to download.`))
            : Effect.succeed({ tag: install.version, url: asset.url, digest: asset.sha256 } satisfies Release)
        }

        /**
         * The package the lockfile pins for this platform, streamed to disk as its sha512 is taken, so a large one is
         * never whole in memory; kept only where that is the integrity pinned; unpacked whole, what never runs
         * removed, and its program asked its version, so one that doesn't run here is never kept.
         */
        const npmPackage = (definition: AgentDefinition, install: NpmDownload, folder: string, progress?: Progress) =>
          Effect.gen(function* () {
            const asset = assetOf(install.assets)
            if (asset === undefined) return yield* fail(definition.id, `There's no ${definition.name} for this computer to download.`)
            // Room for the package and what it unpacks to, at once, before any of it comes: else it would fail part-way.
            if (asset.bytes !== undefined && root !== undefined) {
              const needed = asset.bytes * 4
              const free = yield* Effect.sync(() => freeBytes(root))
              if (free !== undefined && free < needed)
                return yield* fail(definition.id, `${definition.name} needs ${megabytes(needed)} free on this computer to download.`)
            }
            const archive = join(folder, 'package.tgz')
            const integrity = yield* within(
              Effect.tryPromise({
                try: async (signal) => {
                  const response = await fetch(asset.tarball, { headers: { 'User-Agent': 'Althar' }, signal })
                  if (!response.ok || response.body === null)
                    throw fail(definition.id, `${definition.name} couldn't be downloaded.`, response.status)
                  const hash = createHash('sha512')
                  const out = createWriteStream(archive, { mode: 0o600 })
                  let received = 0
                  try {
                    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
                      hash.update(chunk)
                      received += chunk.length
                      progress?.(received, asset.bytes)
                      if (!out.write(chunk)) await once(out, 'drain')
                    }
                  } catch (error) {
                    out.destroy()
                    throw fail(definition.id, `${definition.name}'s download stopped part-way.`, error)
                  }
                  await new Promise<void>((done, failed) => out.end((error?: Error | null) => (error ? failed(error) : done())))
                  return `sha512-${hash.digest('base64')}`
                },
                catch: (error) =>
                  error instanceof InstallFailed ? error : fail(definition.id, `${definition.name} couldn't be downloaded.`, error),
              }),
              downloadWithin(asset.bytes),
              fail(definition.id, `Downloading ${definition.name} took too long. Try again.`),
            )
            // Nothing in it runs unless it is exactly the package the adapter's lockfile pins.
            if (integrity !== asset.integrity)
              return yield* fail(definition.id, `${definition.name}'s download didn't match the one Althar pins, so Althar didn't keep it.`)
            const unpacked = join(folder, 'unpacked')
            mkdirSync(unpacked)
            yield* run(tarHere, ['-xzf', archive, '-C', unpacked], 300_000).pipe(
              Effect.mapError((error) => fail(definition.id, `${definition.name}'s download couldn't be unpacked.`, error)),
            )
            // npm packs a package under `package/`.
            const whole = join(unpacked, 'package')
            for (const part of asset.prune)
              yield* removeFully(join(whole, ...part.split('/'))).pipe(
                Effect.mapError((failed) => fail(definition.id, `${definition.name} couldn't be kept on this computer.`, failed.reason)),
              )
            const command = join(whole, ...asset.program.split('/'))
            if (!existsSync(command) || lstatSync(command).isSymbolicLink())
              return yield* fail(definition.id, `${definition.name}'s download has no ${asset.program} in it.`)
            chmodSync(command, 0o755)
            yield* run(command, ['--version'], 60_000).pipe(
              Effect.mapError((error) => fail(definition.id, `The downloaded ${definition.name} wouldn't run on this computer.`, error)),
            )
            return { release: { tag: asset.version, url: asset.tarball, digest: asset.integrity } satisfies Release, command, whole }
          })

        const download = (definition: AgentDefinition, name: string, install: AgentDownload, folder: string, progress?: Progress) =>
          Effect.gen(function* () {
            if (fromNpm(install)) return yield* npmPackage(definition, install, folder, progress)
            const release = pinned(install) ? yield* pinnedRelease(definition, install) : yield* latest(definition, install)
            const bytes = yield* within(
              Effect.tryPromise({
                try: async (signal) => {
                  const response = await fetch(release.url, { headers: { 'User-Agent': 'Althar' }, signal })
                  if (!response.ok || response.body === null)
                    throw fail(definition.id, `${definition.name} couldn't be downloaded.`, response.status)
                  // Read as it comes, so whoever asked hears how far it has got, out of what its server says it is.
                  const said = Number(response.headers.get('content-length'))
                  const total = Number.isSafeInteger(said) && said > 0 ? said : undefined
                  const chunks: Uint8Array[] = []
                  let received = 0
                  try {
                    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
                      chunks.push(chunk)
                      received += chunk.length
                      progress?.(received, total)
                    }
                  } catch (error) {
                    throw fail(definition.id, `${definition.name}'s download stopped part-way.`, error)
                  }
                  return Buffer.concat(chunks)
                },
                catch: (error) =>
                  error instanceof InstallFailed ? error : fail(definition.id, `${definition.name} couldn't be downloaded.`, error),
              }),
              DOWNLOAD_WITHIN,
              fail(definition.id, `Downloading ${definition.name} took too long. Try again.`),
            )
            // Nothing in it runs unless it is exactly the file GitHub says the release has, or the one it was pinned by.
            if (sha256(bytes) !== release.digest)
              return yield* fail(definition.id, `${definition.name}'s download didn't match its release, so Althar didn't keep it.`)
            const unpacked = join(folder, 'unpacked')
            mkdirSync(unpacked)
            if (pinned(install)) {
              // A zip of exactly the files it was pinned with, each checked, all kept together: what it holds runs together.
              const files = assetOf(install.assets)?.files ?? {}
              const program = programName(name, platform)
              yield* Effect.tryPromise({
                try: () => unzipInto(bytes, unpacked, new Set(Object.keys(files))),
                catch: (error) => fail(definition.id, `${definition.name}'s download couldn't be unpacked.`, error),
              })
              for (const [file, digest] of Object.entries(files)) {
                const path = join(unpacked, file)
                if (!existsSync(path) || fileSha256(path) !== digest)
                  return yield* fail(
                    definition.id,
                    `${definition.name}'s download didn't hold what it was pinned with, so Althar didn't keep it.`,
                  )
                chmodSync(path, 0o755)
              }
              if (!(program in files)) return yield* fail(definition.id, `${definition.name}'s download has no ${program} in it.`)
              return { release, command: join(unpacked, program), whole: unpacked }
            }
            const archive = join(folder, assetOf(install.assets) ?? 'download')
            writeFileSync(archive, bytes)
            // bsdtar, as macOS and Windows have, unpacks a zip as well as a gzipped tar: on Windows its own, by its path, as
            // Git's GNU tar may come first on the PATH, which takes neither a zip nor a drive (C:) in a path.
            yield* run(tarHere, ['-xf', archive, '-C', unpacked]).pipe(
              Effect.mapError((error) => fail(definition.id, `${definition.name}'s download couldn't be unpacked.`, error)),
            )
            const program = programName(name, platform)
            const command = findIn(unpacked, program)
            if (command === null) return yield* fail(definition.id, `${definition.name}'s download has no ${program} in it.`)
            chmodSync(command, 0o755)
            yield* run(command, ['--version'], 30_000).pipe(
              Effect.mapError((error) => fail(definition.id, `The downloaded ${definition.name} wouldn't run on this computer.`, error)),
            )
            return { release, command, whole: undefined }
          })

        /**
         * Makes `tag`'s folder the copy in use: what `place` puts there, then `current` moved to it in one step, and the
         * versions before it gone, with what any earlier download left; one an agent still runs from stays.
         */
        const keep = (definition: AgentDefinition, tag: string, place: (version: string) => void) =>
          Effect.gen(function* () {
            const home = join(root ?? '', definition.id)
            const version = join(home, tag)
            yield* removeFully(version).pipe(
              Effect.mapError((failed) => fail(definition.id, `${definition.name} couldn't be kept on this computer.`, failed.reason)),
            )
            place(version)
            const next = join(home, `.current-${randomUUID()}`)
            // A junction on Windows, which needs no administrator, and an absolute target; a relative link elsewhere.
            if (platform === 'win32') symlinkSync(version, next, 'junction')
            else symlinkSync(tag, next)
            // Windows can't rename over a junction, so the old one goes first; elsewhere the rename replaces it in one step.
            // The link alone, never recursively, so nothing of the version it points at goes with it; a step of the install's own.
            // oxlint-disable-next-line althar/one-removal
            if (platform === 'win32') rmSync(join(home, 'current'), { force: true })
            renameSync(next, join(home, 'current'))
            for (const entry of readdirSync(home))
              if (entry !== tag && entry !== 'current' && !entry.startsWith('.'))
                yield* cleanUp(join(home, entry), `an earlier ${definition.name} Althar downloaded`)
          })

        /** Runs `work` as the agent's one install under way, and leaves its scratch folder clean however it ends. */
        const asTheInstall = <A>(definition: AgentDefinition, scratch: string, work: Effect.Effect<A, InstallFailed>) =>
          Effect.gen(function* () {
            const already = yield* Ref.modify(installing, (now) => [now.has(definition.id), new Set([...now, definition.id])])
            if (already) return yield* fail(definition.id, `${definition.name} is already downloading.`)
            return yield* Effect.suspend(() => {
              mkdirSync(scratch, { recursive: true })
              return work
            }).pipe(
              Effect.catchDefect((defect) =>
                Effect.fail(fail(definition.id, `${definition.name} couldn't be kept on this computer.`, defect)),
              ),
              Effect.ensuring(cleanUp(scratch, `where ${definition.name} was downloaded`)),
              Effect.ensuring(Ref.update(installing, (now) => new Set([...now].filter((id) => id !== definition.id)))),
            )
          })

        const install = (definition: AgentDefinition, progress?: Progress): Effect.Effect<void, InstallFailed> =>
          Effect.gen(function* () {
            const cli = definition.cli
            const spec = cli?.download
            if (cli === undefined || spec === undefined || root === undefined)
              return yield* fail(definition.id, `Althar can't download ${definition.name}.`)
            const folder = join(root, definition.id, `.download-${randomUUID()}`)
            yield* asTheInstall(
              definition,
              folder,
              Effect.gen(function* () {
                const { release, command, whole } = yield* download(definition, cli.name, spec, folder, progress)
                // The version's folder holds the command alone, or all a pinned archive or package held.
                yield* keep(definition, release.tag, (version) => {
                  if (whole !== undefined) renameSync(whole, version)
                  else {
                    mkdirSync(version)
                    renameSync(command, join(version, programName(cli.name, platform)))
                  }
                })
              }),
            )
          })

        /**
         * Keeps the package the lockfile pins from a folder already on this computer (a worker's release from before
         * programs came on first use carries it), without downloading it: only where it is that package at that version
         * with its program, linked rather than copied where the disk allows. False where it isn't, or Althar keeps none.
         */
        const adopt = (definition: AgentDefinition, from: string): Effect.Effect<boolean, InstallFailed> =>
          Effect.gen(function* () {
            const spec = definition.cli?.download
            if (spec === undefined || !fromNpm(spec) || root === undefined) return false
            const asset = assetOf(spec.assets)
            if (asset === undefined) return false
            const manifest = yield* Effect.sync(() => {
              try {
                return JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')) as {
                  readonly name?: unknown
                  readonly version?: unknown
                }
              } catch {
                return undefined
              }
            })
            // The package's own manifest names it as the lockfile does (Codex's platform packages are `@openai/codex` too).
            if (manifest?.name !== asset.name || manifest.version !== asset.version) return false
            const program = join(from, ...asset.program.split('/'))
            if (!existsSync(program) || lstatSync(program).isSymbolicLink()) return false
            const folder = join(root, definition.id, `.adopt-${randomUUID()}`)
            yield* asTheInstall(
              definition,
              folder,
              Effect.gen(function* () {
                const staged = join(folder, 'package')
                yield* Effect.sync(() => lendInto(from, staged))
                for (const part of asset.prune)
                  yield* removeFully(join(staged, ...part.split('/'))).pipe(
                    Effect.mapError((failed) =>
                      fail(definition.id, `${definition.name} couldn't be kept on this computer.`, failed.reason),
                    ),
                  )
                yield* keep(definition, asset.version, (version) => renameSync(staged, version))
              }),
            )
            return true
          })

        /** How big its download is here: a pinned package's own size, else what its maker's release is about. */
        const sizeOf = (spec: AgentDownload | undefined): string | null => {
          if (spec === undefined) return null
          if (!fromNpm(spec)) return spec.size
          const bytes = assetOf(spec.assets)?.bytes
          return bytes === undefined ? null : megabytes(bytes)
        }

        return Installs.of({
          locate: locateOf,
          keptAt: (definition) => (definition.cli?.download === undefined ? null : kept(definition, definition.cli.name)),
          version,
          state: (definition) =>
            Effect.map(Ref.get(installing), (now) => ({
              located: locateOf(definition),
              downloadable:
                definition.cli?.download !== undefined &&
                root !== undefined &&
                assetOf<unknown>(definition.cli.download.assets) !== undefined,
              size: sizeOf(definition.cli?.download),
              pinned:
                definition.cli?.download !== undefined && (pinned(definition.cli.download) || fromNpm(definition.cli.download))
                  ? definition.cli.download.version
                  : null,
              installing: now.has(definition.id),
              noBuild:
                definition.cli?.download !== undefined &&
                definition.cli.guide === undefined &&
                assetOf<unknown>(definition.cli.download.assets) === undefined,
            })),
          adopt,
          install: (definition, progress) =>
            install(definition, progress).pipe(
              Effect.tap(() =>
                versionChecks.withLock(
                  definition.id,
                  Effect.sync(() => versions.delete(definition.id)),
                ),
              ),
            ),
        })
      }),
    )
}
