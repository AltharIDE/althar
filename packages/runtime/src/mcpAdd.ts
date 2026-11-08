import type { NewServer, ServerDetail, ToolFile } from '@althar/contracts'
import { agentServers, runsOf, sameServer, type ServerSpec, SYNCED_AGENTS, type SyncedAgent } from '@althar/provider-adapters'
import { Duration, Effect, Option, Schema } from 'effect'

import { expandedSpec, FILES, repositoryServersOf, signInOf, syncIo } from './agentTools'
import { probeServer, type Probed, readHealth } from './mcpHealth'
import { asCodexWrites, claudeLines, codexLines, mask, openCodeLines } from './mcpLines'
import * as mcp from './mcpSync'

/*
 * The person's own MCP servers, added, taken out and shown in their agents'
 * own files (ADR-097), as Settings' MCP servers tiles do it. Adding and taking
 * out are the person's own acts: what is added is theirs in each agent, not
 * "Added by Althar", and taking one out takes it out of every agent, whoever
 * put it there. Both write as sync does (`mcpSync.ts`): through each agent's
 * own command, OpenCode's JSON edited in place, a copy of each file kept
 * before Althar first writes to it. An agent that can't be written doesn't
 * stop the others; the call fails afterwards, naming each one not changed.
 */

/** Why a server couldn't be added, taken out or shown, in words for the person. */
export class ServerRefused extends Schema.TaggedError<ServerRefused>()('ServerRefused', { message: Schema.String }) {}

const NAME = /^[A-Za-z0-9_-]+$/
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** How long Althar's own check of a server may take before the detail is shown without its count. */
const PROBE_CAP = Duration.seconds(10)

