import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import * as acp from '@agentclientprotocol/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** A protocol peer that really calls the supplied MCP server and attempts the refused writes. */
export const compatibilityPeer = (
  bad: 'command' | 'reader' | 'reader-shell' | 'no-request' | 'no-mcp' | 'no-cancel' | 'no-version' | null,
) => {
  const sessions = new Map<string, { cwd: string; url: string; cancel: (() => void) | null; cancelled: boolean }>()
  const app = acp
    .agent({ name: 'contract-peer' })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      ...(bad === 'no-version' ? {} : { agentInfo: { name: 'peer', version: '1.2.3' } }),
      agentCapabilities: { mcpCapabilities: { http: true } },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      const id = String(sessions.size + 1)
      const server = params.mcpServers.find((one) => 'url' in one)
      sessions.set(id, { cwd: params.cwd, url: server !== undefined && 'url' in server ? server.url : '', cancel: null, cancelled: false })
      return {
        sessionId: id,
        modes: {
          currentModeId: 'bypass',
          availableModes: [
            { id: 'ask', name: 'Ask' },
            { id: 'read', name: 'Read' },
            { id: 'bypass', name: 'Bypass' },
          ],
        },
      }
    })
    .onRequest(acp.methods.agent.session.setMode, () => ({}))
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      const session = sessions.get(params.sessionId)!
      session.cancelled = true
      session.cancel?.()
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      const session = sessions.get(params.sessionId)!
      const text = params.prompt.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
      if (text.includes('compatibility_ping') && bad !== 'no-mcp') {
        const mcp = new Client({ name: 'peer', version: '1' })
        try {
          await mcp.connect(new StreamableHTTPClientTransport(new URL(session.url)))
          await mcp.callTool({ name: 'compatibility_ping' })
        } finally {
          await mcp.close()
        }
      }
      const ask = (name: string, kind: 'execute' | 'edit') =>
        client.request(acp.methods.client.session.requestPermission, {
          sessionId: params.sessionId,
          toolCall: { toolCallId: name, title: name, kind, rawInput: { command: name } },
          options: [
            { optionId: 'once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        })
      if (text.includes('althar-command-check')) {
        if (bad !== 'no-request') {
          await ask('althar-command-check', 'execute')
          await ask('althar-read-command-check', 'execute')
        }
        if (bad === 'command') await writeFile(join(session.cwd, 'althar-command-check'), 'ran')
      } else if (text.includes('althar-reader-check')) {
        const nonce = await readFile(join(session.cwd, 'read-check.txt'), 'utf8')
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: nonce } },
        })
        await ask('althar-reader-check', 'edit')
        await ask('althar-reader-shell-check', 'execute')
        if (bad === 'reader') await writeFile(join(session.cwd, 'althar-reader-check'), 'ran')
        if (bad === 'reader-shell') await writeFile(join(session.cwd, 'althar-reader-shell-check'), 'ran')
      } else if (text.includes('compiler')) {
        if (bad === 'no-cancel') return { stopReason: 'end_turn' }
        if (!session.cancelled)
          await new Promise<void>((resolve) => {
            session.cancel = resolve
          })
        return { stopReason: 'cancelled' }
      }
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The refused action did not run.' } },
      })
      return { stopReason: 'end_turn' }
    })
  return { _tag: 'InProcess' as const, agent: { _tag: 'InProcessAgent' as const, app } }
}
