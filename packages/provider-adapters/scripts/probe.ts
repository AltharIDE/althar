/*
 * Starts each agent over ACP, creates a session in a scratch folder, prints
 * what it reports (capabilities, sign-in methods, modes, config options), and
 * stops it. It puts the session on each model in turn, to print each one's
 * effort levels: an agent may offer them only once a session is on a model
 * that has some. It sends no prompt, so it costs no usage.
 *
 *   bun run probe            # every agent
 *   bun run probe codex      # one agent
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
}

/** A select's values, its groups' included. */
const valuesOf = (options: acp.SessionConfigSelectOptions): Array<string> =>
  options.flatMap((option) => ('group' in option ? option.options.map((inner) => inner.value) : [option.value]))

const probe = async (name: string, spec: { readonly command: string; readonly args: ReadonlyArray<string> }) => {
  const cwd = mkdtempSync(join(tmpdir(), `althar-probe-${name}-`))
  const child = spawn(spec.command, [...spec.args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000)
  try {
    const report = await acp
      .client({ name: 'althar-probe' })
      .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
      .connectWith(stream, async (context) => {
        const init = await context.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
        const session = await context.request(acp.methods.agent.session.new, { cwd, mcpServers: [] })
        const model = session.configOptions?.find((option) => option.category === 'model')
        const efforts: Record<string, unknown> = {}
        for (const value of model?.type === 'select' ? valuesOf(model.options) : []) {
          const set = await context.request(acp.methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: model?.id ?? 'model',
            value,
          })
          const effort = set.configOptions.find((option) => option.category === 'thought_level')
          efforts[value] = effort?.type === 'select' ? { current: effort.currentValue, levels: valuesOf(effort.options) } : null
        }
        return { init, session, efforts }
      })
    process.stdout.write(`${JSON.stringify({ agent: name, ...report }, null, 2)}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error)
    process.stdout.write(`${JSON.stringify({ agent: name, error: message, stderr: stderr.slice(-2000) }, null, 2)}\n`)
  } finally {
    clearTimeout(timeout)
    child.kill('SIGTERM')
    rmSync(cwd, { recursive: true, force: true })
  }
}

const only = process.argv[2]
for (const [name, spec] of Object.entries(agents)) {
  if (only === undefined || only === name) await probe(name, spec)
}
process.exit(0)
