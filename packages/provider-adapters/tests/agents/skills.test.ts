import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'
import { projectRun, putObject } from '@althar/skills'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { skillsAmong, skillsIn } from '../../src/skills'
import { locate } from '../../src/installs'
import { adapterNode } from '../../src/process'
import { agents, bundledClaude, bundledCodex } from '../../src/registry'

/*
 * A skill in the person's folders or the repository reaches the real agent,
 * in homes of their own, with no sign-in and no model call: `bun run
 * test:agents`. Bundling a new version is what would break this. What each
 * finds isn't the same: each reads its own folders.
 *
 * OpenCode says nothing over ACP in 2.x, and only the names in 1.x, so it is
 * started against a stand-in model here, and what it offers that model read.
 *
 * The skills Althar selects for a lead reach it from a folder of Althar's own,
 * as the registry says for each (`skills.via`): Claude Code's as a local plugin
 * its session options name, Codex's as a directory added to its session,
 * OpenCode's in its config's `skills.paths`. Those are checked last, with no
 * model call either, on the folder `@althar/skills`' `projectRun` lays out:
 * what Claude Code and Codex list as a session opens, and what OpenCode lists
 * (`debug skill` in 1.x, its server's `/api/skill` in 2.x, which has no
 * `debug skill`). Each skips where its agent isn't there: Claude Code where
 * its adapter or the program it starts can't be found, OpenCode where none is
 * installed, or where ALTHAR_TEST_OPENCODE names one, as CI would the copy
 * Althar downloads, where that is missing.
 */

