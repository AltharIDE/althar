import { claudeProgram, codexProgram } from './bundledPrograms'

/*
 * Claude Code's and Codex's own programs, as the lockfile pins them (bun.lock): for each platform their makers
 * publish, the npm package the adapter's SDK would install there, at the version it names, with its sha512
 * integrity. Althar downloads that exact package, checks it, and runs the program in it: the program its adapter
 * was built for, without shipping it (docs/plans/agents-on-first-use.md).
 */

/** One platform's package: npm's address for it, its integrity, the program in it, and what of it never runs. */
export interface PinnedPackage {
  /** The package's name on npm. */
  readonly name: string
  /** Its version on npm: Codex's carry the platform (`0.172.0-linux-x64`). */
  readonly version: string
  /** Its tarball on npm. */
  readonly tarball: string
  /** Its Subresource Integrity, as npm publishes it: `sha512-<base64>`. */
  readonly integrity: string
  /** The program, relative to the package's folder. */
  readonly program: string
  /** What the package holds that Althar never runs, removed once it is checked and unpacked. */
  readonly prune: ReadonlyArray<string>
  /** The tarball's size, as npm said it when pinned. */
  readonly bytes?: number
}

/** An agent's program, pinned: the release its adapter needs, and its package for each `platform-arch[-musl]`. */
export interface ProgramPin {
  readonly version: string
  readonly assets: Readonly<Record<string, PinnedPackage>>
}

export type ProgramPins = Readonly<Record<'claude-code' | 'codex', ProgramPin>>

/** Each package the lockfile resolves, by its key: `[name@version, integrity]`. */
const entries = (lock: string) => {
  const found = new Map<string, { readonly id: string; readonly integrity: string }>()
  for (const match of lock.matchAll(/^ {4}"([^"]+)": \["([^"]+)", "[^"]*", \{[^\n]*?\}, "(sha512-[A-Za-z0-9+/=]+)"\]/gmu))
    found.set(match[1] ?? '', { id: match[2] ?? '', integrity: match[3] ?? '' })
  return found
}

/** npm's address for a package's tarball: `<registry>/<name>/-/<bare name>-<version>.tgz`. */
export const tarballOf = (name: string, version: string) =>
  `https://registry.npmjs.org/${name}/-/${name.replace(/^@[^/]+\//u, '')}-${version}.tgz`

/** `name@version` as the lockfile writes it, a scoped name keeping its `@`. */
const split = (id: string) => {
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), version: id.slice(at + 1) }
}

const TARGETS = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'] as const

/** The pins for Claude Code's and Codex's programs, read from the lockfile's text; throws where one is missing. */
export const pinsFromLock = (lock: string): ProgramPins => {
  const resolved = entries(lock)
  const need = (key: string) => {
    const found = resolved.get(key)
    if (found === undefined) throw new Error(`bun.lock resolves no ${key}.`)
    return { ...split(found.id), integrity: found.integrity }
  }
  const sdk = need('@anthropic-ai/claude-agent-sdk')
  const codex = need('@openai/codex')
  const claudeAssets: Record<string, PinnedPackage> = {}
  const codexAssets: Record<string, PinnedPackage> = {}
  for (const target of TARGETS) {
    const [platform = '', arch = ''] = target.split('-')
    for (const variant of platform === 'linux' ? ['', '-musl'] : ['']) {
      const pkg = need(`@anthropic-ai/claude-agent-sdk-${target}${variant}`)
      claudeAssets[`${target}${variant}`] = {
        ...pkg,
        tarball: tarballOf(pkg.name, pkg.version),
        program: claudeProgram(platform, arch, variant !== '').program,
        prune: [],
      }
    }
    const program = codexProgram(platform, arch)
    if (program === undefined) continue
    const pkg = need(`@openai/codex-${target}`)
    const vendor = program.program.split(/[\\/]/u).slice(0, 2).join('/')
    codexAssets[target] = {
      ...pkg,
      tarball: tarballOf(pkg.name, pkg.version),
      program: program.program.split(/[\\/]/u).join('/'),
      // Its voice: a program and the GStreamer libraries it plays sound with, which only a person speaking to Codex runs.
      prune: [`${vendor}/codex-resources/voice`],
    }
  }
  return {
    'claude-code': { version: sdk.version, assets: claudeAssets },
    codex: { version: codex.version, assets: codexAssets },
  }
}
