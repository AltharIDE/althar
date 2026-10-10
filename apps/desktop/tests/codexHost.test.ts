import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * The Codex host bridge (flatpak/codex-host.sh): the device's own Codex, run
 * over flatpak-spawn with an environment the bridge builds. It is tested
 * against a stubbed flatpak-spawn ("the device", which has a session
 * environment of its own) and a stubbed Codex, so the flags, the crossing
 * names, the git settings and the working directory can be checked without a
 * Flatpak.
 */

/** A stand-in for flatpak-spawn: the device has a session of its own, the flags apply as they would there, and every call is recorded. */
const FAKE_FLATPAK_SPAWN = `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
if (process.env.ALTHAR_FAKE_LOG)
  appendFileSync(process.env.ALTHAR_FAKE_LOG, \`CALL \${args.map((a) => JSON.stringify(a)).join(' ')}\\n\`)
let host = false
let clear = false
let directory
const vars = {}
const unset = []
while (args.length > 0) {
  const [a] = args
  if (a === '--host') { host = true; args.shift(); continue }
  if (a === '--watch-bus') { args.shift(); continue }
  if (a === '--clear-env') { clear = true; args.shift(); continue }
  if (a.startsWith('--env=')) { const kv = a.slice(6); const at = kv.indexOf('='); vars[kv.slice(0, at)] = kv.slice(at + 1); args.shift(); continue }
  if (a.startsWith('--unset-env=')) { unset.push(a.slice(12)); args.shift(); continue }
  if (a.startsWith('--directory=')) { directory = a.slice(12); args.shift(); continue }
  break
}
if (!host) process.exit(2)
if (process.env.ALTHAR_FAKE_DENY === '1') {
  process.stderr.write('Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown\\nHint: --host only works when the Flatpak is allowed to talk to org.freedesktop.Flatpak\\n')
  process.exit(1)
}
const session = { HOME: process.env.ALTHAR_FAKE_HOME ?? '', PATH: process.env.ALTHAR_FAKE_PATH ?? '/usr/bin:/bin' }
const env = clear ? { ...vars } : { ...session, ...vars }
for (const name of unset) delete env[name]
const done = spawnSync(args[0], args.slice(1), { env, cwd: directory ?? session.HOME, stdio: 'inherit' })
process.exit(done.status ?? 1)
`

/** The device's Codex, as far as the bridge is concerned: it says what it was given, and runs a git that refuses a half-set config. */
const FAKE_CODEX = `#!/bin/sh
printf 'HOME=%s\\n' "$HOME"
printf 'PWD=%s\\n' "$PWD"
printf 'CODEX_HOME=%s\\n' "\${CODEX_HOME-<unset>}"
printf 'CODEX_CONFIG=%s\\n' "\${CODEX_CONFIG-<unset>}"
printf 'GH_CONFIG_DIR=%s\\n' "\${GH_CONFIG_DIR-<unset>}"
printf 'GLAB_CONFIG_DIR=%s\\n' "\${GLAB_CONFIG_DIR-<unset>}"
printf 'GIT_CONFIG_COUNT=%s\\n' "\${GIT_CONFIG_COUNT-<unset>}"
printf 'GIT_CONFIG_KEY_0=%s\\n' "\${GIT_CONFIG_KEY_0-<unset>}"
printf 'GIT_CONFIG_VALUE_0=%s\\n' "\${GIT_CONFIG_VALUE_0-<unset>}"
printf 'GIT_TERMINAL_PROMPT=%s\\n' "\${GIT_TERMINAL_PROMPT-<unset>}"
printf 'SSH_AUTH_SOCK=%s\\n' "\${SSH_AUTH_SOCK-<unset>}"
printf 'OPENCODE_CONFIG_CONTENT=%s\\n' "\${OPENCODE_CONFIG_CONTENT-<unset>}"
if git config --list >/dev/null 2>&1; then echo 'git=ok'; else echo 'git=failed'; fi
`

const bridge = join(import.meta.dirname, '..', 'flatpak', 'codex-host.sh')
const uid = process.getuid?.() ?? 1000

interface At {
  readonly codex?: 'bins' | 'home' | 'none'
  readonly deny?: boolean
}

/** A device to run the bridge against: its stub commands, its own session (home and PATH), and a place for the calls it records. */
const device = ({ codex = 'bins', deny = false }: At = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-bridge-'))
  const bins = join(root, 'device-bin')
  mkdirSync(bins)
  writeFileSync(join(bins, 'flatpak-spawn'), FAKE_FLATPAK_SPAWN)
  chmodSync(join(bins, 'flatpak-spawn'), 0o755)
  const hostHome = join(root, 'host-home')
  const sandboxHome = join(root, 'sandbox-home')
  const worktree = join(root, 'worktrees', 'p', 't')
  for (const folder of [hostHome, sandboxHome, worktree]) mkdirSync(folder, { recursive: true })
  // A Codex on the session PATH, or only where an installer puts one (a usual directory).
  const codexBin = codex === 'home' ? join(hostHome, '.local', 'bin') : bins
  if (codex !== 'none') {
    mkdirSync(codexBin, { recursive: true })
    writeFileSync(join(codexBin, 'codex'), FAKE_CODEX)
    chmodSync(join(codexBin, 'codex'), 0o755)
  }
  const log = join(root, 'calls.log')
  const codexHome = join(root, 'account-home')
  const codexConfig = '{"mcp_servers": {"a b": {"enabled": false}}}'
  const ghConfig = join(sandboxHome, 'no-sign-in-gh')
  const glabConfig = join(sandboxHome, 'no-sign-in-glab')
  const gitPrompt = '0'
  const env = {
    ...process.env,
    HOME: sandboxHome,
    PATH: `${bins}:${process.env.PATH ?? ''}`,
    ALTHAR_FAKE_HOME: hostHome,
    // A device whose session PATH has no Codex, for the usual-directory cases.
    ALTHAR_FAKE_PATH: codex === 'home' ? '/usr/bin:/bin' : `${bins}:/usr/bin:/bin`,
    ALTHAR_FAKE_LOG: log,
    ...(deny ? { ALTHAR_FAKE_DENY: '1' } : {}),
    CODEX_HOME: codexHome,
    CODEX_CONFIG: codexConfig,
    GH_CONFIG_DIR: ghConfig,
    GLAB_CONFIG_DIR: glabConfig,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_TERMINAL_PROMPT: gitPrompt,
    OPENCODE_CONFIG_CONTENT: '{"mcp":{}}',
    SSH_AUTH_SOCK: join(sandboxHome, 'agent'),
  }
  return {
    hostHome,
    sandboxHome,
    worktree,
    log,
    codexHome,
    codexConfig,
    ghConfig,
    glabConfig,
    gitPrompt,
    run: () => execFileSync('sh', [bridge, 'app-server'], { encoding: 'utf8', cwd: worktree, env }),
  }
}

