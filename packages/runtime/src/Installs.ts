import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Fetch } from '@althar/connectors'
import { type AgentDefinition, type AgentInstall, locate, type Located } from '@althar/provider-adapters'
import { Context, Effect, Layer, Ref, Schema } from 'effect'

/*
 * Agents Althar downloads for a person who doesn't have one (docs/
 * architecture/03): only an agent whose license lets anyone fetch and run
 * its releases, and only when the person asks. Its latest release on
 * GitHub, the file for this platform and processor, checked against the
 * sha256 GitHub publishes for it before anything in it runs, unpacked into
 * a folder of its own under the profile, `<root>/<agent>/<version>`, with
 * `current` pointing at the one in use. It asks the command its version
 * before it is used, and the version before stays until the new one is
 * ready. Nothing is put on the person's PATH, and their own install, where
 * they have one, is always the one that runs (provider-adapters' installs).
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
  /** A download of it is under way. */
  readonly installing: boolean
}

export interface InstallsOptions {
  /** Where downloaded agents are kept; without it, Althar downloads none. */
  readonly root?: string | undefined
  readonly fetch?: Fetch | undefined
  readonly platform?: string
  readonly arch?: string
  /** Where the person's own commands are looked for: their PATH and the usual places; tests give their own. */
  readonly search?: { readonly env: { readonly PATH?: string | undefined }; readonly dirs: ReadonlyArray<string> }
}

interface Release {
  readonly tag: string
  readonly url: string
  readonly digest: string
}

const fail = (agentId: string, summary: string, reason: unknown = summary) =>
  new InstallFailed({ agentId, summary, reason: reason instanceof Error ? reason.message : String(reason) })

const run = (command: string, args: ReadonlyArray<string>, timeout = 60_000) =>
  Effect.callback<string, Error>((resume) => {
    execFile(command, [...args], { timeout }, (error, stdout, stderr) =>
      resume(error === null ? Effect.succeed(stdout) : Effect.fail(new Error(`${error.message}\n${stderr}`))),
    )
  })

/** The first file named `name` under `dir`, a level or two down, as archives nest it. */
const findIn = (dir: string, name: string, depth = 3): string | null => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (entry === name && statSync(path).isFile()) return path
    if (depth > 0 && statSync(path).isDirectory()) {
      const found = findIn(path, name, depth - 1)
      if (found !== null) return found
    }
  }
  return null
}

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
        const target = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`
        const installing = yield* Ref.make(new Set<string>())

        /** Where Althar's copy of the agent's command is, whether or not it is there. */
        const kept = (definition: AgentDefinition, install: AgentInstall) =>
          root === undefined ? null : join(root, definition.id, 'current', install.command)

        const locateOf = (definition: AgentDefinition): Located | null =>
          definition.install === undefined
            ? null
            : options.search === undefined
              ? locate(definition.install.command, kept(definition, definition.install))
              : locate(definition.install.command, kept(definition, definition.install), options.search.env, options.search.dirs)

        /** The agent's latest release, and its file for this device with the digest GitHub gives it. */
        const latest = (definition: AgentDefinition, install: AgentInstall) =>
          Effect.gen(function* () {
            const asset = install.assets[target]
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

        const download = (definition: AgentDefinition, install: AgentInstall, folder: string) =>
          Effect.gen(function* () {
            const release = yield* latest(definition, install)
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
            // Nothing in it runs unless it is exactly the file GitHub says the release has.
            if (createHash('sha256').update(bytes).digest('hex') !== release.digest)
              return yield* fail(definition.id, `${definition.name}'s download didn't match its release, so Althar didn't keep it.`)
            const archive = join(folder, install.assets[target] ?? 'download')
            writeFileSync(archive, bytes)
            const unpacked = join(folder, 'unpacked')
            mkdirSync(unpacked)
            // bsdtar, as macOS has, unpacks a zip as well as a gzipped tar.
            yield* run('tar', ['-xf', archive, '-C', unpacked]).pipe(
              Effect.mapError((error) => fail(definition.id, `${definition.name}'s download couldn't be unpacked.`, error)),
            )
            const command = findIn(unpacked, install.command)
            if (command === null) return yield* fail(definition.id, `${definition.name}'s download has no ${install.command} in it.`)
            chmodSync(command, 0o755)
            yield* run(command, ['--version'], 30_000).pipe(
              Effect.mapError((error) => fail(definition.id, `The downloaded ${definition.name} wouldn't run on this computer.`, error)),
            )
            return { release, command }
          })

        const install = (definition: AgentDefinition): Effect.Effect<void, InstallFailed> =>
          Effect.gen(function* () {
            const spec = definition.install
            if (spec === undefined || root === undefined) return yield* fail(definition.id, `Althar can't download ${definition.name}.`)
            const already = yield* Ref.modify(installing, (now) => [now.has(definition.id), new Set([...now, definition.id])])
            if (already) return yield* fail(definition.id, `${definition.name} is already downloading.`)
            const home = join(root, definition.id)
            const folder = join(home, `.download-${randomUUID()}`)
            yield* Effect.gen(function* () {
              mkdirSync(folder, { recursive: true })
              const { release, command } = yield* download(definition, spec, folder)
              // The version's folder holds the command alone; `current` moves to it in one step.
              const version = join(home, release.tag)
              rmSync(version, { recursive: true, force: true })
              mkdirSync(version)
              renameSync(command, join(version, spec.command))
              const next = join(home, `.current-${randomUUID()}`)
              symlinkSync(release.tag, next)
              renameSync(next, join(home, 'current'))
              // Versions before the one in use go, with what any earlier download left.
              for (const entry of readdirSync(home))
                if (entry !== release.tag && entry !== 'current') rmSync(join(home, entry), { recursive: true, force: true })
            }).pipe(
              Effect.catchDefect((defect) =>
                Effect.fail(fail(definition.id, `${definition.name} couldn't be kept on this computer.`, defect)),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  if (existsSync(folder)) rmSync(folder, { recursive: true, force: true })
                }),
              ),
              Effect.ensuring(Ref.update(installing, (now) => new Set([...now].filter((id) => id !== definition.id)))),
            )
          })

        return Installs.of({
          locate: locateOf,
          state: (definition) =>
            Effect.map(Ref.get(installing), (now) => ({
              located: locateOf(definition),
              downloadable: definition.install !== undefined && root !== undefined && definition.install.assets[target] !== undefined,
              size: definition.install?.size ?? null,
              installing: now.has(definition.id),
            })),
          install,
        })
      }),
    )
}
