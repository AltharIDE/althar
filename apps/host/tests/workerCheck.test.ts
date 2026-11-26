import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agents, BWRAP_TRY, type AgentDefinition } from '@althar/provider-adapters'
import { fakeAgentMain } from '@althar/provider-adapters/testing'
import { describe, expect, it } from 'vitest'

import {
  apparmorRule,
  checkHere,
  checkSandbox,
  checkTools,
  checkWorker,
  linkShipped,
  offeredModels,
  readinessLines,
  sandboxFix,
  shippedSandbox,
  workerPath,
  type CheckSystem,
} from '../src/workerCheck'
import { temporary } from './support'

/*
 * A worker's check of itself (apps/host/src/workerCheck.ts), on a machine stood in for: whether its agents' sandbox
 * starts, why not and what lets it, its tools, and each signed-in agent started once.
 */

const PATH = '/w/bin:/home/althar/.local/bin:/usr/local/bin:/usr/bin:/bin:/r/node/bin'

const machine = (given: Partial<CheckSystem> & { readonly has?: ReadonlyArray<string> } = {}): CheckSystem & { readonly ran: string[] } => {
  const ran: string[] = []
  const has = given.has ?? ['/w/bin/bwrap', '/w/bin/socat', '/usr/bin/systemd-run']
  return {
    ran,
    run: async (command, args) => {
      ran.push([command, ...args].join(' '))
      return { ok: true, stdout: '', stderr: '' }
    },
    read: () => undefined,
    executable: (path) => has.includes(path),
    startAgent: async () => [],
    ...given,
  }
}

describe('its agents’ sandbox', () => {
  it('starts bubblewrap as a run would: the first on its PATH, in a user unit with no new privileges', async () => {
    const here = machine()
    expect(await checkSandbox(PATH, '/p', here)).toEqual({ starts: true, bwrap: '/w/bin/bwrap' })
    expect(here.ran).toEqual([
      `/usr/bin/systemd-run --user --quiet --wait --pipe --collect --property=NoNewPrivileges=yes -- /w/bin/bwrap ${BWRAP_TRY.join(' ')}`,
    ])
  })

  it('says what it lacks before trying', async () => {
    expect(await checkSandbox(PATH, '/p', machine({ has: ['/w/bin/socat'] }))).toEqual({ starts: false, problem: 'NoBubblewrap' })
    expect(await checkSandbox(PATH, '/p', machine({ has: ['/w/bin/bwrap'] }))).toEqual({ starts: false, problem: 'NoSocat' })
  })

  it('says why bubblewrap can’t make a namespace, from the kernel’s own switches, and what lets it', async () => {
    const refused = (switches: Readonly<Record<string, string>>) =>
      machine({
        run: async () => ({ ok: false, stdout: '', stderr: 'bwrap: setting up uid map: Permission denied' }),
        read: (path) => switches[path],
      })
    const apparmor = await checkSandbox(
      PATH,
      '/home/althar/.local/share/althar-worker-program',
      refused({ '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' }),
    )
    expect(apparmor).toEqual({
      starts: false,
      problem: 'NoUserNamespaces',
      fix: sandboxFix('apparmor', '/home/althar/.local/share/althar-worker-program'),
    })
    expect(await checkSandbox(PATH, '/p', refused({ '/proc/sys/kernel/unprivileged_userns_clone': '0' }))).toMatchObject({
      problem: 'NoUserNamespaces',
      fix: expect.stringContaining('kernel.unprivileged_userns_clone=1'),
    })
    expect(await checkSandbox(PATH, '/p', refused({ '/proc/sys/user/max_user_namespaces': '0' }))).toMatchObject({
      fix: expect.stringContaining('user.max_user_namespaces=15000'),
    })
    expect(await checkSandbox(PATH, '/p', refused({}))).toEqual({ starts: false, problem: 'Failed' })
    // No rule for a folder it can't say safely: the problem alone.
    expect(await checkSandbox(PATH, "/home/o'brien/x", refused({ '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1' }))).toEqual(
      { starts: false, problem: 'NoUserNamespaces' },
    )
  })

  it('gives AppArmor’s rule for this worker’s own bubblewrap alone, one line to copy, and none for a path it can’t say safely', () => {
    const fix = sandboxFix('apparmor', '/home/althar/.local/share/althar-worker-program')
    expect(fix).toBe(
      `sudo sh -c 'printf "%s\\n" "abi <abi/4.0>," "include <tunables/global>" "profile althar-worker-bwrap /home/althar/.local/share/althar-worker-program/bundle-*/**/bwrap flags=(unconfined) {" "  userns," "  include if exists <local/althar-worker-bwrap>" "}" > /etc/apparmor.d/althar-worker-bwrap && apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap'`,
    )
    expect(fix).not.toContain('\n')
    expect(sandboxFix('apparmor', "/home/o'brien/x")).toBeUndefined()
    expect(sandboxFix('apparmor', '/home/a b/x')).toBeUndefined()
  })

  it('writes the same rule a root login’s setup writes', () => {
    const script = readFileSync(join(import.meta.dirname, '..', 'bootstrap', 'ssh.sh'), 'utf8')
    const quoted = apparmorRule('$1')
      .split('\n')
      .map((line) => (line.includes('$1') ? `"${line}"` : `'${line}'`))
      .join(' ')
    expect(script).toContain(`printf '%s\\n' ${quoted} > /etc/apparmor.d/althar-worker-bwrap.new`)
  })
})

