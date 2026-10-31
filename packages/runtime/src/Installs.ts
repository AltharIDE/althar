import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
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
  cleanUp,
  isMusl,
  type LaunchSpec,
  locate,
  type Located,
  type PinnedDownload,
  programName,
  removeFully,
} from '@althar/provider-adapters'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { Unzip, UnzipInflate } from 'fflate'

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
  readonly search?: { readonly env: Readonly<Record<string, string | undefined>>; readonly dirs: ReadonlyArray<string> }
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
const pinned = (download: AgentDownload): download is PinnedDownload => 'version' in download

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
    /** Where its command is, looked up now: the person's, or Althar's copy. */
    locate(definition: AgentDefinition): Located | null
    /** Downloads its latest release, checks it and makes it the copy in use. */
    install(definition: AgentDefinition): Effect.Effect<void, InstallFailed>
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

        /** Where Althar's downloaded copy of the agent's command is, whether or not it is there. */
        const kept = (definition: AgentDefinition, name: string) =>
          root === undefined ? null : join(root, definition.id, 'current', programName(name, platform))

        const locateOf = (definition: AgentDefinition): Located | null => {
          const cli = definition.cli
          if (cli === undefined) return null
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
            if (there !== null) return outThere(there)
          }
          const copies = { bundled: cli.bundled?.() ?? null, kept: keptCopy }
          const here = locate(cli.name, copies, {
            platform,
            ...(options.search === undefined ? {} : { env: options.search.env, dirs: options.search.dirs }),
          })
          if (here !== null || onDevice === undefined || onDevice.reachable) return here
          // The device cannot be reached, and there is no copy here: the run goes out there anyway, so the person hears what to put right, not "isn't installed".
          return outThere(cli.name)
        }

        /** The agent's latest release, and its file for this device with the digest GitHub gives it. */
        const latest = (definition: AgentDefinition, install: Exclude<AgentDownload, PinnedDownload>) =>
          Effect.gen(function* () {
            const asset = assetOf(install.assets)
            if (asset === undefined) return yield* fail(definition.id, `There's no ${definition.name} for this computer to download.`)
            const response = yield* Effect.tryPromise({
              try: () =>
                fetch(`https://api.github.com/repos/${install.repository}/releases/latest`, {
                  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Althar' },
                }),
              catch: (error) => fail(definition.id, `GitHub couldn't be reached to find ${definition.name}.`, error),
            })
            if (!response.ok)
              return yield* fail(definition.id, `GitHub didn't say where ${definition.name}'s latest release is.`, response.status)
            const body = (yield* Effect.tryPromise({
              try: () => response.json() as Promise<unknown>,
              catch: (error) => fail(definition.id, `GitHub's answer about ${definition.name} couldn't be read.`, error),
            })) as {
              readonly tag_name?: unknown
              readonly assets?: ReadonlyArray<{
                readonly name?: unknown
                readonly browser_download_url?: unknown
                readonly digest?: unknown
              }>
            }
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

        const download = (definition: AgentDefinition, name: string, install: AgentDownload, folder: string) =>
          Effect.gen(function* () {
            const release = pinned(install) ? yield* pinnedRelease(definition, install) : yield* latest(definition, install)
            const response = yield* Effect.tryPromise({
              try: () => fetch(release.url, { headers: { 'User-Agent': 'Althar' } }),
              catch: (error) => fail(definition.id, `${definition.name} couldn't be downloaded.`, error),
            })
            if (!response.ok) return yield* fail(definition.id, `${definition.name} couldn't be downloaded.`, response.status)
            const bytes = Buffer.from(
              yield* Effect.tryPromise({
                try: () => response.arrayBuffer(),
                catch: (error) => fail(definition.id, `${definition.name}'s download stopped part-way.`, error),
              }),
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

        const install = (definition: AgentDefinition): Effect.Effect<void, InstallFailed> =>
          Effect.gen(function* () {
            const cli = definition.cli
            const spec = cli?.download
            if (cli === undefined || spec === undefined || root === undefined)
              return yield* fail(definition.id, `Althar can't download ${definition.name}.`)
            const already = yield* Ref.modify(installing, (now) => [now.has(definition.id), new Set([...now, definition.id])])
            if (already) return yield* fail(definition.id, `${definition.name} is already downloading.`)
            const home = join(root, definition.id)
            const folder = join(home, `.download-${randomUUID()}`)
            yield* Effect.gen(function* () {
              mkdirSync(folder, { recursive: true })
              const { release, command, whole } = yield* download(definition, cli.name, spec, folder)
              // The version's folder holds the command alone, or all a pinned archive held; `current` moves to it in one step.
              const version = join(home, release.tag)
              yield* removeFully(version).pipe(
                Effect.mapError((failed) => fail(definition.id, `${definition.name} couldn't be kept on this computer.`, failed.reason)),
              )
              if (whole !== undefined) renameSync(whole, version)
              else {
                mkdirSync(version)
                renameSync(command, join(version, programName(cli.name, platform)))
              }
              const next = join(home, `.current-${randomUUID()}`)
              // A junction on Windows, which needs no administrator, and an absolute target; a relative link elsewhere.
              if (platform === 'win32') symlinkSync(version, next, 'junction')
              else symlinkSync(release.tag, next)
              // Windows can't rename over a junction, so the old one goes first; elsewhere the rename replaces it in one step.
              // The link alone, never recursively, so nothing of the version it points at goes with it; a step of the install's own.
              // oxlint-disable-next-line althar/one-removal
              if (platform === 'win32') rmSync(join(home, 'current'), { force: true })
              renameSync(next, join(home, 'current'))
              // Versions before the one in use go, with what any earlier download left; one an agent still runs from stays.
              for (const entry of readdirSync(home))
                if (entry !== release.tag && entry !== 'current')
                  yield* cleanUp(join(home, entry), `an earlier ${definition.name} Althar downloaded`)
            }).pipe(
              Effect.catchDefect((defect) =>
                Effect.fail(fail(definition.id, `${definition.name} couldn't be kept on this computer.`, defect)),
              ),
              Effect.ensuring(cleanUp(folder, `where ${definition.name} was downloaded`)),
              Effect.ensuring(Ref.update(installing, (now) => new Set([...now].filter((id) => id !== definition.id)))),
            )
          })

        return Installs.of({
          locate: locateOf,
          state: (definition) =>
            Effect.map(Ref.get(installing), (now) => ({
              located: locateOf(definition),
              downloadable:
                definition.cli?.download !== undefined &&
                root !== undefined &&
                assetOf<unknown>(definition.cli.download.assets) !== undefined,
              size: definition.cli?.download?.size ?? null,
              pinned: definition.cli?.download !== undefined && pinned(definition.cli.download) ? definition.cli.download.version : null,
              installing: now.has(definition.id),
            })),
          install,
        })
      }),
    )
}
