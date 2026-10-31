import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { afterEach, beforeEach, expect } from 'vitest'

import { freshCopy } from '../src/coordinatorFolder'
import { fetchBranch, gitWithin, sshEnvironment } from '../src/git'
import { onTestClock } from './support'

/*
 * Althar's own git never waits on a question nobody can answer. Started from
 * a terminal, a Flatpak build's fetch over SSH asked "The authenticity of host
 * 'github.com' can't be established … (yes/no)?" there, and the coordinator
 * couldn't answer until someone typed "yes"; started from the desktop, it
 * waited for good. OpenSSH asks on the controlling terminal, not on stdin, or
 * through an askpass program; these stand in for it with an `ssh` that asks
 * the same way, so what reaches it can be checked without a server.
 */

const linux = process.platform === 'linux' && existsSync('/proc/self/stat')

/** Field 6 of /proc/<pid>/stat: the session a process is in, which ties it to a terminal. */
const sessionOf = (pid: number | 'self') =>
  readFileSync(`/proc/${pid}/stat`, 'utf8')
    .replace(/^.*\) /, '')
    .split(' ')[3]

/** OpenSSH meeting a host it doesn't know: it asks through askpass where it may, else on the terminal; with nobody to ask, it fails. */
const ASKING_SSH = `#!/bin/sh
sed 's/^.*) //' /proc/$$/stat | cut -d' ' -f4 > "$ALTHAR_SSH_LOG"
printf '%s\\n' "askpass=\${SSH_ASKPASS-<unset>}" "require=\${SSH_ASKPASS_REQUIRE-<unset>}" >> "$ALTHAR_SSH_LOG"
answer=
if [ -n "\${SSH_ASKPASS:-}" ] && [ "\${SSH_ASKPASS_REQUIRE:-}" != never ] && [ -n "\${DISPLAY:-}\${WAYLAND_DISPLAY:-}" ]; then
  answer=$("$SSH_ASKPASS" "Are you sure you want to continue connecting (yes/no)?")
elif (: </dev/tty) 2>/dev/null; then
  read -r answer </dev/tty
fi
[ "$answer" = yes ] && exit 0
echo 'Host key verification failed.' >&2
exit 255
`

/** A host that never answers, and an ssh that keeps waiting on it past the time Althar gives a fetch. */
const STUCK_SSH = `#!/bin/sh
sleep 30
`

/** A dialog nobody is there to click, as ksshaskpass is when no one is looking. */
const WAITING_ASKPASS = `#!/bin/sh
sleep 30
echo yes
`

const executable = (path: string, text: string) => {
  writeFileSync(path, text)
  chmodSync(path, 0o755)
  return path
}

const run = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** A clone whose origin is a host over SSH, and a folder of stand-ins put first on PATH. */
const place = (ssh: string) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'althar-prompts-')))
  const bin = join(home, 'bin')
  mkdirSync(bin)
  executable(join(bin, 'ssh'), ssh)
  const repository = join(home, 'meridian')
  mkdirSync(repository)
  run(repository, 'init', '-q', '-b', 'main')
  run(repository, 'commit', '-q', '--allow-empty', '-m', 'Start')
  run(repository, 'remote', 'add', 'origin', 'git@unknown.example:meridian/api.git')
  return { home, bin, repository, log: join(home, 'ssh.log') }
}

const saved: Record<string, string | undefined> = {}
const setEnv = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key]
    process.env[key] = value
  }
}

beforeEach(() => {
  for (const key of Object.keys(saved)) delete saved[key]
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.runIf(linux)('git over SSH with nobody to answer', () => {
  it.effect('fails fast against an unknown host, even with an askpass and a display that would ask', () =>
    Effect.gen(function* () {
      const at = place(ASKING_SSH)
      // What a desktop session hands Althar: ksshaskpass, and a display for it.
      setEnv({
        PATH: `${at.bin}:${process.env.PATH ?? ''}`,
        ALTHAR_SSH_LOG: at.log,
        SSH_ASKPASS: executable(join(at.home, 'askpass'), WAITING_ASKPASS),
        DISPLAY: ':0',
      })
      const started = Date.now()
      const fetched = yield* fetchBranch(at.repository, 'main')
      assert.isFalse(fetched)
      expect(Date.now() - started).toBeLessThan(5_000)
      const said = readFileSync(at.log, 'utf8').split('\n')
      // No askpass to run, and none required.
      assert.include(said, 'askpass=<unset>')
      assert.include(said, 'require=never')
    }),
  )

  it.effect('runs ssh in a session of its own, with no terminal it could ask on', () =>
    Effect.gen(function* () {
      const at = place(ASKING_SSH)
      setEnv({ PATH: `${at.bin}:${process.env.PATH ?? ''}`, ALTHAR_SSH_LOG: at.log })
      yield* fetchBranch(at.repository, 'main')
      const session = readFileSync(at.log, 'utf8').split('\n')[0]
      assert.notStrictEqual(session, sessionOf('self'))
    }),
  )

  it.effect('says the host key is what stopped it', () =>
    Effect.gen(function* () {
      const at = place(ASKING_SSH)
      setEnv({ PATH: `${at.bin}:${process.env.PATH ?? ''}`, ALTHAR_SSH_LOG: at.log })
      const failed = yield* Effect.flip(gitWithin(10_000, at.repository, 'fetch', 'origin'))
      assert.include(failed.stderr, 'Host key verification failed')
    }),
  )

  it.effect('gives up when its time is up, ssh and all, rather than waiting on what git started', () =>
    Effect.gen(function* () {
      const at = place(STUCK_SSH)
      setEnv({ PATH: `${at.bin}:${process.env.PATH ?? ''}` })
      const started = Date.now()
      const failed = yield* Effect.flip(gitWithin(1_000, at.repository, 'fetch', 'origin'))
      expect(Date.now() - started).toBeLessThan(5_000)
      assert.strictEqual(failed.args[0], 'fetch')
    }).pipe(onTestClock),
  )

  it.effect("makes the coordinator's copy from the last fetch when the remote doesn't answer in time", () =>
    Effect.gen(function* () {
      const at = place(STUCK_SSH)
      setEnv({ PATH: `${at.bin}:${process.env.PATH ?? ''}` })
      const copy = join(at.home, 'worktrees', 'meridian', '.coordinator', 'meridian')
      const started = Date.now()
      yield* freshCopy(at.repository, copy, 'main', at.repository, 1_000)
      expect(Date.now() - started).toBeLessThan(5_000)
      assert.strictEqual(run(copy, 'log', '-1', '--format=%s'), 'Start')
    }).pipe(onTestClock),
  )
})

describe('the ssh Althar’s own git runs', () => {
  it('is the device’s, through the Flatpak’s bridge, inside a Flatpak', () => {
    assert.deepStrictEqual(sshEnvironment({ FLATPAK_ID: 'dev.althar.app' }), {
      GIT_SSH_COMMAND: '/app/bin/althar-host-ssh',
      GIT_SSH_VARIANT: 'ssh',
    })
  })

  it('is whatever the person’s git would run, everywhere else', () => {
    assert.deepStrictEqual(sshEnvironment({}), {})
  })
})