const skill = (root: string, name: string) => {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture ${name}.\n---\n\nThe marker is ${name}-marker.\n`)
}

/** A home and a repository with one skill in each place any of the agents reads. */
const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-skills-home-'))
  const repository = mkdtempSync(join(tmpdir(), 'althar-skills-repository-'))
  execFileSync('git', ['init', '-q'], { cwd: repository })
  skill(join(home, '.claude', 'skills'), 'person-claude')
  skill(join(home, '.agents', 'skills'), 'person-agents')
  skill(join(home, '.codex', 'skills'), 'person-codex')
  skill(join(home, '.config', 'opencode', 'skills'), 'person-opencode')
  skill(join(repository, '.claude', 'skills'), 'repo-claude')
  skill(join(repository, '.agents', 'skills'), 'repo-agents')
  skill(join(repository, '.opencode', 'skills'), 'repo-opencode')
  return { home, repository }
}

const withEnv = (env: Readonly<Record<string, string>>) => ({ PATH: process.env.PATH ?? '', TERM: 'dumb', ...env })

/**
 * Starts an agent over ACP as Althar does (an AIR client), opens a session, and hands back the commands it listed. The
 * session is opened with what else Althar asks it for, where given: its added directories, its `_meta`.
 */
const commandsOf = async (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: Readonly<Record<string, string>>,
  session: Pick<acp.NewSessionRequest, 'additionalDirectories' | '_meta'> = {},
): Promise<ReadonlyArray<acp.AvailableCommand>> => {
  const child = spawn(command, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] })
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
  try {
    let listed: ReadonlyArray<acp.AvailableCommand> = []
    await acp
      .client({ name: 'althar-skills-test' })
      .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (params.update.sessionUpdate === 'available_commands_update') listed = params.update.availableCommands
      })
      .connectWith(stream, async (context) => {
        await context.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { _meta: { jetbrains: { air: { capabilities: [] } } } },
        })
        await context.request(acp.methods.agent.session.new, { cwd, mcpServers: [], ...session })
        for (let waited = 0; waited < 30_000 && skillsAmong(listed) === undefined; waited += 250)
          await new Promise((resolve) => setTimeout(resolve, 250))
      })
    return listed
  } finally {
    child.kill()
  }
}

const opencode = locate('opencode', { bundled: null, kept: null })

const names = (commands: ReadonlyArray<acp.AvailableCommand>) => (skillsAmong(commands) ?? []).map(({ name }) => name).toSorted()

describe('the real agents find the skills', () => {
  it('Claude Code: its config folder and the repository’s .claude/skills', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    const spec = agents['claude-code'].launch(adapterNode())
    expect(names(await commandsOf(spec.command, spec.args, repository, withEnv({ HOME: home })))).toEqual(['person-claude', 'repo-claude'])
  })

  it('Claude Code: an account’s home, with the person’s `skills` linked in', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    const account = mkdtempSync(join(tmpdir(), 'althar-skills-account-'))
    execFileSync('ln', ['-s', join(home, '.claude', 'skills'), join(account, 'skills')])
    const spec = agents['claude-code'].launch(adapterNode())
    expect(names(await commandsOf(spec.command, spec.args, repository, withEnv({ HOME: home, CLAUDE_CONFIG_DIR: account })))).toEqual([
      'person-claude',
      'repo-claude',
    ])
  })

  it('Codex: ~/.agents/skills, its home’s skills and the repository’s .agents/skills', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    // A key that is never used: Codex opens no session signed out, and nothing here calls a model.
    writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-fixture' }))
    const spec = agents.codex.launch(adapterNode())
    const env = withEnv({ HOME: home, CODEX_PATH: bundledCodex() ?? '' })
    expect(names(await commandsOf(spec.command, spec.args, repository, env))).toEqual(['person-agents', 'person-codex', 'repo-agents'])
  })

  it('Codex: an account’s home sees ~/.agents/skills by itself, and its own `skills` where it is linked', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    const account = mkdtempSync(join(tmpdir(), 'althar-skills-account-'))
    writeFileSync(join(account, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-fixture' }))
    const spec = agents.codex.launch(adapterNode())
    const env = withEnv({ HOME: home, CODEX_HOME: account, CODEX_PATH: bundledCodex() ?? '' })
    expect(names(await commandsOf(spec.command, spec.args, repository, env))).toEqual(['person-agents', 'repo-agents'])
    execFileSync('ln', ['-s', join(home, '.codex', 'skills'), join(account, 'skills')])
    expect(names(await commandsOf(spec.command, spec.args, repository, env))).toEqual(['person-agents', 'person-codex', 'repo-agents'])
  })

  /** What OpenCode offers a stand-in model, started with this environment and this config. */
  const offeredByOpenCode = async (
    repository: string,
    env: Readonly<Record<string, string>>,
    own: Readonly<Record<string, unknown>> = {},
  ) => {
    const http = await import('node:http')
    const offered: Array<string> = []
    const server = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        offered.push(body)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const base = { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'm' }
        response.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] })}\n\n`,
        )
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { readonly port: number }
    const config = {
      ...own,
      provider: {
        stub: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'x' },
          models: { m: { name: 'm', tool_call: true } },
        },
      },
      model: 'stub/m',
      small_model: 'stub/m',
    }
    const child = spawn(opencode?.command ?? 'opencode', ['acp'], {
      cwd: repository,
      env: withEnv({ ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }),
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
    try {
      await acp
        .client({ name: 'althar-skills-test' })
        .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
        .connectWith(stream, async (context) => {
          await context.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
          const { sessionId } = await context.request(acp.methods.agent.session.new, { cwd: repository, mcpServers: [] })
          await context.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'Hello' }] })
        })
    } finally {
      child.kill()
      server.close()
    }
    return offered.join('\n')
  }

  it.skipIf(opencode === null)('OpenCode: all of its folders, in what it offers its model', { timeout: 90_000 }, async () => {
    const { home, repository } = fixture()
    const expected = skillsIn(agents.opencode.skillFolders?.({ env: {}, homeDir: home, cwd: repository }) ?? [])
      .map(({ name }) => name)
      .toSorted()
    expect(expected).toEqual(['person-agents', 'person-claude', 'person-opencode', 'repo-agents', 'repo-claude', 'repo-opencode'])
    const said = await offeredByOpenCode(repository, { HOME: home })
    for (const name of expected) expect(said).toContain(name)
  })

  it.skipIf(opencode === null)(
    'OpenCode inside a Flatpak: the person’s config folder, named to it as its config home is the app’s',
    { timeout: 120_000 },
    async () => {
      const { home, repository } = fixture()
      const env = { HOME: home, XDG_CONFIG_HOME: join(home, '.var', 'app', 'dev.althar.app', 'config') }
      const configOf = (inSandbox: boolean) =>
        JSON.parse(agents.opencode.withoutOwnTools?.({ env, homeDir: home, cwd: repository, inSandbox }).OPENCODE_CONFIG_CONTENT ?? '{}')
      expect(await offeredByOpenCode(repository, env, configOf(false))).not.toContain('person-opencode')
      expect(await offeredByOpenCode(repository, env, configOf(true))).toContain('person-opencode')
    },
  )
})

