import { describe, expect, it } from 'vitest'

import { normalize } from '../src/events'
import { serverOfCall, serverStatusOf } from '../src/serverStatus'

describe('an MCP server’s status, as claude-agent-acp reports it', () => {
  it('reads a server that failed or needs signing in from a notice’s _meta', () => {
    const meta = { claudeCode: { kind: 'mcpServerStatus', server: 'linear', status: 'needs-auth' } }
    expect(serverStatusOf(meta)).toEqual({ server: 'linear', status: 'needs-auth' })
    expect(serverStatusOf({ claudeCode: { kind: 'mcpServerStatus', server: 'linear', status: 'on fire' } })).toBeUndefined()
    expect(serverStatusOf({ claudeCode: { kind: 'other' } })).toBeUndefined()
    expect(serverStatusOf(undefined)).toBeUndefined()
  })

  it('carries it on the notice event', () => {
    const event = normalize({
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'MCP server "linear" needs authentication',
      description: 'Its tools are unavailable until the server is authenticated.',
      _meta: { claudeCode: { kind: 'mcpServerStatus', server: 'linear', status: 'needs-auth' } },
    } as never)
    expect(event).toMatchObject({ _tag: 'Notice', server: { name: 'linear', status: 'needs-auth' } })
  })

  it('names the server a tool call goes to, by its title or its _meta, and never Althar’s own', () => {
    expect(serverOfCall('mcp__linear__save_issue')).toBe('linear')
    expect(serverOfCall('Move DEV-188', { claudeCode: { toolName: 'mcp__linear-server__save_issue' } })).toBe('linear-server')
    expect(serverOfCall('Move DEV-188', { claudeCode: { mcpServer: { name: 'linear' } } })).toBe('linear')
    expect(serverOfCall('mcp__althar__finish_step')).toBeUndefined()
    expect(serverOfCall('Run ls')).toBeUndefined()
  })

  it('reads a long odd tool name at once, and only one that fits the shape', () => {
    expect(serverOfCall('mcp__a__b__c')).toBe('a')
    expect(serverOfCall('mcp__my_server__list.items')).toBe('my_server')
    expect(serverOfCall('mcp__linear')).toBeUndefined()
    expect(serverOfCall('mcp__linear__')).toBeUndefined()
    expect(serverOfCall('mcp__li near__x')).toBeUndefined()
    const started = Date.now()
    expect(serverOfCall(`mcp__${'-__'.repeat(50_000)}!`)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('puts the server on the tool call events', () => {
    const call = normalize({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'mcp__linear__save_issue', kind: 'other' } as never)
    expect(call).toMatchObject({ _tag: 'ToolCall', server: 'linear' })
  })
})
