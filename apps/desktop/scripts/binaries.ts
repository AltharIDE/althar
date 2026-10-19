/*
 * The programs a package carries for the platform it is made on, beside
 * Electron and the Node in its resources (node.ts): Codex and Claude Code,
 * which the adapters start, and dictation's speech engine. Each comes in a
 * package of its own per platform, which npm installs as an optional
 * dependency of the package that names it; the runtime finds each where
 * this says (provider-adapters' registry.ts, `bundledCodex` and
 * `bundledClaude`; sherpa-onnx-node's addon.js), so package.ts checks the
 * staged app has every one before it is packaged.
 */

/** Codex's builds, by Node's `platform-arch`: the Rust target each is, as `@openai/codex`'s `bin/codex.js` names them. */
const CODEX_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

/** A program the package must hold: in `name`, the platform's package, found from `parent` as Node would; at `file` inside it. */
export interface Binary {
  readonly parent: string
  readonly name: string
  readonly file: string
}

/** The speech engine's package for a platform: sherpa-onnx names Windows `win`, not `win32`. */
export const speechPackage = (platform: string, arch: string) => `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`

/** Codex, Claude Code and the speech engine, for a platform and processor. */
export const binariesFor = (platform: string, arch: string): ReadonlyArray<Binary> => {
  const target = CODEX_TARGETS[`${platform}-${arch}`]
  if (target === undefined) throw new Error(`Codex has no build for ${platform}-${arch}.`)
  const exe = platform === 'win32' ? '.exe' : ''
  return [
    { parent: '@openai/codex', name: `@openai/codex-${platform}-${arch}`, file: `vendor/${target}/bin/codex${exe}` },
    { parent: '@anthropic-ai/claude-agent-sdk', name: `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`, file: `claude${exe}` },
    { parent: 'sherpa-onnx-node', name: speechPackage(platform, arch), file: 'sherpa-onnx.node' },
  ]
}
