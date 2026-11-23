import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sshArguments, sshEnvironment, sshUpdateArguments } from '../src/sshArguments'

describe('SSH transport arguments', () => {
  it('uses strict host checking, existing SSH config, no forwarded agent/TTY, and a pinned home', () => {
    const args = sshArguments(
      {
        target: 'person@my-vps',
        port: 2222,
        configFile: resolve('fixture/config'),
        launcher: '/private/launcher',
        profile: '/private/profile',
      },
      `home_${'1'.repeat(32)}`,
    )
    expect(args).toContain('-oStrictHostKeyChecking=yes')
    expect(args).toContain('-oForwardAgent=no')
    expect(args).toContain('-oBatchMode=yes')
    expect(args.slice(-3, -1)).toEqual(['--', 'person@my-vps'])
    expect(args.at(-1)).toContain('connect-stdio --home-id')
    expect(sshArguments({ target: 'my-vps' }).at(-1)).toContain('status --json')
  })
  it('runs the home’s own update by the same launcher, profile and strict options as its connection', () => {
    const args = sshUpdateArguments({ target: 'person@my-vps', port: 2222, launcher: '/private/launcher', profile: '/private/profile' })
    expect(args).toContain('-oStrictHostKeyChecking=yes')
    expect(args).toContain('-oBatchMode=yes')
    expect(args.slice(-3, -1)).toEqual(['--', 'person@my-vps'])
    expect(args.at(-1)).toMatch(/\/private\/launcher'\\'' update --apply --wait --json --profile '\\''\/private\/profile/)
    expect(sshUpdateArguments({ target: 'my-vps' }).at(-1)).toContain('althar-host-program/launcher" update --apply --wait --json')
    expect(() => sshUpdateArguments({ target: 'my-vps; rm -rf ~' })).toThrow()
  })
  it.skipIf(process.platform === 'win32')(
    'quotes remote paths as literal arguments, including apostrophes, dollars and shell syntax',
    () => {
      const command = sshArguments({ target: 'my-vps', launcher: "/a quote's/$(must-stay-literal)", profile: '/profile; $HOME' }).at(-1)
      expect(command).toBeDefined()
      // Parse with the real POSIX shell while collecting its arguments; no
      // command named by the untrusted path is executed.
      const outer = execFileSync('/bin/sh', ['-c', `${command?.replace(/^exec /, 'set -- ')}; printf '%s\n' "$@"`], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
      })
      expect(outer.split('\n').slice(0, 2)).toEqual(['/bin/sh', '-c'])
      const script = outer.split('\n')[2]!
      const text = execFileSync('/bin/sh', ['-c', `${script.replace(/^exec /, 'set -- ')}; printf '%s\n' "$@"`], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
      })
      expect(text.split('\n')).toEqual([
        '/bin/sh',
        "/a quote's/$(must-stay-literal)",
        'status',
        '--json',
        '--profile',
        '/profile; $HOME',
        '',
      ])
    },
  )
  it.skipIf(process.platform === 'win32')(
    'expands the managed launcher inside the explicit POSIX shell and keeps the home path literal',
    () => {
      const command = sshArguments({ target: 'my-vps' }).at(-1)!
      const outer = execFileSync('/bin/sh', ['-c', `${command.replace(/^exec /, 'set -- ')}; printf '%s\n' "$@"`], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin' },
      }).split('\n')
      expect(outer.slice(0, 2)).toEqual(['/bin/sh', '-c'])
      const script = outer[2]!
      for (const environment of [{ HOME: "/home/quote's $literal" }, { HOME: '/unused', XDG_DATA_HOME: "/data/quote's $literal" }]) {
        const result = execFileSync('/bin/sh', ['-c', `${script.replace(/^exec /, 'set -- ')}; printf '%s\n' "$@"`], {
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', ...environment },
        }).split('\n')
        expect(result).toEqual([
          '/bin/sh',
          `${'XDG_DATA_HOME' in environment ? environment.XDG_DATA_HOME : `${environment.HOME}/.local/share`}/althar-host-program/launcher`,
          'status',
          '--json',
          '',
        ])
      }
    },
  )
  it('refuses option injection, shell fragments and invalid connection fields', () => {
    for (const target of ['-oProxyCommand=bad', 'host;command', 'user@host extra', '', 'host\ncommand'])
      expect(() => sshArguments({ target })).toThrow()
    for (const change of [{ port: 0 }, { port: 65536 }, { launcher: 'relative' }, { profile: '/bad\nprofile' }, { configFile: 'relative' }])
      expect(() => sshArguments({ target: 'host', ...change })).toThrow()
    expect(() => sshArguments({ target: 'host' }, 'bad-home')).toThrow()
  })
  it('does not give SSH provider tokens, Node loader injection or host-supervisor capabilities', () => {
    expect(
      sshEnvironment({
        HOME: '/home/test',
        SSH_AUTH_SOCK: '/socket',
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'secret',
        NODE_OPTIONS: '--import bad',
        CREDENTIALS_DIRECTORY: '/secret',
        NOTIFY_SOCKET: '/supervisor',
      }),
    ).toEqual({ HOME: '/home/test', SSH_AUTH_SOCK: '/socket', PATH: '/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' })
  })
})
