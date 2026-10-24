import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * ssh in Althar's Flatpak (docs/decisions/061): `flatpak/ssh.sh`, the ssh the
 * sandbox has, which trusts only the pinned code hosts and never asks; and
 * `flatpak/host-ssh.sh`, the device's ssh Althar's own git runs, which signs
 * in with the person's agent. Each runs here against stand-ins: an ssh that
 * says what it was given, and a flatpak-spawn whose "device" has a session of
 * its own.
 */

const flatpak = join(import.meta.dirname, '..', 'flatpak')
const linux = process.platform === 'linux'

const executable = (path: string, text: string) => {
  writeFileSync(path, text)
  chmodSync(path, 0o755)
  return path
}

/** An ssh that writes what it was given, then echoes its input (a protocol), or meets a host it doesn't know. */
const FAKE_SSH = `#!/bin/sh
{
  for arg in "$@"; do printf 'ARG %s\\n' "$arg"; done
  printf 'ENV SSH_AUTH_SOCK=%s\\n' "\${SSH_AUTH_SOCK-<unset>}"
  printf 'ENV SSH_ASKPASS_REQUIRE=%s\\n' "\${SSH_ASKPASS_REQUIRE-<unset>}"
  printf 'ENV GIT_PROTOCOL=%s\\n' "\${GIT_PROTOCOL-<unset>}"
  printf 'ENV SANDBOX_ONLY=%s\\n' "\${SANDBOX_ONLY-<unset>}"
  printf 'PWD %s\\n' "$PWD"
} >> "$ALTHAR_FAKE_LOG"
case "\${ALTHAR_FAKE_SSH:-echo}" in
  unknown)
    echo 'No ED25519 host key is known for git.example.org and you have requested strict checking.' >&2
    echo 'Host key verification failed.' >&2
    exit 255 ;;
  *) cat ;;
esac
`