/**
 * A run's folder as Althar lays it out, by `@althar/skills`' own `projectRun`, for an agent's layout: the folder Althar
 * hands the agent, its real path (macOS' temporary folder is under a link), and where its skills are in it.
 */
const runFolder = async (agent: string, layout: 'claude-plugin' | 'agents' | 'plain', names: ReadonlyArray<string>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-skills-store-'))
  const selected = []
  for (const name of names) {
    const files = new Map([
      ['SKILL.md', new TextEncoder().encode(`---\nname: ${name}\ndescription: Fixture ${name}.\n---\n\nThe marker is ${name}-marker.\n`)],
    ])
    selected.push({ id: name, treeHash: await Effect.runPromise(putObject(root, files)) })
  }
  const { directory, projected } = await Effect.runPromise(
    projectRun({ root, runId: 'run-1', agent, selected, capabilities: [], keepOutOf: [], layout }),
  )
  expect(projected).toEqual(names)
  const folder = realpathSync(directory)
  const skillsAt = layout === 'claude-plugin' ? join(folder, 'skills') : layout === 'agents' ? join(folder, '.agents', 'skills') : folder
  return { directory, skillsAt }
}

/** Whether a path an agent reports is under a folder, both by their real paths. */
const under = (path: string, folder: string) => {
  try {
    return realpathSync(path).startsWith(`${folder}/`)
  } catch {
    return false
  }
}

/** The skills listed from under a folder, by name. */
const namesUnder = (commands: ReadonlyArray<acp.AvailableCommand>, folder: string) =>
  (skillsAmong(commands) ?? [])
    .filter(({ path }) => under(path, folder))
    .map(({ name }) => name)
    .toSorted()

/** Claude Code as Althar starts it: its adapter, and the program the adapter starts. Null where either is missing. */
const claudeCode = (() => {
  try {
    return bundledClaude() === null ? null : agents['claude-code'].launch(adapterNode())
  } catch {
    return null
  }
})()

/** The OpenCode to check, and its major version: the one ALTHAR_TEST_OPENCODE names where it does, else the person's. */
const openCodeToCheck = (() => {
  const named = process.env.ALTHAR_TEST_OPENCODE
  const command = named === undefined || named === '' ? opencode?.command : named
  if (command === undefined) return null
  try {
    const version = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: withEnv({ HOME: mkdtempSync(join(tmpdir(), 'althar-skills-home-')) }),
    })
    const major = Number(/(\d+)\./.exec(version)?.[1])
    return Number.isInteger(major) ? { command, major } : null
  } catch {
    return null
  }
})()

/** What OpenCode 2.x lists from its own server, `GET /api/skill`, started in this environment: each skill's name and file. */
const listedByOpenCodeServer = async (command: string, cwd: string, env: Readonly<Record<string, string>>) => {
  const password = 'fixture'
  const child = spawn(command, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd,
    env: { ...env, OPENCODE_SERVER_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let said = ''
      child.stdout.on('data', (chunk: Buffer) => {
        said += chunk.toString()
        const at = /listening on (http:\/\/\S+)/.exec(said)?.[1]
        if (at !== undefined) resolve(at)
      })
      child.on('exit', (code) => reject(new Error(`opencode serve ended (${code}): ${said}`)))
    })
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    // It loads its skills a moment after it starts listening: asked until it lists one of its own.
    for (let waited = 0; waited < 30_000; waited += 250) {
      const answer = (await (await fetch(`${url}/api/skill`, { headers: { authorization } })).json()) as {
        readonly data?: ReadonlyArray<{ readonly name: string; readonly path: string }>
      }
      if ((answer.data ?? []).length > 0) return answer.data ?? []
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return []
  } finally {
    child.kill()
  }
}

