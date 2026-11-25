import { existsSync, readFileSync } from 'node:fs'
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