/** What a run said, or why it refused. */
const said = (at: ReturnType<typeof device>) => {
  try {
    return { output: at.run(), failed: null as { readonly stderr?: string } | null }
  } catch (error) {
    return { output: '', failed: error as { readonly stderr?: string } }
  }
}

describe('the Codex host bridge', () => {
  it('runs the device’s Codex with the account’s settings and git settings crossing whole, the device’s home, and its own working directory', () => {
    const at = device()
    const { output } = said(at)
    expect(output).toContain(`CODEX_HOME=${at.codexHome}`)
    // Spaces and quoting survive the crossing exactly.
    expect(output).toContain(`CODEX_CONFIG=${at.codexConfig}`)
    // Every name the bridge names crosses with its own value, none of them dropped.
    expect(output).toContain(`GH_CONFIG_DIR=${at.ghConfig}`)
    expect(output).toContain(`GLAB_CONFIG_DIR=${at.glabConfig}`)
    expect(output).toContain(`GIT_TERMINAL_PROMPT=${at.gitPrompt}`)
    expect(output).toContain('GIT_CONFIG_COUNT=1')
    expect(output).toContain('GIT_CONFIG_KEY_0=credential.helper')
    // An empty value is a value: it is what unsets git's credential helper, and a git that misses it refuses to start.
    expect(output).toContain('GIT_CONFIG_VALUE_0=\n')
    expect(output).toContain('git=ok')
    expect(output).toContain('SSH_AUTH_SOCK=<unset>')
    // The device's own home, not the sandbox's.
    expect(output).toContain(`HOME=${at.hostHome}`)
    expect(output).not.toContain(`HOME=${at.sandboxHome}`)
    // The adapter's working directory, as the device sees it.
    expect(output).toContain(`PWD=${at.worktree}`)
    // Only the names the bridge names cross: none of Althar's other settings does.
    expect(output).toContain('OPENCODE_CONFIG_CONTENT=<unset>')
    const calls = readFileSync(at.log, 'utf8')
    expect(calls).toContain('--clear-env')
    expect(calls).toContain(JSON.stringify('--directory=' + at.worktree))
    expect(calls).toContain(JSON.stringify('--unset-env=SSH_AUTH_SOCK'))
    expect(calls).toContain(JSON.stringify('--env=CODEX_CONFIG=' + at.codexConfig))
    expect(calls).toContain(JSON.stringify('--env=GIT_CONFIG_VALUE_0='))
  })

  it('finds a Codex where an installer put it, when the device’s session PATH has none', () => {
    const at = device({ codex: 'home' })
    const { output, failed } = said(at)
    expect(failed).toBeNull()
    expect(output).toContain('git=ok')
    expect(output).toContain(`HOME=${at.hostHome}`)
  })

  it('translates a document-portal path here, without asking the device, and leaves every other path alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-portal-'))
    const spy = join(root, 'flatpak-spawn')
    const calls = join(root, 'called')
    writeFileSync(spy, `#!/bin/sh\n: > '${calls}'\nexit 1\n`)
    chmodSync(spy, 0o755)
    const translate = (path: string) =>
      execFileSync('sh', [bridge, '--portal-path', path], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}` },
      })
    expect(translate('/run/flatpak/doc/abc123/wt')).toBe(`/run/user/${uid}/doc/abc123/wt`)
    expect(translate('/run/flatpak/doc')).toBe(`/run/user/${uid}/doc`)
    expect(translate('/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t')).toBe(
      '/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t',
    )
    // A path that only begins like the portal is an ordinary one.
    expect(translate('/run/flatpak/docx/wt')).toBe('/run/flatpak/docx/wt')
    // No host probe: the translation is decided here, and the spy was never run.
    expect(existsSync(calls)).toBe(false)
  })

  it('says Codex has to be installed there when the device has none', () => {
    const at = device({ codex: 'none' })
    const { failed } = said(at)
    expect(failed?.stderr ?? '').toContain('Codex has to be installed on this computer')
    expect(failed?.stderr ?? '').not.toContain('org.freedesktop.Flatpak')
  })

  it('says what to put right when the device cannot be reached at all', () => {
    const at = device({ deny: true })
    const { failed } = said(at)
    expect(failed?.stderr ?? '').toContain('org.freedesktop.Flatpak')
    expect(failed?.stderr ?? '').not.toContain('installed on this computer')
  })
})
