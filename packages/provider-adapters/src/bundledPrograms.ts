import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/*
 * Claude Code and Codex come with Althar: an adapter Althar starts, which
 * starts the agent's own program from a package for this platform and
 * processor, an optional dependency of the agent's SDK. A package manager can
 * leave that package out (its download failed, or it is still under way), and
 * Node then finds any other copy of it further up, of another version. On 24
 * November 2026 claude-agent-acp 0.110.1 found Claude Code 2.1.326 that way,
 * hoisted for a package still on 0.108.0, and every start failed with a bare
 * "Internal error": the older program refused the newer SDK's
 * `--initialize-fields=settings`. So before each start the program is looked
 * for as its SDK would find it, and checked against the SDK's own version.
 *
 * It reads two small package.json files and looks for one file: no process,
 * no network. Read afresh each time, so a program installed meanwhile is
 * found at the next start, with nothing to restart.
 */

/** Finds a package's file from the package at `from`, as Node does for that package's own `require`. */
export type Resolver = (from: string, request: string) => string

const nodeResolver: Resolver = (from, request) => createRequire(from).resolve(request)

const versionAt = (manifest: string): string | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { readonly version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/** A release's own number, past a platform's suffix: Codex's `0.171.0-darwin-arm64` is 0.171.0. */
const releaseOf = (version: string) => /^\d+\.\d+\.\d+/.exec(version)?.[0] ?? version

interface Bundled {
  /** The agent's name, as the person reads it. */
  readonly name: string
  /** The adapter Althar starts, by its package. */
  readonly adapter: string
  /** The package the adapter depends on that brings the program, and names the version it needs. */
  readonly sdk: string
  /** What of it to resolve, whose folder is its own: its package.json, or its main entry where it exports no package.json. */
  readonly sdkEntry: string | undefined
  /** The packages for this platform it looks in, in order. */
  readonly platforms: ReadonlyArray<string>
  /** The program, relative to its platform package's folder. */
  readonly program: string
}

/**
 * Why the program an adapter starts can't run beside it, in a sentence that
 * says what failed; undefined where it can. `from` is where the adapter is
 * found from, Althar's own package.
 */
export const bundledProblem = (bundled: Bundled, from: string, resolve: Resolver = nodeResolver): string | undefined => {
  let sdkFolder: string
  try {
    const adapterManifest = resolve(from, `${bundled.adapter}/package.json`)
    sdkFolder = dirname(resolve(adapterManifest, bundled.sdkEntry === undefined ? bundled.sdk : `${bundled.sdk}/${bundled.sdkEntry}`))
  } catch {
    // No adapter or no SDK is a broken install in its own words, said by the adapter as it starts.
    return undefined
  }
  const needs = versionAt(join(sdkFolder, 'package.json'))
  if (needs === undefined) return undefined
  const sdkManifest = join(sdkFolder, 'package.json')
  for (const platform of bundled.platforms) {
    let manifest: string
    try {
      manifest = resolve(sdkManifest, `${platform}/package.json`)
    } catch {
      continue
    }
    const has = versionAt(manifest)
    if (!existsSync(join(dirname(manifest), bundled.program))) continue
    if (has === undefined || releaseOf(has) === releaseOf(needs)) return undefined
    return `${bundled.name}'s own program is version ${releaseOf(has)}, and its adapter needs ${releaseOf(needs)}.`
  }
  return `${bundled.name}'s own program for this computer (${bundled.platforms[0]} ${releaseOf(needs)}) is missing.`
}

/** The platform packages the Agent SDK looks in for Claude Code, as its adapter's `claudeCliPath` does. */
const claudePlatforms = (platform: string, arch: string, musl: boolean) => {
  const base = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  return platform !== 'linux' ? [base] : musl ? [`${base}-musl`, base] : [base, `${base}-musl`]
}

/** Codex's Rust target, as `@openai/codex`'s `bin/codex.js` names them. */
const CODEX_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

/** Claude Code's program, as claude-agent-acp finds it. */
export const claudeProgram = (platform: string, arch: string, musl: boolean): Bundled => ({
  name: 'Claude Code',
  adapter: '@agentclientprotocol/claude-agent-acp',
  sdk: '@anthropic-ai/claude-agent-sdk',
  // Its main entry, sdk.mjs, is in its own folder: it exports no package.json.
  sdkEntry: undefined,
  platforms: claudePlatforms(platform, arch, musl),
  program: platform === 'win32' ? 'claude.exe' : 'claude',
})

/** Codex's program, as codex-acp finds it through `@openai/codex`; undefined on a platform Codex has no build for. */
export const codexProgram = (platform: string, arch: string): Bundled | undefined => {
  const target = CODEX_TARGETS[`${platform}-${arch}`]
  if (target === undefined) return undefined
  return {
    name: 'Codex',
    adapter: '@agentclientprotocol/codex-acp',
    sdk: '@openai/codex',
    sdkEntry: 'package.json',
    platforms: [`@openai/codex-${platform}-${arch}`],
    program: join('vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex'),
  }
}

/** A release's parts as numbers: `2.1.331` is [2, 1, 331]; undefined where it isn't one. */
const partsOf = (version: string): readonly [number, number, number] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * The version of an install of an agent, read from where it is installed, without running it: the package.json of
 * the npm package it is (one of `packages`, its platform builds included), or the folder of its version that its own
 * installer or Homebrew keeps it in (`…/claude/versions/2.1.331`, `…/Cellar/codex/0.172.0/…`). Undefined where
 * neither says.
 */
export const installedVersion = (
  path: string,
  packages: ReadonlyArray<string>,
  folders: ReadonlyArray<string>,
  read: (file: string) => string | undefined = (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
  },
  real: (file: string) => string = realpathSync,
): string | undefined => {
  let at: string
  try {
    at = real(path)
  } catch {
    return undefined
  }
  const segments = at.split(/[\\/]/u)
  // Its installer's or Homebrew's folder of versions: `<name>/versions/<v>`, `Cellar/<name>/<v>`, `Caskroom/<name>/<v>`.
  for (let index = 1; index < segments.length; index++) {
    const segment = segments[index] ?? ''
    const before = segments[index - 1] ?? ''
    const twoBefore = segments[index - 2] ?? ''
    if (partsOf(segment) === undefined) continue
    if (before === 'versions' && folders.includes(twoBefore)) return segment
    if ((twoBefore === 'Cellar' || twoBefore === 'Caskroom') && folders.includes(before)) return segment
  }
  // The npm package it is part of, a few folders up.
  let folder = dirname(at)
  for (let depth = 0; depth < 6; depth++) {
    const manifest = read(join(folder, 'package.json'))
    if (manifest !== undefined)
      try {
        const parsed = JSON.parse(manifest) as { readonly name?: unknown; readonly version?: unknown }
        if (typeof parsed.name === 'string' && packages.some((name) => parsed.name === name || String(parsed.name).startsWith(`${name}-`)))
          return typeof parsed.version === 'string' ? parsed.version : undefined
      } catch {
        // Not a package's: further up.
      }
    const up = dirname(folder)
    if (up === folder) break
    folder = up
  }
  return undefined
}

/** A field of a package's manifest, as the adapter at `from` finds the package. */
const manifestOf = (from: string, request: string, resolve: Resolver): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(resolve(from, request), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** Where the adapters are found from: this package, as Althar's own. */
const here = import.meta.url

/**
 * Whether a Claude Code of the person's own, at this path, is one claude-agent-acp can drive: the release its SDK names
 * (`claudeCodeVersion`) or a newer one of the same major. An older one is what failed every start on 24 November.
 */
export const claudeFits = (path: string, resolve: Resolver = nodeResolver, from: string = here): boolean => {
  const adapter = (() => {
    try {
      return resolve(from, '@agentclientprotocol/claude-agent-acp/package.json')
    } catch {
      return undefined
    }
  })()
  if (adapter === undefined) return false
  let sdkFolder: string
  try {
    sdkFolder = dirname(resolve(adapter, '@anthropic-ai/claude-agent-sdk'))
  } catch {
    return false
  }
  const needs = (() => {
    try {
      const value = (JSON.parse(readFileSync(join(sdkFolder, 'package.json'), 'utf8')) as { claudeCodeVersion?: unknown }).claudeCodeVersion
      return typeof value === 'string' ? partsOf(value) : undefined
    } catch {
      return undefined
    }
  })()
  const theirs = partsOf(installedVersion(path, ['@anthropic-ai/claude-code'], ['claude', 'claude-code']) ?? '')
  if (needs === undefined || theirs === undefined) return false
  return theirs[0] === needs[0] && (theirs[1] > needs[1] || (theirs[1] === needs[1] && theirs[2] >= needs[2]))
}

/**
 * Whether a Codex of the person's own, at this path, is one codex-acp can drive: within the range it depends on
 * (`^0.172.0`, the same minor, this patch or later), read as npm reads a caret range.
 */
export const codexFits = (path: string, resolve: Resolver = nodeResolver, from: string = here): boolean => {
  const adapter = manifestOf(from, '@agentclientprotocol/codex-acp/package.json', resolve)
  const range = (adapter?.dependencies as Record<string, unknown> | undefined)?.['@openai/codex']
  const needs = typeof range === 'string' ? partsOf(range.replace(/^[\^~=v]+/u, '')) : undefined
  const theirs = partsOf(installedVersion(path, ['@openai/codex'], ['codex']) ?? '')
  if (needs === undefined || theirs === undefined) return false
  // A caret range below 1.0 holds its minor; from 1.0, its major.
  if (needs[0] === 0) return theirs[0] === 0 && theirs[1] === needs[1] && theirs[2] >= needs[2]
  return theirs[0] === needs[0] && (theirs[1] > needs[1] || (theirs[1] === needs[1] && theirs[2] >= needs[2]))
}
