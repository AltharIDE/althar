/*
 * What each executable in Althar.app may do under the hardened runtime
 * (ADR-031): each is signed on its own, with only what it needs. What
 * the agents' own binaries need is what their makers sign them with, less
 * what Althar never uses (Claude Code's microphone and Apple Events, Codex's
 * voice host). Anything not named here gets none.
 */

const JIT = 'com.apple.security.cs.allow-jit'
const UNSIGNED_MEMORY = 'com.apple.security.cs.allow-unsigned-executable-memory'
const ANY_LIBRARY = 'com.apple.security.cs.disable-library-validation'
const MICROPHONE = 'com.apple.security.device.audio-input'

/** Each executable, by where it is in the app, and what it is given. The first that matches counts. */
const RULES: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
  // Althar's own binary: V8 in the main process, and dictation's microphone (ADR-017).
  [/^$/, [JIT, MICROPHONE]],
  // The helper Electron runs its utility processes in: the runtime's and dictation's V8, and the audio service that records.
  [/^Contents\/Frameworks\/Althar Helper\.app(\/|$)/, [JIT, MICROPHONE]],
  // The window's V8; the GPU process's, for WebGL drawn without a GPU; the plugin helper, which Electron doesn't start.
  [/^Contents\/Frameworks\/Althar Helper \((Renderer|GPU|Plugin)\)\.app(\/|$)/, [JIT]],
  // The Node the adapters run on: V8, and no more. Node's own build also allows debugging and any library, which they don't need.
  [/^Contents\/Resources\/node\/bin\/node$/, [JIT]],
  // Claude Code's Bun writes code to memory it then runs, and loads native addons it writes out at run time, which aren't Althar's.
  [/\/@anthropic-ai\/claude-agent-sdk-[^/]+\/claude$/, [JIT, UNSIGNED_MEMORY, ANY_LIBRARY]],
  // Codex, and the V8 host it runs code mode in.
  [/\/vendor\/[^/]+\/bin\/codex(-code-mode-host)?$/, [JIT, UNSIGNED_MEMORY]],
]

/**
 * What an executable is given, by its path inside the app ('' for the app
 * itself). Signed ad hoc, nothing has a team for library validation to
 * match, so Electron's own binaries couldn't load its framework: there,
 * they may load any library, as electron-builder warns. The Node and the
 * agents' binaries load only the system's, and are signed as they would be.
 */
export const entitlementsFor = (inApp: string, adHoc = false): ReadonlyArray<string> => {
  const given = RULES.find(([where]) => where.test(inApp))?.[1] ?? []
  const electrons = inApp === '' || inApp.startsWith('Contents/Frameworks/')
  return adHoc && electrons && !given.includes(ANY_LIBRARY) ? [...given, ANY_LIBRARY] : given
}