describe('what it ships and finds', () => {
  it('finds bubblewrap and ripgrep in Codex’s own package, and socat in its tools', () => {
    expect(shippedSandbox('/r', '/r/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex')).toEqual({
      bwrap: '/r/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap',
      rg: '/r/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/rg',
      socat: '/r/tools/bin/socat',
    })
    expect(shippedSandbox('/r', null)).toEqual({ socat: '/r/tools/bin/socat' })
  })

  it('links each into its bin through current, and drops a link to what the release no longer carries', async () => {
    const folder = temporary()
    const release = join(folder, 'release')
    mkdirSync(release)
    writeFileSync(join(release, 'bwrap'), '')
    await linkShipped(folder, { bwrap: join(release, 'bwrap'), socat: join(release, 'socat') }, existsSync)
    expect(readlinkSync(join(folder, 'bin', 'bwrap'))).toBe(join(release, 'bwrap'))
    expect(existsSync(join(folder, 'bin', 'socat'))).toBe(false)
    await linkShipped(folder, { bwrap: undefined }, existsSync)
    expect(() => lstatSync(join(folder, 'bin', 'bwrap'))).toThrow()
  })

  it('runs, reads and looks at this computer’s own programs and files', async () => {
    const folder = temporary()
    const script = join(folder, 'script')
    writeFileSync(script, '#!/bin/sh\nprintf out; printf err >&2\n[ "$1" = ok ]\n', { mode: 0o700 })
    writeFileSync(join(folder, 'plain'), 'words', { mode: 0o600 })
    expect(await checkHere.run(script, ['ok'])).toEqual({ ok: true, stdout: 'out', stderr: 'err' })
    expect(await checkHere.run(script, ['no'], { timeout: 5000, env: { PATH: '/usr/bin:/bin' } })).toMatchObject({ ok: false })
    expect(checkHere.read(join(folder, 'plain'))).toBe('words')
    expect(checkHere.read(join(folder, 'missing'))).toBeUndefined()
    expect(checkHere.executable(script)).toBe(true)
    expect(checkHere.executable(join(folder, 'plain'))).toBe(false)
  })

  it('puts its sandbox’s programs first and its own Node last, as the worker does', () => {
    expect(workerPath('/w', '/r', { HOME: '/home/althar' })).toBe(
      '/w/bin:/home/althar/.local/bin:/home/althar/.bun/bin:/home/althar/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/r/node/bin',
    )
  })

  it('says each tool on the PATH with its version', async () => {
    const here = machine({
      has: ['/usr/bin/git', '/home/althar/.local/bin/uv', '/usr/bin/go'],
      run: async (command) => ({
        ok: true,
        stdout: command.endsWith('git') ? 'git version 2.43.0\n' : command.endsWith('uv') ? 'uv 0.13.10 (abc 2026-11-01)' : '',
        stderr: '',
      }),
    })
    expect(await checkTools(PATH, here)).toEqual([
      { name: 'git', version: '2.43.0' },
      { name: 'uv', version: '0.13.10' },
      { name: 'go', version: 'unknown' },
    ])
  })
})

