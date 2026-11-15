import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import * as acp from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { removeTree } from '@althar/testing'

import { nativeAgent, type NativeAgentOptions, type NativeModel, type NativeProvider, type NativeRequest } from '../src/native/agent'

const folders: string[] = []
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), 'althar-native-edges-'))
  folders.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => removeTree(path)))
})

const model: NativeModel = { id: 'model', name: 'Test model', context: 128_000, output: 4096, images: true }
const provider = (complete: NativeProvider['complete'], models: ReadonlyArray<NativeModel> = [model]): NativeProvider => ({
  models: async () => models,
  complete,
})
const allow: acp.RequestPermissionResponse = { outcome: { outcome: 'selected', optionId: 'allow' } }

/** Drives the agent over ACP directly, so a test can send what Althar's own connection never would. */
const drive = <T>(
  agent: NativeProvider,
  run: (client: acp.ClientContext, updates: acp.SessionUpdate[]) => Promise<T>,
  options: NativeAgentOptions = {},
  permission: (request: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse> = async () => allow,
) => {
  const updates: acp.SessionUpdate[] = []
  return acp
    .client({ name: 'Althar test' })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => permission(params))
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })
    .connectWith(nativeAgent(agent, options).app, async (client) => {
      await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
      return run(client, updates)
    })
}
const start = (client: acp.ClientContext, cwd: string, mcpServers: acp.McpServer[] = []) =>
  client.request(acp.methods.agent.session.new, { cwd, mcpServers })
const say = (client: acp.ClientContext, sessionId: string, ...prompt: acp.ContentBlock[]) =>
  client.request(acp.methods.agent.session.prompt, { sessionId, prompt })
const words = (text: string): acp.ContentBlock => ({ type: 'text', text })

