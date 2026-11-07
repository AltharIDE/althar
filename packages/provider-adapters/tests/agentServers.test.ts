import { describe, expect, it } from 'vitest'

import { mcpCallOf } from '../src/mcpCalls'
import { parseJsonc, sameServer } from '../src/agentServers'

describe('the person’s agents’ settings, read', () => {
  it('reads JSON with comments and trailing commas, keeping what looks like a comment inside a string', () => {
    expect(
      parseJsonc('{\n  // a note\n  "url": "https://example.com/mcp", /* another */\n  "quote": "a \\"//\\" b",\n  "list": [1, 2,],\n}'),
    ).toEqual({ url: 'https://example.com/mcp', quote: 'a "//" b', list: [1, 2] })
    expect(parseJsonc('{ "mcp": { oops')).toBeUndefined()
  })

  it('reads a tool’s name in each agent’s form, and quickly however long a name it is given', () => {
    expect(mcpCallOf('mcp__my_server__merge_pull_request')).toEqual({ server: 'my_server', tool: 'merge_pull_request' })
    expect(mcpCallOf('mcp.linear.update_issue')).toEqual({ server: 'linear', tool: 'update_issue' })
    expect(mcpCallOf(`mcp__-__${'-__-'.repeat(20_000)}`)).toEqual({ server: '-', tool: '-__-'.repeat(20_000) })
    expect(mcpCallOf('mcp__a b__c')).toBeUndefined()
  })

  it('takes a token named each agent’s way as the same set-up', () => {
    expect(
      sameServer(
        { name: 'api', transport: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${ONE}' } },
        { name: 'api', transport: 'http', url: 'https://api.example/mcp', tokenVariable: 'ONE' },
      ),
    ).toBe(true)
    expect(
      sameServer(
        { name: 'a', transport: 'stdio', command: 'a', env: { MODE: 'one' } },
        { name: 'a', transport: 'stdio', command: 'a', env: { MODE: 'two' } },
      ),
    ).toBe(false)
  })
})
