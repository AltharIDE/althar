import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { isMusl } from '@althar/provider-adapters'
import { x } from 'tar'

/*
 * The tools a worker installs for a project itself (`althar-host worker tools bun@1.3.5 node@24 …`), as its agent unit
 * runs it before the project's setup (apps/worker/src/agent_setup.rs): Bun, Node, pnpm and uv, from their makers' own
 * releases, each checked against the digest its maker publishes beside it, into the worker's own folder
 * (`tools/<name>/<version>`), without root. One installed already is used as it is. It says each tool's folder of
 * programs as `path\t<folder>`, which the run puts first on its PATH, and what it did in a line each; a tool it couldn't
 * install, why, and exits 1, which fails the setup with those words for the task's lead.
 */

export const KNOWN_TOOLS = ['bun', 'node', 'pnpm', 'uv'] as const
export type KnownTool = (typeof KNOWN_TOOLS)[number]

const NAMES: Readonly<Record<KnownTool, string>> = { bun: 'Bun', node: 'Node', pnpm: 'pnpm', uv: 'uv' }
const MAX_DOWNLOAD = 256 * 1024 * 1024
const MAX_INDEX = 32 * 1024 * 1024

export type ToolFetch = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>>; readonly redirect?: 'manual' },
) => Promise<Response>

interface Found {
  readonly version: string
  readonly url: string
  /** How the download is checked: a sha256 in hex, or an npm `integrity` (sha512, base64). */
  readonly digest: { readonly sha256: string } | { readonly integrity: string }
}

const failed = (message: string) => Object.assign(new Error(message), { code: 'ToolFailed' })

/** Whether `version` is what was asked: the same, or of the same major (`24`) or minor (`1.3`). */
export const satisfies = (asked: string, version: string) => {
  const wanted = asked.replace(/^v/u, '')
  return version === wanted || version.startsWith(`${wanted}.`)
}

const newestFirst = (a: string, b: string) => {
  const parts = (version: string) => version.split(/[.-]/u).map((part) => Number.parseInt(part, 10))
  const [left, right] = [parts(a), parts(b)]
  for (let at = 0; at < Math.max(left.length, right.length); at++) {
    const difference = (right[at] ?? 0) - (left[at] ?? 0)
    if (Number.isFinite(difference) && difference !== 0) return difference
  }
  return 0
}
const stable = (version: string) => /^\d+\.\d+\.\d+$/u.test(version)

const read = async (response: Response, limit: number, url: string) => {
  if (!response.ok) throw failed(`${new URL(url).host} answered with HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > limit) throw failed(`${new URL(url).host} sent more than a tool takes.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > limit) throw failed(`${new URL(url).host} sent more than a tool takes.`)
  return bytes
}

const json = async (fetcher: ToolFetch, url: string, headers: Readonly<Record<string, string>> = {}) =>
  JSON.parse((await read(await fetcher(url, { headers }), MAX_INDEX, url)).toString('utf8')) as unknown

/** An npm package's version for what was asked, with its tarball and integrity, from the registry itself. */
const fromNpm = async (fetcher: ToolFetch, name: string, asked: string): Promise<Found> => {
  const document = (await json(fetcher, `https://registry.npmjs.org/${name}`, {
    accept: 'application/vnd.npm.install-v1+json',
  })) as {
    readonly 'dist-tags'?: Readonly<Record<string, string>>
    readonly versions?: Readonly<Record<string, { readonly dist?: { readonly tarball?: string; readonly integrity?: string } }>>
  }
  const versions = Object.keys(document.versions ?? {})
  const version =
    asked === 'latest' ? document['dist-tags']?.latest : versions.filter((one) => stable(one) && satisfies(asked, one)).sort(newestFirst)[0]
  const dist = version === undefined ? undefined : document.versions?.[version]?.dist
  if (version === undefined || dist?.tarball === undefined || dist.integrity === undefined || !dist.tarball.startsWith('https://'))
    throw failed(`No ${asked} of ${name} on npm.`)
  return { version, url: dist.tarball, digest: { integrity: dist.integrity } }
}