describe('Althar’s native agent, at its edges', () => {
  it('gives the model the work file, every repository’s instructions up to its root, and each skill, and leaves commands out offline', async () => {
    const root = await folder()
    const cwd = join(root, 'repo', 'package')
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    await mkdir(cwd, { recursive: true })
    await writeFile(join(root, 'repo', 'AGENTS.md'), 'Run the checks.')
    await writeFile(join(root, 'AGENTS.md'), 'Outside the repository.')
    await writeFile(join(root, 'work.md'), 'The task’s work file.')
    const skills = join(root, 'skills')
    await mkdir(join(skills, 'review'), { recursive: true })
    await mkdir(join(skills, 'empty'), { recursive: true })
    await writeFile(join(skills, 'review', 'SKILL.md'), 'Review a change.')
    await writeFile(join(skills, 'loose.md'), 'Not a skill.')
    let seen: NativeRequest | undefined
    await drive(
      provider(async (request) => {
        seen = request
        return { text: 'Ready.', tools: [] }
      }),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        await say(client, sessionId, words('Begin.'))
      },
      { env: { ALTHAR_WORK: join(root, 'work.md') }, skills, offline: true },
    )
    const content = seen?.messages[0]?.content
    const system = typeof content === 'string' ? content : ''
    expect(system).toContain('The task’s work file.')
    expect(system).toContain(`Repository instructions (${join(root, 'repo')}/AGENTS.md):\nRun the checks.`)
    expect(system).not.toContain('Outside the repository.')
    expect(system).toContain(`Available skill: review. Read ${join(skills, 'review', 'SKILL.md')} when applicable.\nReview a change.`)
    expect(system).not.toContain('empty')
    expect(system).not.toContain('Not a skill.')
    expect(seen?.tools.map((tool) => tool.name)).not.toContain('run_command')
  })

  it('refuses to start without models, says why when the provider fails oddly, and refuses an SSE MCP server', async () => {
    const cwd = await folder()
    await drive(
      provider(async () => ({ text: '', tools: [] }), []),
      async (client) => {
        await expect(start(client, cwd)).rejects.toThrow('offers no usable models')
      },
    )
    await drive(
      {
        models: () => Promise.reject('not an error'),
        complete: async () => ({ text: '', tools: [] }),
      },
      async (client) => {
        await expect(start(client, cwd)).rejects.toThrow('could not start this session')
      },
    )
    await drive(
      provider(async () => ({ text: '', tools: [] })),
      async (client) => {
        await expect(start(client, cwd, [{ type: 'sse', name: 'old', url: 'http://127.0.0.1:1', headers: [] }])).rejects.toThrow(
          'HTTP or stdio',
        )
      },
    )
  })

  it('turns attached files and links into words, and refuses input it cannot read', async () => {
    const cwd = await folder()
    let seen: NativeRequest['messages'][number]['content'] = ''
    await drive(
      provider(async (request) => {
        seen = request.messages.at(-1)?.content ?? ''
        return { text: 'Read them.', tools: [] }
      }),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        await say(
          client,
          sessionId,
          words('Look.'),
          { type: 'resource', resource: { uri: 'file:///notes.txt', text: 'The notes.' } },
          { type: 'resource_link', uri: pathToFileURL(join(cwd, 'report.pdf')).href, name: 'report.pdf' },
          { type: 'resource_link', uri: 'https://example.com/spec', name: 'spec' },
        )
        await expect(say(client, sessionId, { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' })).rejects.toThrow(
          "not supported by Althar's native agent: audio",
        )
      },
    )
    expect(seen).toBe(
      [
        'Look.',
        'Attached resource file:///notes.txt:\nThe notes.',
        `Attached report.pdf: ${join(cwd, 'report.pdf')}. Inspect it with your tools.`,
        'Attached spec: https://example.com/spec. Inspect it with your tools.',
      ].join('\n'),
    )
  })

  it('keeps images from a model that can’t read them, past or present', async () => {
    const cwd = await folder()
    const requests: NativeRequest[] = []
    const image: acp.ContentBlock = { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }
    await drive(
      provider(
        async (request) => {
          requests.push(request)
          return { text: 'Seen.', tools: [] }
        },
        [model, { ...model, id: 'blind', name: 'Blind', images: false }],
      ),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        await say(client, sessionId, words('Look.'), image)
        await client.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'blind' })
        await expect(say(client, sessionId, words('Again.'), image)).rejects.toThrow('cannot read images')
        await say(client, sessionId, words('Describe it.'))
      },
    )
    expect(requests.at(-1)?.messages[1]?.content).toEqual([
      { type: 'text', text: 'Look.' },
      { type: 'text', text: '[An earlier image is unavailable to this model.]' },
    ])
  })

  it('refuses options it doesn’t offer, changes while a turn runs, a second turn, and an ended session', async () => {
    const cwd = await folder()
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => undefined
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    await drive(
      provider(async () => {
        started()
        await released
        return { text: 'Done.', tools: [] }
      }),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        const set = (configId: string, value: string) =>
          client.request(acp.methods.agent.session.setConfigOption, { sessionId, configId, value })
        await expect(set('mode', 'yolo')).rejects.toThrow('not available')
        await expect(set('effort', 'high')).rejects.toThrow('not available')
        expect((await set('mode', 'read-only')).configOptions.find((option) => option.id === 'mode')?.currentValue).toBe('read-only')
        const turn = say(client, sessionId, words('Work.'))
        await running
        await expect(set('mode', 'ask')).rejects.toThrow('Stop the turn')
        await expect(say(client, sessionId, words('Also this.'))).rejects.toThrow('already running')
        release()
        expect(await turn).toMatchObject({ stopReason: 'end_turn' })
        await client.request(acp.methods.agent.session.close, { sessionId })
        await expect(say(client, sessionId, words('After.'))).rejects.toThrow('session has ended')
      },
    )
  })

  it('keeps a model’s reasoning for its next request and says when it stopped early', async () => {
    const cwd = await folder()
    const requests: NativeRequest[] = []
    const continuation = { model: 'model', protocol: 'responses', items: [{ type: 'reasoning' }] }
    await drive(
      provider(async (request) => {
        requests.push(request)
        return { text: 'Cut', tools: [], continuation, stopped: 'max_tokens' }
      }),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        expect(await say(client, sessionId, words('Write a lot.'))).toMatchObject({ stopReason: 'max_tokens' })
        await say(client, sessionId, words('Go on.'))
      },
    )
    expect(requests[1]?.messages[2]).toMatchObject({ role: 'assistant', content: 'Cut', continuation })
  })

  it.skipIf(process.platform === 'win32')(
    'shows a command’s output as a terminal, fails it on a non-zero exit, and passes an MCP tool’s images on',
    async () => {
      const cwd = await folder()
      const server = createServer(async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405).end()
          return
        }
        let data = ''
        for await (const chunk of request) data += String(chunk)
        const value = JSON.parse(data) as { id?: number; method: string }
        if (value.id === undefined) {
          response.writeHead(202).end()
          return
        }
        const result =
          value.method === 'initialize'
            ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'edges', version: '1' } }
            : value.method === 'tools/list'
              ? { tools: [{ name: 'picture', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
              : {
                  content: [
                    { type: 'text', text: 'A picture.' },
                    { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
                  ],
                }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }))
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No test address')
      const results: Array<NativeRequest['messages'][number]> = []
      try {
        await drive(
          provider(async (request) => {
            const picture = request.tools.find((tool) => tool.name.startsWith('mcp_'))?.name ?? ''
            const last = request.messages.at(-1)
            if (last?.role === 'tool') results.push(last)
            if (request.messages.length === 2)
              return { text: '', tools: [{ id: 'run-1', name: 'run_command', input: { command: 'printf out; exit 3' } }] }
            if (results.length === 1) return { text: '', tools: [{ id: 'picture-1', name: picture, input: {} }] }
            return { text: 'Done.', tools: [] }
          }),
          async (client, updates) => {
            const { sessionId } = await start(client, cwd, [
              { type: 'http', name: 'edges', url: `http://127.0.0.1:${address.port}`, headers: [{ name: 'x-test', value: '1' }] },
            ])
            await say(client, sessionId, words('Run it.'))
            const done = updates.filter(
              (update): update is Extract<acp.SessionUpdate, { sessionUpdate: 'tool_call_update' }> =>
                update.sessionUpdate === 'tool_call_update' && (update.status === 'failed' || update.status === 'completed'),
            )
            expect(done[0]).toMatchObject({
              toolCallId: 'run-1',
              status: 'failed',
              content: [],
              _meta: { terminal_output_delta: { data: 'out\n[Exit 3]' }, terminal_exit: { exit_code: 3, signal: null } },
            })
            expect(done[1]).toMatchObject({
              toolCallId: 'picture-1',
              status: 'completed',
              rawOutput: ['A picture.'],
              content: [
                { type: 'content', content: { type: 'text', text: 'A picture.' } },
                { type: 'content', content: { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' } },
              ],
            })
          },
        )
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      expect(results[1]?.content).toEqual([
        { type: 'text', text: 'A picture.' },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ])
    },
  )

  it.skipIf(process.platform === 'win32')('asks again rather than writing where a link moved while it waited', async () => {
    const cwd = await folder()
    await mkdir(join(cwd, 'first'))
    await mkdir(join(cwd, 'second'))
    await symlink(join(cwd, 'first'), join(cwd, 'target'))
    let result = ''
    let calls = 0
    await drive(
      provider(async (request) => {
        calls += 1
        if (calls === 1)
          return { text: '', tools: [{ id: 'write-1', name: 'write_file', input: { path: 'target/note.txt', content: 'x' } }] }
        const content = request.messages.at(-1)?.content
        result = typeof content === 'string' ? content : ''
        return { text: 'Stopped.', tools: [] }
      }),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        await say(client, sessionId, words('Write it.'))
      },
      {},
      async () => {
        await rm(join(cwd, 'target'))
        await symlink(join(cwd, 'second'), join(cwd, 'target'))
        return allow
      },
    )
    expect(result).toContain('location changed while permission was pending')
    await expect(readFile(join(cwd, 'second', 'note.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('compacts on its own when the context fills, and says when it can’t', async () => {
    const cwd = await folder()
    const small = { ...model, context: 10 }
    let summaries = 0
    let steps = 0
    const seen: NativeRequest[] = []
    await drive(
      provider(
        async (request) => {
          if (request.purpose === 'compaction') {
            summaries += 1
            return { text: summaries === 1 ? ' ' : 'Summary so far.', tools: [] }
          }
          seen.push(request)
          steps += 1
          return steps <= 2
            ? { text: '', tools: [{ id: `list-${steps}`, name: 'list_directory', input: { path: '.' } }] }
            : { text: 'Done.', tools: [] }
        },
        [small],
      ),
      async (client) => {
        const { sessionId } = await start(client, cwd)
        expect(await say(client, sessionId, words('/compact'))).toMatchObject({ stopReason: 'end_turn' })
        expect(summaries).toBe(0)
        await expect(say(client, sessionId, words('List it, twice.'))).rejects.toThrow('Context window is full')
        await expect(say(client, sessionId, words('Next.'))).rejects.toThrow('returned no summary')
        expect(await say(client, sessionId, words('Last.'))).toMatchObject({ stopReason: 'end_turn' })
      },
    )
    expect(seen.at(-1)?.messages.map((message) => message.role)).toEqual(['system', 'assistant', 'user'])
    expect(seen.at(-1)?.messages[1]?.content).toBe('Work so far (summary):\nSummary so far.')
  })
})