/** A stand-in for flatpak-spawn --host: the device's session, the flags applied, nothing else of the sandbox's environment. */
const FAKE_FLATPAK_SPAWN = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
if (process.env.ALTHAR_FAKE_DENY === '1') { process.stderr.write('Portal call failed\\n'); process.exit(1) }
if (args.shift() !== '--host') process.exit(2)
const device = JSON.parse(process.env.ALTHAR_FAKE_DEVICE)
const env = { ...device }
let cwd = device.HOME
while (args[0]?.startsWith('--')) {
  const flag = args.shift()
  if (flag.startsWith('--env=')) { const kv = flag.slice(6); const at = kv.indexOf('='); env[kv.slice(0, at)] = kv.slice(at + 1) }
  else if (flag.startsWith('--directory=')) cwd = flag.slice(12)
}
const done = spawnSync(args[0], args.slice(1), { env, cwd, stdio: 'inherit' })
process.exit(done.status ?? 1)
`

/** Where the Flatpak's files are laid out as /app has them, a runtime ssh beside, and a device. */
const place = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'althar-ssh-')))
  const app = join(root, 'app')
  mkdirSync(join(app, 'bin'), { recursive: true })
  mkdirSync(join(app, 'share', 'althar', 'ssh'), { recursive: true })
  copyFileSync(join(flatpak, 'known_hosts'), join(app, 'share', 'althar', 'ssh', 'known_hosts'))
  const sandboxSsh = executable(join(app, 'bin', 'ssh'), readFileSync(join(flatpak, 'ssh.sh'), 'utf8'))
  const hostSsh = executable(join(app, 'bin', 'althar-host-ssh'), readFileSync(join(flatpak, 'host-ssh.sh'), 'utf8'))
  const runtime = join(root, 'usr', 'bin')
  mkdirSync(runtime, { recursive: true })
  executable(join(runtime, 'ssh'), FAKE_SSH)
  executable(join(runtime, 'flatpak-spawn'), FAKE_FLATPAK_SPAWN)
  const deviceBin = join(root, 'device', 'bin')
  mkdirSync(deviceBin, { recursive: true })
  executable(join(deviceBin, 'ssh'), FAKE_SSH)
  const runtimeDir = join(root, 'device', 'run')
  mkdirSync(runtimeDir, { recursive: true })
  const info = join(root, 'flatpak-info')
  writeFileSync(info, `[Application]\nname=dev.althar.app\n\n[Instance]\napp-path=${app}\n`)
  return { root, app, sandboxSsh, hostSsh, runtime, deviceBin, runtimeDir, info, log: join(root, 'ssh.log') }
}

type Place = ReturnType<typeof place>

const sandboxPath = (at: Place) => `${join(at.app, 'bin')}:${at.runtime}:/usr/bin:/bin`

const device = (at: Place, session: Record<string, string> = {}) =>
  JSON.stringify({
    PATH: `${at.deviceBin}:/usr/bin:/bin`,
    HOME: at.root,
    XDG_RUNTIME_DIR: at.runtimeDir,
    ALTHAR_FAKE_LOG: at.log,
    ...session,
  })

const run = (command: string, args: ReadonlyArray<string>, env: Record<string, string>, input = '') => {
  const done = spawnSync(command, [...args], { env, input, encoding: 'utf8', timeout: 20_000 })
  return { code: done.status, stdout: done.stdout, stderr: done.stderr }
}

const said = (at: Place) => (existsSync(at.log) ? readFileSync(at.log, 'utf8').split('\n') : [])

describe.runIf(linux)('ssh inside the Flatpak', () => {
  it('trusts the pinned code hosts only, and never asks, adds a key or waits long', () => {
    const at = place()
    const done = run(at.sandboxSsh, ['-T', 'git@github.com'], {
      PATH: sandboxPath(at),
      ALTHAR_FAKE_LOG: at.log,
      SSH_ASKPASS: '/usr/bin/ksshaskpass',
    })
    expect(done.code).toBe(0)
    const lines = said(at)
    for (const option of [
      'BatchMode=yes',
      'StrictHostKeyChecking=yes',
      'ConnectTimeout=15',
      'UserKnownHostsFile=/dev/null',
      `GlobalKnownHostsFile=${join(at.app, 'share', 'althar', 'ssh', 'known_hosts')}`,
    ])
      expect(lines).toContain(`ARG ${option}`)
    expect(lines).toContain('ENV SSH_ASKPASS_REQUIRE=never')
    // Its own options come first: OpenSSH takes the first value it is given.
    expect(lines.indexOf('ARG BatchMode=yes')).toBeLessThan(lines.indexOf('ARG git@github.com'))
    expect(lines.filter((line) => line.startsWith('ARG ')).at(-1)).toBe('ARG git@github.com')
  })

  it('passes what git sends and gets through untouched', () => {
    const at = place()
    const done = run(
      at.sandboxSsh,
      ['git@github.com', "git-upload-pack 'a/b.git'"],
      { PATH: sandboxPath(at), ALTHAR_FAKE_LOG: at.log },
      'pack\n',
    )
    expect(done.stdout).toBe('pack\n')
  })

  it('says why a host it doesn’t know stopped it, and fails as ssh does', () => {
    const at = place()
    const done = run(at.sandboxSsh, ['git@git.example.org'], { PATH: sandboxPath(at), ALTHAR_FAKE_LOG: at.log, ALTHAR_FAKE_SSH: 'unknown' })
    expect(done.code).toBe(255)
    expect(done.stderr).toContain('Host key verification failed.')
    expect(done.stderr).toContain('Althar: git.example.org isn’t one of the code hosts Althar trusts by default')
  })

  it('gives OpenSSH itself the settings it says it will use', () => {
    if (!existsSync('/usr/bin/ssh')) return
    const at = place()
    // The runtime's real ssh, not the stand-in: `-G` prints the configuration it settles on, and connects nowhere.
    const done = run(at.sandboxSsh, ['-G', 'github.com'], { PATH: `${join(at.app, 'bin')}:/usr/bin:/bin`, HOME: at.root })
    expect(done.code).toBe(0)
    const config = done.stdout.split('\n')
    expect(config).toContain('batchmode yes')
    expect(config).toContain('stricthostkeychecking true')
    expect(config).toContain('connecttimeout 15')
    expect(config).toContain('userknownhostsfile /dev/null')
    expect(config).toContain(`globalknownhostsfile ${join(at.app, 'share', 'althar', 'ssh', 'known_hosts')}`)
  })
})

describe.runIf(linux)('Althar’s own ssh, on the device', () => {
  const env = (at: Place, extra: Record<string, string> = {}) => ({
    PATH: sandboxPath(at),
    ALTHAR_FLATPAK_INFO: at.info,
    ALTHAR_FAKE_DEVICE: device(at),
    // Something only the sandbox has, which must not reach the device.
    SANDBOX_ONLY: 'yes',
    ...extra,
  })

  it('runs the device’s ssh, with the session’s agent, never asking, the pinned hosts beside the person’s own', () => {
    const at = place()
    const done = run(
      at.hostSsh,
      ['-o', 'SendEnv=GIT_PROTOCOL', 'git@github.com', "git-upload-pack 'a/b.git'"],
      env(at, { ALTHAR_FAKE_DEVICE: device(at, { SSH_AUTH_SOCK: '/run/user/1000/agent.sock' }), GIT_PROTOCOL: 'version=2' }),
      'pack\n',
    )
    expect(done.code).toBe(0)
    // git's protocol, both ways.
    expect(done.stdout).toBe('pack\n')
    const lines = said(at)
    expect(lines).toContain('ENV SSH_AUTH_SOCK=/run/user/1000/agent.sock')
    expect(lines).toContain('ENV SSH_ASKPASS_REQUIRE=never')
    expect(lines).toContain('ENV GIT_PROTOCOL=version=2')
    expect(lines).toContain('ENV SANDBOX_ONLY=<unset>')
    expect(lines).toContain('PWD /')
    for (const option of ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=15']) expect(lines).toContain(`ARG ${option}`)
    // The device's own known hosts files stay; the pinned ones are read where the device has the app.
    expect(lines).toContain(
      `ARG GlobalKnownHostsFile=/etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2 "${at.app}/share/althar/ssh/known_hosts"`,
    )
    // No UserKnownHostsFile of its own: the person's ~/.ssh/known_hosts counts, as their ssh_config says.
    expect(lines.some((line) => line.startsWith('ARG UserKnownHostsFile'))).toBe(false)
    expect(lines.filter((line) => line.startsWith('ARG ')).at(-2)).toBe('ARG git@github.com')
  })

  it('finds the agent’s socket in the runtime directory where the session leaves it out', async () => {
    const at = place()
    const socket = join(at.runtimeDir, 'ssh-agent.socket')
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(socket, resolve))
    try {
      run(at.hostSsh, ['-T', 'git@github.com'], env(at))
      expect(said(at)).toContain(`ENV SSH_AUTH_SOCK=${socket}`)
    } finally {
      server.close()
    }
  })

  it('says how to trust a host the device doesn’t know: once, from a terminal', () => {
    const at = place()
    const done = run(at.hostSsh, ['git@git.example.org'], env(at, { ALTHAR_FAKE_DEVICE: device(at, { ALTHAR_FAKE_SSH: 'unknown' }) }))
    expect(done.code).toBe(255)
    expect(done.stderr).toContain('Host key verification failed.')
    expect(done.stderr).toContain('ssh -T git.example.org')
  })

  it('says so when the device can’t be reached, and fails as ssh does', () => {
    const at = place()
    const done = run(at.hostSsh, ['git@github.com'], env(at, { ALTHAR_FAKE_DENY: '1' }))
    expect(done.code).toBe(255)
    expect(done.stderr).toContain('can’t reach this computer')
    expect(said(at)).toEqual([])
  })
})
