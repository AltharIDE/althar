import type * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'

import { handedOf, normalizeOptions } from '../src/events'
import { classify } from '../src/failures'
import { compilerOf } from '../src/keeper'
import { codexServers } from '../src/ownTools'

/*
 * What agents and their surroundings say with less than usual: a picture's
 * address with no name in it, an option list with an entry that is neither
 * an option nor a group, a server entry that isn't a table, an error with no
 * words, a Windows with no SystemRoot set.
 */

describe('answers that say little', () => {
  it('names a picture known only by an address with no name in it by the whole address', () => {
    assert.deepStrictEqual(handedOf({ type: 'image', data: '', mimeType: '', uri: '/' }), { _tag: 'Link', uri: '/', name: '/' })
  })

  it('leaves out an entry of a choice that is neither an option nor a group of them', () => {
    const options = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'a',
        options: [{ value: 'a', name: 'A' }, { name: 'Stray' }],
      },
    ] as unknown as Array<acp.SessionConfigOption>
    assert.deepStrictEqual(
      normalizeOptions(options).map((option) => option.choices),
      [[{ value: 'a', name: 'A' }]],
    )
  })

  it('reads a Codex server entry that isn’t a table as one it can’t reach', () => {
    assert.deepStrictEqual(Object.fromEntries(codexServers('[mcp_servers]\nstray = "npx server"\n')), { stray: null })
  })

  it('says an error with no message of its own as the agent sent it', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    assert.deepStrictEqual(classify({ code: -32603, data: 'boom' }, now), {
      failure: 'unknown',
      message: '{"code":-32603,"data":"boom"}',
    })
  })

  it('looks for the .NET compiler under C:\\Windows where SystemRoot isn’t set', () => {
    const at = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    assert.strictEqual(
      compilerOf({}, (path) => path === at),
      at,
    )
    assert.isUndefined(compilerOf({}, () => false))
  })
})