describe('its agents, started once', () => {
  it('reads the models a session offers from its own option', () => {
    const options = [
      { id: 'mode', name: 'Mode', category: 'mode', values: ['ask'] },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        values: ['opus', 'sonnet'],
        choices: [
          { value: 'opus', name: 'Claude Opus 5.5' },
          { value: 'sonnet', name: 'Claude Sonnet 5.5' },
        ],
      },
    ]
    expect(offeredModels(agents['claude-code'], options as never)).toEqual([
      { id: 'opus', name: 'Claude Opus 5.5' },
      { id: 'sonnet', name: 'Claude Sonnet 5.5' },
    ])
    // An agent whose option is by another id is read by its category; one with no names, by its values.
    const elsewhere = [{ id: 'llm', name: 'Model', category: 'model', values: ['gpt-6.2'] }]
    expect(offeredModels({ ...agents.codex, options: { ...agents.codex.options, model: 'model' } }, elsewhere as never)).toEqual([
      { id: 'gpt-6.2', name: 'gpt-6.2' },
    ])
    expect(offeredModels(agents.codex, [options[0]] as never)).toEqual([])
  })

  it('starts each signed-in agent with the sandbox as found, keeps why one couldn’t, and writes what it found', async () => {
    const folder = temporary()
    const started: Array<{ id: string; program: string; sandbox: boolean }> = []
    const here = machine({
      startAgent: async (definition, program, _env, sandbox) => {
        started.push({ id: definition.id, program, sandbox })
        if (definition.id === 'codex') throw new Error('Not signed in.\nmore')
        return [{ id: 'opus', name: 'Claude Opus 5.5' }]
      },
    })
    const found = await checkWorker(
      {
        folder,
        current: '/r',
        program: '/p',
        agents: [
          { id: 'claude-code', name: 'Claude Code', definition: agents['claude-code'], signedIn: true },
          { id: 'codex', name: 'Codex', definition: agents.codex, signedIn: true },
          { id: 'opencode', name: 'OpenCode', definition: agents.opencode, signedIn: false },
        ],
      },
      { ...here, executable: (path) => /\/(bwrap|socat)$/u.test(path) && path.startsWith(join(folder, 'bin')) },
    )
    expect(started).toEqual([
      { id: 'claude-code', program: join(folder, 'agents', 'claude-code'), sandbox: true },
      { id: 'codex', program: join(folder, 'agents', 'codex'), sandbox: true },
    ])
    expect(found.agents).toEqual([
      { id: 'claude-code', name: 'Claude Code', signedIn: true, started: true, models: [{ id: 'opus', name: 'Claude Opus 5.5' }] },
      { id: 'codex', name: 'Codex', signedIn: true, started: false, message: 'Not signed in.', models: [] },
      { id: 'opencode', name: 'OpenCode', signedIn: false, models: [] },
    ])
    // An agent that couldn't start is said too: the home keeps work from it there, with why.
    expect(readFileSync(join(folder, 'readiness'), 'utf8')).toBe(
      'sandbox\tstarts\nmodel\tclaude-code\topus\tClaude Opus 5.5\nagent\tclaude-code\tstarts\nagent\tcodex\tfails\tNot signed in.\n',
    )
  })

  it('starts an agent on this computer as a run does, in a folder of its own it then removes, and says the models it offers', async () => {
    const folder = temporary()
    const program = join(folder, 'agent')
    writeFileSync(program, `#!/bin/sh\nprintf '%s' "$PWD" > '${join(folder, 'cwd')}'\nexec bun '${fakeAgentMain}'\n`, { mode: 0o700 })
    // An agent as the fake: its own mode and model options, by the ids a session asks for them by.
    const asFake = (definition: AgentDefinition) => ({
      ...definition,
      modes: { ...definition.modes, ask: 'ask' },
      options: { ...definition.options, mode: 'mode', model: 'model' },
    })
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
    // Claude Code sends more as its session starts (its sandbox, as found); Codex nothing.
    expect(agents['claude-code'].sessionMeta).toBeDefined()
    expect(await checkHere.startAgent(asFake(agents['claude-code']), program, env, false)).toEqual([
      { id: 'small', name: 'Small' },
      { id: 'large', name: 'Large' },
    ])
    expect(agents.codex.sessionMeta).toBeUndefined()
    expect(await checkHere.startAgent(asFake(agents.codex), program, env, true)).toHaveLength(2)
    const cwd = readFileSync(join(folder, 'cwd'), 'utf8')
    expect(cwd).toContain('althar-worker-check-')
    expect(existsSync(cwd)).toBe(false)
    await expect(checkHere.startAgent(asFake(agents.codex), join(folder, 'missing'), env, false)).rejects.toBeDefined()
  })

  it('says why an agent couldn’t start in a line of its own words, and writes what it found only where it changed', async () => {
    const folder = temporary()
    const file = join(folder, 'readiness')
    const why: Readonly<Record<string, unknown>> = {
      'claude-code': 'Plain words.',
      codex: { not: 'an error' },
      opencode: new Error(`\n${'x'.repeat(400)}\nmore`),
    }
    let kept: string | undefined
    const here = {
      ...machine({
        startAgent: async (definition) => Promise.reject(why[definition.id]),
        read: (path) => (path === file ? kept : undefined),
      }),
      executable: (path: string) => /\/(bwrap|socat)$/u.test(path) && path.startsWith(join(folder, 'bin')),
    }
    const input = {
      folder,
      current: '/r',
      program: '/p',
      agents: (['claude-code', 'codex', 'opencode'] as const).map((id) => ({ id, name: id, definition: agents[id], signedIn: true })),
    }
    const found = await checkWorker(input, here)
    expect(found.agents.map((agent) => agent.message)).toEqual(['Plain words.', 'It couldn’t start.', `${'x'.repeat(299)}…`])
    kept = readFileSync(file, 'utf8')
    rmSync(file)
    await checkWorker(input, here)
    expect(existsSync(file)).toBe(false)
    expect(
      readinessLines({
        sandbox: { starts: true, bwrap: '/w/bin/bwrap' },
        tools: [],
        agents: [{ id: 'codex', name: 'Codex', signedIn: true, started: false, models: [] }],
      }),
    ).toBe('sandbox\tstarts\nagent\tcodex\tfails\tIt couldn’t start.\n')
  })

  it('keeps tabs and new lines out of what it writes', () => {
    expect(
      readinessLines({
        sandbox: { starts: false, problem: 'NoUserNamespaces', fix: 'sudo sh -c\t"x"' },
        tools: [{ name: 'node', version: '24.11.0' }],
        agents: [{ id: 'codex', name: 'Codex', signedIn: true, started: true, models: [{ id: 'a\tb', name: 'A\nB' }] }],
      }),
    ).toBe('sandbox\tfails\tNoUserNamespaces\nfix\tsudo sh -c "x"\ntool\tnode\t24.11.0\nmodel\tcodex\ta b\tA B\nagent\tcodex\tstarts\n')
  })
})
