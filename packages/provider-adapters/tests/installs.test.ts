import { describe, expect, it } from 'vitest'

import { locate, namesOf, programName, quoted, usingLocated, usualDirs } from '../src/installs'
import { agents, bundledClaude, isMusl, type LaunchSpec, type OutOnDevice } from '../src/registry'

/* Finding an agent's command, on a Mac, Windows or Linux: the person's own first, then Althar's copies. */

const is =
  (...paths: Array<string>) =>
  (path: string) =>
    paths.includes(path)
const none = { bundled: null, kept: null }

describe('finding an agent’s command', () => {
  it('is the bare name on the PATH, else the full path where an installer put it, else the copy that ships, else the one downloaded', () => {
    const on = (env: Record<string, string>, dirs: Array<string>, ...paths: Array<string>) => ({
      env,
      dirs,
      platform: 'darwin',
      isExecutable: is(...paths),
    })
    expect(
      locate('opencode', { bundled: null, kept: '/kept/opencode' }, on({ PATH: '/a:/b' }, ['/usual'], '/b/opencode', '/usual/opencode')),
    ).toEqual({
      command: 'opencode',
      whose: 'theirs',
    })
    expect(
      locate('opencode', { bundled: null, kept: '/kept/opencode' }, on({ PATH: '/a' }, ['/usual'], '/usual/opencode', '/kept/opencode')),
    ).toEqual({
      command: '/usual/opencode',
      whose: 'theirs',
    })
    expect(locate('claude', { bundled: '/app/claude', kept: '/kept/claude' }, on({ PATH: '' }, [], '/app/claude', '/kept/claude'))).toEqual(
      {
        command: '/app/claude',
        whose: 'bundled',
      },
    )
    expect(locate('opencode', { bundled: null, kept: '/kept/opencode' }, on({ PATH: '' }, [], '/kept/opencode'))).toEqual({
      command: '/kept/opencode',
      whose: 'althar',
    })
    expect(locate('opencode', none, on({ PATH: '' }, []))).toBeNull()
  })

  it('on Windows, finds a command by PATHEXT’s endings on its Path, always by its full path', () => {
    const env = { Path: 'C:\\Tools;C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    expect(namesOf('code', 'win32', env, true)).toEqual(['code.com', 'code.exe', 'code.bat', 'code.cmd'])
    expect(
      locate('opencode', none, {
        env,
        dirs: [],
        platform: 'win32',
        isExecutable: is('C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe'),
      }),
    ).toEqual({ command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe', whose: 'theirs' })
    // An npm shim only runs through a shell: an agent, started without one, never takes it; an editor's command may.
    expect(namesOf('claude', 'win32', env)).toEqual(['claude.com', 'claude.exe'])
    expect(namesOf('code', 'win32', env, true)).toContain('code.cmd')
    expect(
      locate(
        'claude',
        { bundled: 'C:\\Althar\\claude.exe', kept: null },
        {
          env,
          dirs: [],
          platform: 'win32',
          isExecutable: is('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\Althar\\claude.exe'),
        },
      ),
    ).toEqual({ command: 'C:\\Althar\\claude.exe', whose: 'bundled' })
    expect(programName('opencode', 'win32')).toBe('opencode.exe')
    expect(programName('opencode', 'linux')).toBe('opencode')
    expect(usualDirs('win32', 'C:\\Users\\me', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toContain(
      'C:\\Users\\me\\AppData\\Roaming\\npm',
    )
    expect(usualDirs('linux', '/home/me', {})).toContain('/home/me/.local/bin')
    expect(usualDirs('darwin', '/Users/me', {})).toContain('/opt/homebrew/bin')
  })

  it('quotes a path for a shell only where it has to, as each system’s shell reads it', () => {
    expect(quoted('/a/b-c/d.e', 'darwin')).toBe('/a/b-c/d.e')
    expect(quoted('/a b', 'darwin')).toBe("'/a b'")
    expect(quoted("/o'neil/x", 'linux')).toBe(`'/o'\\''neil/x'`)
    expect(quoted('C:\\Program Files\\x.exe', 'win32')).toBe('"C:\\Program Files\\x.exe"')
    expect(quoted('C:\\Tools\\x.exe', 'win32')).toBe('C:\\Tools\\x.exe')
    // Outside Windows a backslash is a shell's escape, so a path with one is quoted.
    expect(quoted('/Users/me/a\\b/opencode', 'darwin')).toBe("'/Users/me/a\\b/opencode'")
  })

  it('points every command the agent runs at it, looked up each time, and names it in what the person runs to sign in', () => {
    let found: { command: string; whose: 'theirs' | 'bundled' | 'althar' } | null = null
    const pointed = usingLocated(agents.opencode, () => found)
    expect(pointed.launch('node').command).toBe('opencode')
    expect(pointed.signIn.login).toBe('opencode auth login')
    found = { command: '/kept/opencode', whose: 'althar' }
    expect(pointed.launch('node')).toMatchObject({ command: '/kept/opencode', args: ['acp'] })
    expect(pointed.signIn.status('node').command).toBe('/kept/opencode')
    expect(pointed.version?.('node').command).toBe('/kept/opencode')
    expect(pointed.signIn.login).toBe('/kept/opencode auth login')
    found = { command: 'opencode', whose: 'theirs' }
    expect(pointed.signIn.login).toBe('opencode auth login')
    expect(usingLocated(agents.codex, () => found)).toBe(agents.codex)
  })

  it('carries a copy that lives out on the device with the spec that names it, so an executor runs it there', () => {
    const seen: Array<{ command: string; args: ReadonlyArray<string> }> = []
    const out: (spec: LaunchSpec) => OutOnDevice = (spec) => (at) => {
      seen.push({ command: spec.command, args: spec.args })
      return { command: 'flatpak-spawn', args: ['--host', spec.command, ...spec.args], env: { A: at.env.A ?? 'b' } }
    }
    const pointed = usingLocated(agents.opencode, () => ({ command: '/device/opencode', whose: 'theirs', out }))
    const spec = pointed.launch('node')
    expect(spec.command).toBe('/device/opencode')
    expect(spec.onDevice?.({ cwd: '/w', env: {} })).toEqual({
      command: 'flatpak-spawn',
      args: ['--host', '/device/opencode', 'acp'],
      env: { A: 'b' },
    })
    expect(seen).toEqual([{ command: '/device/opencode', args: ['acp'] }])
    // What the person runs to sign in names the same copy, where their shell finds it.
    expect(pointed.signIn.login).toBe('/device/opencode auth login')
    // A copy here is as it was: no carrying anywhere.
    expect(usingLocated(agents.opencode, () => ({ command: '/kept/opencode', whose: 'althar' })).launch('node').onDevice).toBeUndefined()
  })

  it('points Claude Code’s sign-in, status and version, never its adapter, at the copy that ships', () => {
    const pointed = usingLocated(agents['claude-code'], () => ({ command: '/app/claude', whose: 'bundled' }))
    expect(pointed.launch('node').command).toBe('node')
    expect(pointed.signIn.status('node').command).toBe('/app/claude')
    expect(pointed.signIn.inApp?.run('node').command).toBe('/app/claude')
    expect(pointed.signIn.logout?.run('node').command).toBe('/app/claude')
    expect(pointed.version?.('node').command).toBe('/app/claude')
    expect(pointed.signIn.login).toBe('/app/claude auth login')
  })

  it('finds the Claude Code the Agent SDK ships for this computer, and none for one it has no build for', () => {
    expect(bundledClaude()).toMatch(/claude-agent-sdk-[a-z0-9-]+\/claude(\.exe)?$/)
    expect(bundledClaude('plan9', 'mips')).toBeNull()
    expect(isMusl('darwin')).toBe(false)
  })
})
