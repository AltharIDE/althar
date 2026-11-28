import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The packages the runtime starts as processes, at the versions the app depends on. */
export const ADAPTERS: ReadonlyArray<string> = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp']
/** What stays in node_modules, including packages with platform binaries. */
export const NATIVE: ReadonlyArray<string> = ['sherpa-onnx-node', 'electron-updater', 'sharp', 'node-pty', '@trycua/cua-driver']

/**
 * node-pty is one package for every platform, with each one's build in
 * `prebuilds/<platform>-<arch>`, where the others' packages are one per
 * platform and npm installs only the one asked for. So all but the build's
 * own are removed from the staged app. Linux has none there: node-pty is
 * compiled into `build/` as npm installs it.
 */
export const prunePrebuilds = (app: string, platform: string, arch: string) => {
  const prebuilds = join(app, 'node_modules', 'node-pty', 'prebuilds')
  const own = `${platform}-${arch}`
  if (platform !== 'linux' && !existsSync(join(prebuilds, own))) throw new Error(`node-pty has no prebuild for ${own}.`)
  for (const name of readdirSync(prebuilds)) if (name !== own) rmSync(join(prebuilds, name), { recursive: true })
}

/*
 * The programs a package carries for the platform it is made on, beside
 * Electron and the Node in its resources (node.ts): dictation's speech engine
 * and the computer-use driver. Each comes in a package of its own per
 * platform, which npm installs as an optional dependency of the package that
 * names it; the runtime finds each where this says (sherpa-onnx-node's
 * addon.js), so package.ts checks the staged app has every one before it is
 * packaged. The agents' own programs, Claude Code's and Codex's, don't ship:
 * each comes on first use, the exact package the lockfile pins
 * (docs/plans/agents-on-first-use.md), so package.ts removes them and checks
 * none is left.
 */

/** The agents' own programs' platform packages, by the start of their names: never shipped. */
export const AGENT_PROGRAMS: ReadonlyArray<string> = ['@anthropic-ai/claude-agent-sdk-', '@openai/codex-']

/** Every agent program's platform package in an app's node_modules, at any depth, by its folder. */
export const agentProgramsIn = (app: string): ReadonlyArray<string> => {
  const found: string[] = []
  const walk = (modules: string) => {
    if (!existsSync(modules)) return
    for (const entry of readdirSync(modules)) {
      const names = entry.startsWith('@') ? readdirSync(join(modules, entry)).map((name) => `${entry}/${name}`) : [entry]
      for (const name of names) {
        const folder = join(modules, ...name.split('/'))
        if (AGENT_PROGRAMS.some((prefix) => name.startsWith(prefix))) found.push(folder)
        else walk(join(folder, 'node_modules'))
      }
    }
  }
  walk(join(app, 'node_modules'))
  return found
}

/** Removes the agents' own programs from a staged app: they come on first use. */
export const pruneAgentPrograms = (app: string) => {
  for (const folder of agentProgramsIn(app)) rmSync(folder, { recursive: true, force: true })
}

/** Fails where an app still holds an agent's own program: none ships. */
export const assertNoAgentPrograms = (app: string) => {
  const left = agentProgramsIn(app)
  if (left.length > 0)
    throw new Error(`The package holds agents' own programs, which come on first use:\n${left.map((path) => `  ${path}`).join('\n')}`)
}

/** A program the package must hold: in `name`, the platform's package, found from `parent` as Node would; at `file` inside it. */
export interface Binary {
  readonly parent: string
  readonly name: string
  readonly file: string
}

/** The speech engine's package for a platform: sherpa-onnx names Windows `win`, not `win32`. */
export const speechPackage = (platform: string, arch: string) => `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`

/** The native programs and libraries a package carries for a platform and processor. */
export const binariesFor = (platform: string, arch: string): ReadonlyArray<Binary> => {
  const driver = '@trycua/cua-driver'
  const driverPackage = `${driver}-${platform}-${arch}${platform === 'win32' ? '-msvc' : platform === 'linux' ? '-gnu' : ''}`
  const driverLibrary = platform === 'win32' ? 'cua_driver_sdk.dll' : `libcua_driver_sdk.${platform === 'darwin' ? 'dylib' : 'so'}`
  return [
    { parent: 'sherpa-onnx-node', name: speechPackage(platform, arch), file: 'sherpa-onnx.node' },
    { parent: driver, name: driverPackage, file: 'cua_driver_node_runtime.node' },
    { parent: driver, name: driverPackage, file: driverLibrary },
  ]
}
