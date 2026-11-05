import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { childEnvironment } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { WORK } from '../src/machine'
import { endedHow, installedAsLocked, runSpec } from '../src/runProcess'

/*
 * A run's own process (runProcess.ts): what it gets of Althar's environment,
 * which is an Electron utility process's, so a desktop app it opens starts as
 * from the person's terminal; how it ended, in words; and the packages of the
 * copy of the default branch it runs in, installed again once its lockfile
 * changes.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd, encoding: 'utf8' }).trim()

/** Althar's own environment as a run inherits it: the utility process's, the person's session's, and what an agent's tools would set. */
const ALTHAR = {
  PATH: '/opt/homebrew/bin:/usr/bin:/bin',
  HOME: '/Users/ada',
  TMPDIR: '/var/folders/zt/T/',
  LANG: 'en_GB.UTF-8',
  XDG_RUNTIME_DIR: '/run/user/1000',
  DISPLAY: ':0',
  WAYLAND_DISPLAY: 'wayland-0',
  XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  NODE_OPTIONS: '--require /Applications/Althar.app/hook.js',
  __CFBundleIdentifier: 'dev.althar.desktop',
  CHROME_DESKTOP: 'althar.desktop',
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  SSH_AUTH_SOCK: '/private/tmp/agent.sock',
}

describe("a run's process", () => {
  it('gets the session a desktop app needs, and nothing of the Electron it is started from', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const spec = runSpec('bun run dev', { [WORK]: 'run:project' }, platform)
      const env = childEnvironment(spec, ALTHAR, true)
      assert.deepStrictEqual(env, {
        PATH: ALTHAR.PATH,
        HOME: ALTHAR.HOME,
        TMPDIR: ALTHAR.TMPDIR,
        LANG: ALTHAR.LANG,
        XDG_RUNTIME_DIR: ALTHAR.XDG_RUNTIME_DIR,
        DISPLAY: ALTHAR.DISPLAY,
        WAYLAND_DISPLAY: ALTHAR.WAYLAND_DISPLAY,
        XAUTHORITY: ALTHAR.XAUTHORITY,
        DBUS_SESSION_BUS_ADDRESS: ALTHAR.DBUS_SESSION_BUS_ADDRESS,
        [WORK]: 'run:project',
      })
    }
    // Run by the system's shell, the line as it is.
    assert.deepInclude(runSpec('bun run dev', {}, 'darwin'), { command: '/bin/sh', args: ['-c', 'bun run dev'] })
    assert.deepInclude(runSpec('bun run dev', {}, 'win32'), {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"bun run dev"'],
      verbatim: true,
    })
  })

  it('says how it ended: its exit code, the signal that killed it, and that it crashed', () => {
    assert.strictEqual(endedHow({ code: 1, signal: null }, 'darwin'), ', with exit code 1')
    assert.strictEqual(endedHow({ code: null, signal: 'SIGKILL' }, 'darwin'), ', killed by SIGKILL')
    assert.strictEqual(endedHow({ code: null, signal: 'SIGSEGV' }, 'linux'), ', killed by SIGSEGV, so it crashed')
    // The shell it runs in says what killed what it ran as 128 and the signal's number.
    assert.strictEqual(endedHow({ code: 134, signal: null }, 'darwin'), ', with exit code 134: killed by SIGABRT, so it crashed')
    assert.strictEqual(endedHow({ code: 143, signal: null }, 'linux'), ', with exit code 143: killed by SIGTERM')
    // By the numbers of the shell's system, not of the one Althar runs on: a bus error is 7 on Linux, 10 on macOS.
    assert.strictEqual(endedHow({ code: 135, signal: null }, 'linux'), ', with exit code 135: killed by SIGBUS, so it crashed')
    assert.strictEqual(endedHow({ code: 138, signal: null }, 'darwin'), ', with exit code 138: killed by SIGBUS, so it crashed')
    // Windows says a crash by its NTSTATUS, an access violation here.
    assert.strictEqual(endedHow({ code: 0xc0000005, signal: null }, 'win32'), ', with exit code 0xC0000005, so it crashed')
    assert.strictEqual(endedHow({ code: 134, signal: null }, 'win32'), ', with exit code 134')
    assert.strictEqual(endedHow({ code: null, signal: null }, 'darwin'), '')
  })
})

describe("the default branch's copy a run runs in", () => {
  it.effect('has its packages installed again once its lockfile changes, and kept while it stays', () =>
    Effect.gen(function* () {
      const copy = join(realpathSync(mkdtempSync(join(tmpdir(), 'althar-run-copy-'))), 'meridian')
      mkdirSync(join(copy, 'apps', 'desktop'), { recursive: true })
      git(copy, 'init', '-q', '-b', 'main')
      writeFileSync(join(copy, '.gitignore'), 'node_modules/\nout/\n')
      writeFileSync(join(copy, 'bun.lock'), '{ "electron": "44.5.0" }\n')
      writeFileSync(join(copy, 'apps', 'desktop', 'package.json'), '{}\n')
      git(copy, 'add', '.')
      git(copy, 'commit', '-qm', 'Start')
      // Installed once, before Althar noted what from: its packages go, so the run's setup installs them.
      const installed = () => {
        mkdirSync(join(copy, 'node_modules', 'electron'), { recursive: true })
        mkdirSync(join(copy, 'apps', 'desktop', 'node_modules'), { recursive: true })
        mkdirSync(join(copy, 'apps', 'desktop', 'out'), { recursive: true })
      }
      installed()
      yield* installedAsLocked(copy)
      assert.isFalse(existsSync(join(copy, 'node_modules')))
      assert.isFalse(existsSync(join(copy, 'apps', 'desktop', 'node_modules')))
      assert.isFalse(existsSync(join(copy, 'apps', 'desktop', 'out')))
      assert.isTrue(existsSync(join(copy, 'bun.lock')))
      // Installed from that lockfile, they stay, however often it is freshened.
      installed()
      yield* installedAsLocked(copy)
      yield* installedAsLocked(copy)
      assert.isTrue(existsSync(join(copy, 'node_modules', 'electron')))
      // The default branch moves on with what it depends on: they go again.
      writeFileSync(join(copy, 'bun.lock'), '{ "electron": "44.10.0" }\n')
      git(copy, 'commit', '-qam', 'Electron 44.10')
      yield* installedAsLocked(copy)
      assert.isFalse(existsSync(join(copy, 'node_modules')))
    }),
  )
})