const named = (agents: ReadonlyArray<SyncedAgent>) => {
  const names = agents.map((agent) => mcp.AGENT_NAMES[agent])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Why a server can't go to an agent, in words that follow "it", for that agent. */
const cantWords = (why: mcp.Cant, agent: SyncedAgent) => {
  const name = mcp.AGENT_NAMES[agent]
  return why === 'sse'
    ? `it runs over SSE, which ${name} doesn’t take`
    : why === 'secret'
      ? `it has a token written out in its settings, so it isn’t copied to ${name}. Give it as a variable to copy it`
      : why === 'headers'
        ? `it sends headers ${name} can’t be given`
        : `it reads a variable ${name} takes only as a value`
}

const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}.`

/** A server's entry, as one agent keeps it. */
const linesIn = (agent: SyncedAgent, spec: ServerSpec) =>
  agent === 'claude' ? claudeLines(mask(spec)) : agent === 'codex' ? codexLines(mask(spec)) : openCodeLines(mask(spec))

/** Althar's own check of a server, as the detail says it: never failing the call, and never longer than its cap. */
const probe = (spec: ServerSpec) =>
  Effect.tryPromise({ try: () => probeServer(expandedSpec(spec)), catch: (error) => error }).pipe(
    Effect.timeoutOption(PROBE_CAP),
    Effect.map((found): Probed => (Option.isSome(found) ? found.value : { tools: null, why: 'It didn’t answer within 10 seconds.' })),
    Effect.catch((error) =>
      Effect.succeed<Probed>({
        tools: null,
        why: `Althar couldn’t ask it for its tools: ${error instanceof Error ? error.message : String(error)}`,
      }),
    ),
  )

const refused = () => new ServerRefused({ message: 'This Althar doesn’t read your agents’ settings.' })

/**
 * One server opened out: for one of the person's, each agent's own file as it keeps it, or would where it isn't
 * there; for a repository's own, its `.mcp.json`. With the count of its tools, where Althar's own check could read it.
 */
export const serverDetail = (name: string, repository: string | null) =>
  Effect.gen(function* () {
    const io = yield* syncIo
    if (io === undefined) return yield* Effect.fail(refused())
    if (repository !== null) {
      const spec = (yield* repositoryServersOf(repository)).find((one) => one.name === name)
      if (spec === undefined)
        return yield* Effect.fail(new ServerRefused({ message: `This project’s repository has no server named ${name}.` }))
      const file: ToolFile = {
        agent: 'repository',
        where: '.mcp.json',
        state: 'yours',
        lines: claudeLines(mask(spec)),
        runs: runsOf(spec),
        why: null,
        signIn: 'unknown',
      }
      const probed = yield* probe(spec)
      return {
        name,
        runs: runsOf(spec),
        files: [file],
        tools: probed.tools,
        toolsWhy: probed.tools === null ? probed.why : null,
      } satisfies ServerDetail
    }
    const health = readHealth(io)
    const { record, plan } = mcp.syncState(io)
    const having = plan.agents.flatMap((each) => {
      const spec = each.problem === undefined ? each.servers.find((one) => one.name === name) : undefined
      return spec === undefined ? [] : [{ agent: each.agent, spec }]
    })
    const shown = having[0]?.spec
    if (shown === undefined) return yield* Effect.fail(new ServerRefused({ message: `None of your agents has a server named ${name}.` }))
    const { off: _, ...wouldWrite } = shown
    const files = SYNCED_AGENTS.map((agent): ToolFile => {
      const found = plan.agents.find((each) => each.agent === agent)
      const where = found?.file ?? FILES[agent]
      const own = having.find((one) => one.agent === agent)?.spec
      if (own !== undefined)
        return {
          agent,
          where,
          state: !sameServer(own, shown)
            ? 'differs'
            : record.added.some((each) => each.agent === agent && each.spec.name === name)
              ? 'copied'
              : 'yours',
          lines: linesIn(agent, own),
          runs: runsOf(own),
          why: null,
          signIn: signInOf(health, own, agent),
        }
      // Not there: the lines Althar would write there, for the person to see what would go.
      const lines = linesIn(agent, agent === 'codex' ? asCodexWrites(wouldWrite) : wouldWrite)
      const base = { agent, where, lines, runs: runsOf(shown), signIn: 'unknown' as const }
      if (found?.problem !== undefined)
        return { ...base, state: 'cant', why: `Its settings can’t be read: ${found.problem}. Nothing is written there until they can.` }
      if (record.keptOut[agent].includes(name)) return { ...base, state: 'out', why: null }
      const cant = mcp.cantGo(shown, agent)
      if (cant !== undefined) return { ...base, state: 'cant', why: sentence(cantWords(cant, agent)) }
      return { ...base, state: 'missing', why: null }
    })
    const probed = yield* probe(shown)
    return {
      name,
      runs: runsOf(shown),
      files,
      tools: probed.tools,
      toolsWhy: probed.tools === null ? probed.why : null,
    } satisfies ServerDetail
  })

/** What is wrong with a server the person adds, in words; undefined where nothing is. */
const problemOf = (server: NewServer, agents: ReadonlyArray<SyncedAgent>): string | undefined => {
  const url = server.url?.trim() ?? ''
  const command = server.command?.trim() ?? ''
  if (agents.length === 0) return 'Choose an agent to add it to.'
  if (!NAME.test(server.name)) return 'A server’s name is letters, digits, hyphens and underscores.'
  if (server.name.toLowerCase() === 'althar') return 'althar is the name of Althar’s own server.'
  if ((url === '') === (command === ''))
    return url === '' ? 'Give it an address or a command.' : 'Give it an address or a command, not both.'
  if (url !== '') {
    const parsed = URL.canParse(url) ? new URL(url) : undefined
    if (parsed === undefined || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:'))
      return 'Its address starts with https:// or http://.'
    if (server.args !== undefined && server.args.length > 0) return 'Only a command takes arguments.'
    if (server.env !== undefined && Object.keys(server.env).length > 0) return 'Only a command takes variables; an address takes headers.'
  } else if (server.headers !== undefined && Object.keys(server.headers).length > 0) return 'Only an address takes headers.'
  const badVariable = Object.keys(server.env ?? {}).find((key) => !VARIABLE.test(key))
  if (badVariable !== undefined)
    return `${badVariable} isn’t a variable’s name: letters, digits and underscores, not starting with a digit.`
  const badHeader = Object.keys(server.headers ?? {}).find((key) => !HEADER.test(key))
  if (badHeader !== undefined) return `${badHeader} isn’t a header’s name.`
  return undefined
}

/** The server as the agents' files keep it. */
const specOf = (server: NewServer): ServerSpec => {
  const url = server.url?.trim() ?? ''
  const has = (values: Readonly<Record<string, string>> | undefined) => values !== undefined && Object.keys(values).length > 0
  return url !== ''
    ? { name: server.name, transport: 'http', url, ...(has(server.headers) ? { headers: server.headers! } : {}) }
    : {
        name: server.name,
        transport: 'stdio',
        command: server.command?.trim() ?? '',
        ...(server.args === undefined || server.args.length === 0 ? {} : { args: server.args }),
        ...(has(server.env) ? { env: server.env! } : {}),
      }
}

/** Runs one agent's own command; why it didn't change that agent, in words, where it didn't. */
const runFor = async (io: mcp.SyncIo, agent: 'claude' | 'codex', args: ReadonlyArray<string>): Promise<string | undefined> => {
  const { code, output } = await io.run(agent, args)
  if (code === 0) return undefined
  if (code === 127) return `its \`${agent}\` command isn’t on this computer`
  return output.trim().split('\n').at(-1) || 'its command failed'
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The agents not changed, each with why, as the call's one failure. */
const notChanged = (failures: ReadonlyArray<{ readonly agent: SyncedAgent; readonly why: string }>) =>
  new ServerRefused({
    message: failures.map(({ agent, why }) => `${mcp.AGENT_NAMES[agent]} wasn’t changed: ${why.replace(/\.$/, '')}.`).join(' '),
  })

