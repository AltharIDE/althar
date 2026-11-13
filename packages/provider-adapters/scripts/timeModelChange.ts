/*
 * Times what the person waits for when the model changes, against a real agent over ACP, as Althar asks it: how long
 * `session/set_config_option` takes to answer on a session with no turn running, and on one in the middle of a turn. It
 * sends one short prompt per agent, so it costs a little usage.
 *
 *   node scripts/timeModelChange.ts claude-code
 *   node scripts/timeModelChange.ts codex
 *   node scripts/timeModelChange.ts claude-code tool    # the turn is a command that takes a while, not words
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import * as acp from '@agentclientprotocol/sdk'

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = (name: string, entry: string) => join(packageDir, 'node_modules', name, entry)

const agents: Record<string, { readonly command: string; readonly args: ReadonlyArray<string> }> = {
  'claude-code': { command: process.execPath, args: [bin('@agentclientprotocol/claude-agent-acp', 'dist/index.js')] },
  codex: { command: process.execPath, args: [bin('@agentclientprotocol/codex-acp', 'dist/index.js')] },
  opencode: { command: 'opencode', args: ['acp'] },
  copilot: { command: 'copilot', args: ['--acp', '--no-auto-update', '--disable-builtin-mcps'] },
}

const valuesOf = (options: acp.SessionConfigSelectOptions): Array<string> =>
  options.flatMap((option) => ('group' in option ? option.options.map((inner) => inner.value) : [option.value]))

const name = process.argv[2] ?? 'claude-code'
const spec = agents[name]
if (spec === undefined) throw new Error(`No agent ${name}`)
const cwd = mkdtempSync(join(tmpdir(), `althar-time-${name}-`))
const child = spawn(spec.command, [...spec.args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
const killer = setTimeout(() => child.kill('SIGKILL'), 240_000)
const t0 = performance.now()
const since = (from: number) => Math.round(performance.now() - from)
const lines: Array<string> = []
const say = (line: string) => {
  lines.push(line)
  process.stdout.write(`${line}\n`)
}

let heard: (() => void) | undefined
const first: Promise<void> = new Promise((resolve) => (heard = resolve))

try {
  await acp
    .client({ name: 'althar-time' })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      if (params.update.sessionUpdate === 'agent_message_chunk' || params.update.sessionUpdate === 'tool_call_update') heard?.()
    })
    .onRequest(acp.methods.client.session.requestPermission, (request) => {
      // Asked about the command, as agents do: it is allowed, so the turn is one that waits on it.
      const allow = request.params.options.find((option) => option.kind === 'allow_once' || option.kind === 'allow_always')
      return allow === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: allow.optionId } }
    })
    .connectWith(stream, async (context) => {
      await context.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
      const started = performance.now()
      const session = await context.request(acp.methods.agent.session.new, { cwd, mcpServers: [] })
      say(`${name}: session/new ${since(started)} ms`)
      const model = session.configOptions?.find((option) => option.category === 'model')
      if (model === undefined || model.type !== 'select') throw new Error('No model option')
      const values = valuesOf(model.options)
      const here = String(model.currentValue)
      const other = values.find((value) => value !== here) ?? here
      say(`${name}: models ${values.join(', ')}; on ${here}, switching to ${other}`)
      const set = async (value: string, label: string) => {
        const at = performance.now()
        const answer = await context.request(acp.methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: model.id,
          value,
        })
        const effort = answer.configOptions.find((option) => option.category === 'thought_level')
        say(
          `${name}: set model ${value} (${label}) answered in ${since(at)} ms` +
            (effort ? `; effort now ${String(effort.currentValue)}` : ''),
        )
        return effort
      }
      // With no turn running: to the other model, and back, three times.
      let effortOption: Awaited<ReturnType<typeof set>>
      for (const [index, value] of [other, here, other, here].entries()) effortOption = await set(value, `idle ${index + 1}`)
      if (effortOption?.type === 'select') {
        const levels = valuesOf(effortOption.options)
        const next = levels.find((level) => level !== String(effortOption?.currentValue)) ?? levels[0]
        if (next !== undefined) {
          const at = performance.now()
          await context.request(acp.methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: effortOption.id,
            value: next,
          })
          say(`${name}: set effort ${next} (idle) answered in ${since(at)} ms`)
        }
      }
      // In the middle of a turn: set once the agent has begun to answer, and say when the turn ended.
      const turnAt = performance.now()
      const turn = context.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [
          {
            type: 'text',
            text:
              process.argv[3] === 'tool'
                ? 'Run the shell command `sleep 40` once, then say done.'
                : 'Write the numbers from 1 to 250, each on its own line, with a few words about each. Use no tools.',
          },
        ],
      })
      const ended = turn.then(() => since(turnAt))
      await Promise.race([first, ended])
      const into = since(turnAt)
      const at = performance.now()
      await context.request(acp.methods.agent.session.setConfigOption, { sessionId: session.sessionId, configId: model.id, value: other })
      const waited = since(at)
      say(`${name}: set model ${other} (mid-turn, ${into} ms into the turn) answered in ${waited} ms`)
      say(`${name}: the turn ended ${await ended} ms after it began`)
    })
} catch (error) {
  say(`${name}: ${error instanceof Error ? error.message : JSON.stringify(error)}`)
} finally {
  clearTimeout(killer)
  child.kill('SIGTERM')
  rmSync(cwd, { recursive: true, force: true })
  say(`${name}: ${since(t0)} ms in all`)
}
process.exit(0)