describe('the real agents find the skills Althar gives a lead', () => {
  it.skipIf(claudeCode === null)('Claude Code: the run’s plugin, as its session options name it', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    const definition = agents['claude-code']
    expect(definition.skills?.via.kind).toBe('meta')
    const { directory } = await runFolder('claude-code', definition.skills?.layout ?? 'plain', ['althar-alpha', 'althar-beta'])
    const spec = claudeCode ?? definition.launch(adapterNode())
    const _meta = definition.sessionMeta?.('lead', { skills: directory })
    const listed = await commandsOf(spec.command, spec.args, repository, withEnv({ HOME: home }), _meta ? { _meta } : {})
    // Listed among its commands as the plugin's, `althar:<skill>`, though with no path to say where from (claude-agent-acp
    // 0.101.0): only the run's plugin is named `althar`.
    expect(
      listed
        .map(({ name }) => name)
        .filter((name) => name.startsWith('althar:'))
        .toSorted(),
    ).toEqual(['althar:althar-alpha', 'althar:althar-beta'])
  })

  it.skipIf(bundledCodex() === null)('Codex: the run’s folder, added to its session', { timeout: 60_000 }, async () => {
    const { home, repository } = fixture()
    expect(agents.codex.skills?.via.kind).toBe('directory')
    writeFileSync(join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-fixture' }))
    const { directory, skillsAt } = await runFolder('codex', agents.codex.skills?.layout ?? 'plain', ['althar-alpha', 'althar-beta'])
    const spec = agents.codex.launch(adapterNode())
    const env = withEnv({ HOME: home, CODEX_PATH: bundledCodex() ?? '' })
    const listed = await commandsOf(spec.command, spec.args, repository, env, { additionalDirectories: [directory] })
    expect(namesUnder(listed, skillsAt)).toEqual(['althar-alpha', 'althar-beta'])
  })

  it.skipIf(openCodeToCheck === null)(
    `OpenCode ${openCodeToCheck?.major ?? ''}.x: the run’s folder, among its config’s skills.paths, as it lists its skills`,
    { timeout: 90_000 },
    async () => {
      const { home, repository } = fixture()
      const via = agents.opencode.skills?.via
      if (via?.kind !== 'env') throw new Error(`OpenCode is given its skills by ${via?.kind ?? 'nothing'}`)
      const { directory, skillsAt } = await runFolder('opencode', agents.opencode.skills?.layout ?? 'plain', [
        'althar-alpha',
        'althar-beta',
      ])
      // Its environment as Althar starts it (runtime's Config.ts): its own config, then the run's folder added to it.
      const own = agents.opencode.withoutOwnTools?.({ env: { HOME: home }, homeDir: home, cwd: repository }) ?? {}
      const env = withEnv({ HOME: home, ...own, ...via.env(directory, own) })
      const command = openCodeToCheck?.command ?? 'opencode'
      const listed: ReadonlyArray<{ readonly name: string; readonly path: string }> =
        (openCodeToCheck?.major ?? 0) >= 2
          ? await listedByOpenCodeServer(command, repository, env)
          : (
              JSON.parse(
                execFileSync(command, ['debug', 'skill'], { cwd: repository, env, encoding: 'utf8', timeout: 50_000 }),
              ) as ReadonlyArray<{
                readonly name: string
                readonly location: string
              }>
            ).map(({ name, location }) => ({ name, path: location }))
      expect(
        listed
          .filter(({ path }) => under(path, skillsAt))
          .map(({ name }) => name)
          .toSorted(),
      ).toEqual(['althar-alpha', 'althar-beta'])
    },
  )
})