/** Node's own release for what was asked (`24`, `22.11.0`, `lts`, `latest`), checked by its SHASUMS256. */
const fromNode = async (fetcher: ToolFetch, asked: string, arch: string): Promise<Found> => {
  const index = (await json(fetcher, 'https://nodejs.org/dist/index.json')) as ReadonlyArray<{
    readonly version: string
    readonly lts: string | false
  }>
  const releases = index.map((release) => ({ ...release, version: release.version.replace(/^v/u, '') }))
  const release =
    asked === 'latest'
      ? releases[0]
      : asked === 'lts'
        ? releases.find((one) => one.lts !== false)
        : releases.filter((one) => satisfies(asked, one.version)).sort((a, b) => newestFirst(a.version, b.version))[0]
  if (release === undefined) throw failed(`Node has no release ${asked}.`)
  const file = `node-v${release.version}-linux-${arch}.tar.gz`
  const folder = `https://nodejs.org/dist/v${release.version}`
  const sums = (await read(await fetcher(`${folder}/SHASUMS256.txt`), 1024 * 1024, folder)).toString('utf8')
  const sha256 = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .find(([, name]) => name === file)?.[0]
  if (sha256 === undefined || !/^[a-f0-9]{64}$/u.test(sha256)) throw failed(`Node ${release.version} has no build for this computer.`)
  return { version: release.version, url: `${folder}/${file}`, digest: { sha256 } }
}

/** uv's own release for what was asked (a version, or `latest`), checked by the sha256 it publishes beside it. */
const fromUv = async (fetcher: ToolFetch, asked: string, target: string): Promise<Found> => {
  let version = asked
  if (asked === 'latest') {
    const answer = await fetcher('https://github.com/astral-sh/uv/releases/latest', { redirect: 'manual' })
    version = /\/tag\/([0-9][0-9A-Za-z.+-]*)$/u.exec(answer.headers.get('location') ?? '')?.[1] ?? ''
    if (version === '') throw failed('GitHub didn’t say which uv is the latest.')
  } else if (!/^\d+\.\d+\.\d+$/u.test(asked)) {
    const releases = (await json(fetcher, 'https://api.github.com/repos/astral-sh/uv/releases?per_page=100')) as ReadonlyArray<{
      readonly tag_name?: string
    }>
    const found = releases
      .map((release) => release.tag_name ?? '')
      .filter((tag) => stable(tag) && satisfies(asked, tag))
      .sort(newestFirst)[0]
    if (found === undefined) throw failed(`uv has no release ${asked}.`)
    version = found
  }
  const url = `https://github.com/astral-sh/uv/releases/download/${version}/uv-${target}.tar.gz`
  const sha256 = (await read(await fetcher(`${url}.sha256`), 4096, url)).toString('utf8').trim().split(/\s+/u)[0] ?? ''
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw failed(`uv ${version} has no build for this computer.`)
  return { version, url, digest: { sha256 } }
}

/** What this computer is, as each maker names its builds. */
export interface ToolPlatform {
  readonly arch: 'x64' | 'arm64'
  readonly musl: boolean
  /** An x64 processor without AVX2 takes Bun's baseline build. */
  readonly avx2: boolean
}

export const platformHere = (): ToolPlatform => {
  const cpu = (() => {
    try {
      return readFileSync('/proc/cpuinfo', 'utf8')
    } catch {
      return ''
    }
  })()
  return { arch: process.arch === 'arm64' ? 'arm64' : 'x64', musl: isMusl(), avx2: /\bavx2\b/u.test(cpu) }
}

const find = (fetcher: ToolFetch, name: KnownTool, asked: string, platform: ToolPlatform): Promise<Found> => {
  switch (name) {
    case 'bun': {
      const arch = platform.arch === 'arm64' ? 'aarch64' : platform.avx2 ? 'x64' : 'x64-baseline'
      return fromNpm(fetcher, `@oven/bun-linux-${arch}${platform.musl ? '-musl' : ''}`, asked)
    }
    case 'pnpm':
      return fromNpm(fetcher, 'pnpm', asked)
    case 'node':
      if (platform.musl) return Promise.reject(failed('Node publishes no build for this system’s C library.'))
      return fromNode(fetcher, asked, platform.arch)
    case 'uv':
      return fromUv(fetcher, asked, `${platform.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-${platform.musl ? 'musl' : 'gnu'}`)
  }
}

const checked = (bytes: Buffer, digest: Found['digest']) =>
  'sha256' in digest
    ? createHash('sha256').update(bytes).digest('hex') === digest.sha256
    : (() => {
        const [algorithm, expected] = digest.integrity.split('-', 2)
        return (algorithm === 'sha512' || algorithm === 'sha256') && createHash(algorithm).update(bytes).digest('base64') === expected
      })()

const shellQuoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/** Lays out what was unpacked into `<version>/bin`, the folder the run's PATH takes; `final`, where `folder` goes after. */
const arrange = async (name: KnownTool, folder: string, final: string) => {
  const bin = join(folder, 'bin')
  switch (name) {
    case 'bun':
      // The package's `bin/bun`; `bunx` is Bun by another name.
      await fs.chmod(join(bin, 'bun'), 0o755)
      await fs.symlink('bun', join(bin, 'bunx')).catch(() => undefined)
      return
    case 'node':
    case 'uv':
      return
    case 'pnpm': {
      // pnpm runs on Node: each of its programs, as the package names them, by the Node on the run's PATH.
      const manifest = JSON.parse(await fs.readFile(join(folder, 'package', 'package.json'), 'utf8')) as { bin?: Record<string, string> }
      await fs.mkdir(bin, { recursive: true, mode: 0o700 })
      for (const [program, file] of Object.entries(manifest.bin ?? {})) {
        if (!/^[a-z][a-z0-9-]*$/u.test(program) || file.includes('..')) continue
        await fs.writeFile(join(bin, program), `#!/bin/sh\nexec node ${shellQuoted(join(final, 'package', file))} "$@"\n`, {
          mode: 0o755,
        })
      }
      return
    }
  }
}

/** Unpacks a download where its programs go: the npm packages whole, Node and uv by their top folder. */
const unpack = async (name: KnownTool, archive: string, folder: string) => {
  switch (name) {
    case 'bun':
      await fs.mkdir(join(folder, 'bin'), { recursive: true, mode: 0o700 })
      return x({ file: archive, cwd: join(folder, 'bin'), strip: 2, filter: (path) => path === 'package/bin/bun' })
    case 'pnpm':
      return x({ file: archive, cwd: folder })
    case 'node':
      return x({ file: archive, cwd: folder, strip: 1 })
    case 'uv':
      await fs.mkdir(join(folder, 'bin'), { recursive: true, mode: 0o700 })
      return x({ file: archive, cwd: join(folder, 'bin'), strip: 1 })
  }
}

/** Installs one tool where it isn't yet, and says its folder of programs. */
export const installTool = async (
  root: string,
  name: KnownTool,
  asked: string,
  out: (text: string) => void,
  fetcher: ToolFetch = fetch,
  platform: ToolPlatform = platformHere(),
) => {
  const tools = join(root, name)
  await fs.mkdir(tools, { recursive: true, mode: 0o700 })
  // One installed already that is what was asked, newest first: no network needed.
  const installed = (await fs.readdir(tools)).filter(
    (one) => !one.startsWith('.') && (asked === 'latest' || asked === 'lts' ? false : satisfies(asked, one)),
  )
  const have = installed.sort(newestFirst)[0]
  if (have !== undefined) {
    out(`path\t${join(tools, have, 'bin')}\n`)
    return
  }
  const found = await find(fetcher, name, asked, platform)
  const target = join(tools, found.version)
  if (
    await fs.stat(target).then(
      () => true,
      () => false,
    )
  ) {
    out(`path\t${join(target, 'bin')}\n`)
    return
  }
  const bytes = await read(await fetcher(found.url), MAX_DOWNLOAD, found.url)
  if (!checked(bytes, found.digest)) throw failed(`The download of ${NAMES[name]} ${found.version} didn’t match its digest.`)
  const scratch = join(tools, `.${found.version}-${process.pid}`)
  await fs.rm(scratch, { recursive: true, force: true })
  await fs.mkdir(scratch, { recursive: true, mode: 0o700 })
  try {
    const archive = join(scratch, '.download')
    await fs.writeFile(archive, bytes, { mode: 0o600 })
    await unpack(name, archive, scratch)
    await fs.rm(archive, { force: true })
    await arrange(name, scratch, target)
    await fs.rename(scratch, target).catch(async (error: unknown) => {
      // Another run installed the same at once: that one stands.
      if (
        !(await fs.stat(target).then(
          () => true,
          () => false,
        ))
      )
        throw error
    })
  } finally {
    await fs.rm(scratch, { recursive: true, force: true })
  }
  out(`Installed ${NAMES[name]} ${found.version}.\n`)
  out(`path\t${join(target, 'bin')}\n`)
}

/** `worker tools <name@version>…`: each installed, in order; the first that can't be stops it, with why. */
export const installTools = async (root: string, specs: ReadonlyArray<string>, out: (text: string) => void, fetcher: ToolFetch = fetch) => {
  for (const spec of specs) {
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at) as KnownTool
    const version = spec.slice(at + 1)
    if (at <= 0 || !KNOWN_TOOLS.includes(name) || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/u.test(version))
      throw failed(`${spec} isn’t a tool a worker installs.`)
    try {
      await installTool(root, name, version, out, fetcher)
    } catch (error) {
      throw failed(`Couldn’t install ${NAMES[name]} ${version}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