const read = (io: mcp.SyncIo) => SYNCED_AGENTS.map((agent) => agentServers(agent, io.home))

/**
 * Adds a server to each agent listed, in its own file, as the person's own: never over one of the same name there.
 * Sync's record sees it as already seen, so a switch that is on doesn't take it for one the person added by hand.
 */
export const addServer = (io: mcp.SyncIo, server: NewServer, agents: ReadonlyArray<SyncedAgent>) =>
  mcp.serialized(io, async () => {
    const listed = SYNCED_AGENTS.filter((agent) => agents.includes(agent))
    const problem = problemOf(server, listed)
    if (problem !== undefined) throw new ServerRefused({ message: problem })
    const before = read(io)
    const taken = listed.filter((agent) => before.find((each) => each.agent === agent)?.servers.some((one) => one.name === server.name))
    if (taken.length > 0)
      throw new ServerRefused({ message: `${named(taken)} already ${taken.length === 1 ? 'has' : 'have'} a server named ${server.name}.` })
    const spec = specOf(server)
    let record = mcp.readRecord(io)
    const written: Array<SyncedAgent> = []
    const failures: Array<{ agent: SyncedAgent; why: string }> = []
    for (const agent of listed) {
      const found = before.find((each) => each.agent === agent)!
      if (found.problem !== undefined) {
        failures.push({ agent, why: `its settings can’t be read: ${found.problem}` })
        continue
      }
      const cant = mcp.codexCant(spec, agent)
      if (cant !== undefined) {
        failures.push({ agent, why: cantWords(cant, agent) })
        continue
      }
      try {
        record = mcp.backUp(io, record, agent, found.path)
        const why =
          agent === 'opencode'
            ? (mcp.editOpenCode(found.path, spec.name, mcp.openCodeEntry(spec)), undefined)
            : await runFor(
                io,
                agent,
                agent === 'claude'
                  ? ['mcp', 'add-json', '--scope', 'user', spec.name, JSON.stringify(mcp.claudeJson(spec))]
                  : mcp.codexArgs(spec),
              )
        if (why === undefined) written.push(agent)
        else failures.push({ agent, why })
      } catch (error) {
        failures.push({ agent, why: said(error) })
      }
    }
    const keptOut = Object.fromEntries(
      SYNCED_AGENTS.map((agent) => [
        agent,
        written.includes(agent) ? record.keptOut[agent].filter((name) => name !== spec.name) : record.keptOut[agent],
      ]),
    ) as mcp.SyncRecord['keptOut']
    mcp.writeRecord(io, { ...record, keptOut, seen: mcp.seenNow(read(io), record.seen) })
    if (failures.length > 0) throw notChanged(failures)
  })

/**
 * Takes a server out of every agent whose file has it, and out of what sync keeps for it, so sync doesn't copy it
 * back. Where one agent couldn't be changed, the others that were keep it out, so sync doesn't copy it back from that one.
 */
export const removeServer = (io: mcp.SyncIo, name: string) =>
  mcp.serialized(io, async () => {
    let record = mcp.readRecord(io)
    const agents = read(io)
    const having = agents.filter((each) => each.problem === undefined && each.servers.some((one) => one.name === name))
    const known =
      record.added.some((each) => each.spec.name === name) ||
      SYNCED_AGENTS.some((agent) => record.keptOut[agent].includes(name)) ||
      record.picks[name] !== undefined
    if (having.length === 0 && !known) throw new ServerRefused({ message: `None of your agents has a server named ${name}.` })
    const failures: Array<{ agent: SyncedAgent; why: string }> = []
    for (const found of having) {
      const agent = found.agent
      try {
        record = mcp.backUp(io, record, agent, found.path)
        const why =
          agent === 'opencode'
            ? (mcp.editOpenCode(found.path, name, undefined), undefined)
            : await runFor(io, agent, agent === 'claude' ? ['mcp', 'remove', '--scope', 'user', name] : ['mcp', 'remove', name])
        if (why !== undefined) failures.push({ agent, why })
      } catch (error) {
        failures.push({ agent, why: said(error) })
      }
    }
    const stillIn = failures.map((each) => each.agent)
    const { [name]: _, ...picks } = record.picks
    const keptOut = Object.fromEntries(
      SYNCED_AGENTS.map((agent): readonly [SyncedAgent, ReadonlyArray<string>] => {
        const others = record.keptOut[agent].filter((one) => one !== name)
        return [agent, stillIn.length > 0 && !stillIn.includes(agent) ? [...others, name] : others]
      }),
    ) as mcp.SyncRecord['keptOut']
    mcp.writeRecord(io, {
      ...record,
      added: record.added.filter((each) => each.spec.name !== name || stillIn.includes(each.agent)),
      keptOut,
      picks,
      signedIn: record.signedIn.filter((each) => !each.startsWith(`${name}:`)),
      seen: mcp.seenNow(read(io), record.seen),
    })
    if (failures.length > 0) throw notChanged(failures)
  })
