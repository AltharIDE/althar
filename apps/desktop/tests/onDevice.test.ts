import { describe, expect, it } from 'vitest'

import { Effect } from 'effect'

import { deviceHere, envFound, portalPath, relayOut, whereFound, whereScript } from '../src/runtime/onDevice'

/*
 * The device outside a Flatpak (onDevice.ts): the person's own commands are
 * found and run out there, the document portal's paths are told apart, and
 * only what an agent was meant to have crosses.
 */

describe('the device outside a Flatpak', () => {
  it('is nowhere but a Flatpak: nothing is asked of it, and everything stays local', async () => {
    expect(await Effect.runPromise(deviceHere({}))).toBeUndefined()
  })

  it('tells the document portal’s path apart: one form in the sandbox, another on the device', () => {
    expect(portalPath('/run/flatpak/doc/abc123/project', 1000)).toBe('/run/user/1000/doc/abc123/project')
    expect(portalPath('/run/flatpak/doc', 1000)).toBe('/run/user/1000/doc')
    expect(portalPath('/run/flatpak/docx/project', 1000)).toBe('/run/flatpak/docx/project')
    expect(portalPath('/run/user/1000/doc/abc123', 1000)).toBe('/run/user/1000/doc/abc123')
    expect(portalPath('/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t', 1000)).toBe(
      '/home/me/.var/app/dev.althar.app/data/althar/worktrees/p/t',
    )
  })

  it('takes a launch out to the device with the names it needs and what the agent was given, and nothing else', () => {
    const facts = {
      env: { HOME: '/home/me', PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: '/run/user/1000' },
      uid: 1000,
      ambient: { PATH: '/app/bin:/usr/bin', XDG_DATA_HOME: '/home/me/.var/app/dev.althar.app/data' },
    } satisfies Parameters<typeof relayOut>[2]
    const spec = {
      command: '/run/flatpak/doc/abc123/repo/opencode',
      args: ['acp', '/run/flatpak/doc/abc123/repo'],
      env: {},
      inheritEnv: [],
    }
    const at = {
      cwd: '/run/flatpak/doc/abc123/repo',
      env: {
        PATH: '/app/bin:/usr/bin',
        XDG_DATA_HOME: '/home/me/.var/app/dev.althar.app/data/althar/accounts/a',
        GIT_TERMINAL_PROMPT: '0',
      },
    }
    const launched = relayOut(spec, at, facts)
    expect(launched.command).toBe('flatpak-spawn')
    expect(launched.inheritEnv).toEqual(['DBUS_SESSION_BUS_ADDRESS'])
    for (const flag of ['--watch-bus', '--host', '--clear-env']) expect(launched.args).toContain(flag)
    expect(launched.args).toContain('--env=HOME=/home/me')
    // The device's own PATH, never the sandbox's.
    expect(launched.args).toContain('--env=PATH=/usr/bin:/bin')
    expect(launched.args).not.toContain('--env=PATH=/app/bin:/usr/bin')
    // What an executor set for the agent crosses; what is only the sandbox's own does not.
    expect(launched.args).toContain('--env=XDG_DATA_HOME=/home/me/.var/app/dev.althar.app/data/althar/accounts/a')
    expect(launched.args).toContain('--env=GIT_TERMINAL_PROMPT=0')
    // Nothing reaches the device's ssh agent: the device's session is cleared first.
    expect(launched.args.some((arg) => arg.startsWith('--env=SSH_AUTH_SOCK'))).toBe(false)
    expect(launched.args).toContain('--directory=/run/user/1000/doc/abc123/repo')
    expect(launched.args.slice(-3)).toEqual(['/run/user/1000/doc/abc123/repo/opencode', 'acp', '/run/user/1000/doc/abc123/repo'])
  })

  it('finds the person’s commands where the device’s shell and installers put them', () => {
    const script = whereScript(['opencode', 'codex'])
    expect(script).toContain('command -v "$name"')
    expect(script).toContain('$HOME/.local/bin')
    expect(script).toContain('opencode codex')
    expect([...whereFound('opencode\t/home/me/.local/bin/opencode\ncodex\t/usr/bin/codex\n')]).toEqual([
      ['opencode', '/home/me/.local/bin/opencode'],
      ['codex', '/usr/bin/codex'],
    ])
    expect([...whereFound('nothing\n')]).toEqual([])
    expect(envFound('HOME=/home/me\nA=b=c\n\n')).toEqual({ HOME: '/home/me', A: 'b=c' })
  })
})
