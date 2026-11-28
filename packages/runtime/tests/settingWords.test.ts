import { describe, expect, it } from 'vitest'

import { changesOf, defaultEfforts, inWords, modelsTurnedOff, said, type Names } from '../src/settingWords'

/*
 * A change to a setting is said by what moved, in plain words and real names:
 * a list or an object is diffed, and never printed whole.
 */

const names: Names = {
  agent: (id) => ({ codex: 'Codex', opencode: 'OpenCode' })[id as 'codex'] ?? id,
  model: (_agent, model) =>
    ({ 'gpt-6-luna': 'GPT-6 Luna', 'opencode-go/kimi-k3.1-pro': 'Kimi K3.1 Pro', 'claude-opus-5-5': 'Claude Opus 5.5' })[model] ?? model,
}

const ids = Array.from({ length: 200 }, (_, at) => `anthropic/model-${at}`)

describe('a list', () => {
  it('says the model turned on, by name and agent, among hundreds', () => {
    expect(
      modelsTurnedOff(
        { opencode: ids, codex: [] },
        { opencode: ids.concat('opencode-go/kimi-k3.1-pro').filter((id) => id !== ids[3]), codex: [] },
        names,
      ),
    ).toEqual(['Turned off Kimi K3.1 Pro in OpenCode', 'Turned on anthropic/model-3 in OpenCode'])
    expect(modelsTurnedOff({ opencode: [...ids, 'opencode-go/kimi-k3.1-pro'] }, { opencode: ids }, names)).toEqual([
      'Turned on Kimi K3.1 Pro in OpenCode',
    ])
  })

  it('says nothing for an agent it did not change', () => {
    expect(modelsTurnedOff({ codex: ['gpt-6-luna'], opencode: ids }, { codex: ['gpt-6-luna'] }, names)).toEqual([])
    expect(modelsTurnedOff({}, { codex: ['gpt-6-luna'] }, names)).toEqual(['Turned off GPT-6 Luna in Codex'])
  })

  it('is added to and removed from, for any other list', () => {
    expect(changesOf('Never', ['force-push'], ['force-push', 'delete-branch'])).toEqual(['Added delete-branch to Never'])
    expect(changesOf('Never', ['force-push', 'merge'], ['merge'])).toEqual(['Removed force-push from Never'])
    expect(changesOf('Hosts the sandbox reaches', null, ['a.dev'])).toEqual(['Added a.dev to Hosts the sandbox reaches'])
  })

  it('names a command rule by its pattern and what it decides', () => {
    expect(
      changesOf(
        'Commands',
        [{ pattern: 'npm publish', decision: 'ask' }],
        [
          { pattern: 'npm publish', decision: 'ask' },
          { pattern: 'git push', decision: 'allow', match: 'exact' },
        ],
      ),
    ).toEqual(['Added the command git push, exactly (allow) to Commands'])
  })

  it('cuts a long pattern short alone, never its scope or decision', () => {
    const long = 'y'.repeat(120)
    const lines = changesOf(
      'Commands',
      [{ pattern: long, decision: 'allow', match: 'exact' }],
      [{ pattern: long, decision: 'never', match: 'exact' }],
    )
    expect(lines).toEqual([
      `Added the command ${'y'.repeat(59)}…, exactly (never) to Commands`,
      `Removed the command ${'y'.repeat(59)}…, exactly (allow) from Commands`,
    ])
  })

  it('says a rule’s scope, and a change of scope alone', () => {
    const exact = [{ pattern: 'npm publish', decision: 'never', match: 'exact' }]
    const prefix = [{ pattern: 'npm publish', decision: 'never' }]
    expect(changesOf('Commands', exact, prefix)).toEqual([
      'Added commands starting with npm publish (never) to Commands',
      'Removed the command npm publish, exactly (never) from Commands',
    ])
    // With another rule changing beside it, the scope still shows.
    expect(changesOf('Commands', [...exact, { pattern: 'ls', decision: 'allow' }], [...prefix])).toEqual([
      'Added commands starting with npm publish (never) to Commands',
      'Removed the command npm publish, exactly (never) from Commands',
      'Removed commands starting with ls (allow) from Commands',
    ])
  })
})

describe('a map', () => {
  it('says the effort of one model, by its name', () => {
    expect(
      defaultEfforts(
        { 'codex/claude-opus-5-5': 'high', 'codex/gpt-6-luna': 'low' },
        { 'codex/claude-opus-5-5': 'xhigh', 'codex/gpt-6-luna': 'low' },
        names,
      ),
    ).toEqual(['Default effort for Claude Opus 5.5: high → xhigh'])
    expect(defaultEfforts({}, { 'codex/gpt-6-luna': 'low' }, names)).toEqual(['Default effort for GPT-6 Luna: none → low'])
  })

  it('goes down to the key that moved, for any other', () => {
    expect(changesOf('Skills on', { a: true, b: true }, { a: true, b: false })).toEqual(['Skills on › b: on → off'])
    expect(changesOf('Setup', { app: { copy: ['.env'], commands: [] } }, { app: { copy: ['.env', 'x'], commands: ['make'] } })).toEqual([
      'Added x to Setup › app › copy',
      'Added make to Setup › app › commands',
    ])
  })

  it('names what a map given whole takes out, with what it puts in', () => {
    const before = { codex: ['a', 'b'], claude: ['c'], grok: ['d'] }
    expect(changesOf('Accounts', before, { codex: ['a'], grok: ['d', 'e'] }, true)).toEqual([
      'Removed b from Accounts › codex',
      'Added e to Accounts › grok',
      'Removed c from Accounts › claude',
    ])
    // Named in part, the keys it leaves out stay.
    expect(changesOf('Work toward', before, { codex: ['a'] })).toEqual(['Removed b from Work toward › codex'])
  })

  it('goes key by key from none to a map and back, and never prints the map', () => {
    expect(changesOf('Ship’s default route', null, { review: true, far: 'merge' })).toEqual([
      'Ship’s default route › review: none → on',
      'Ship’s default route › far: none → merge',
    ])
    expect(changesOf('Accounts', { codex: ['a', 'b'], claude: ['c'] }, null, true)).toEqual([
      'Removed a from Accounts › codex',
      'Removed b from Accounts › codex',
      'Removed c from Accounts › claude',
    ])
    expect(changesOf('Accounts', null, { codex: ['a'] }, true)).toEqual(['Added a to Accounts › codex'])
  })
})

describe('a plain value', () => {
  it('is before and after, in words', () => {
    expect(changesOf('Review rounds', 3, 5)).toEqual(['Review rounds: 3 → 5'])
    expect(changesOf('Allow everything', false, true)).toEqual(['Allow everything: off → on'])
    expect(changesOf('Agents at once', null, 4)).toEqual(['Agents at once: none → 4'])
    expect(changesOf('Review rounds', 3, 3)).toEqual([])
  })

  it('is cut short where it runs long, and a list is its items', () => {
    expect(inWords('x'.repeat(200))).toHaveLength(60)
    expect(inWords(['a', 'b'])).toBe('a, b')
    expect(inWords([])).toBe('none')
    expect(inWords({ a: [1, 2] })).not.toContain('{')
  })
})

describe('to the agent that made it', () => {
  it('is every line while few, and a count of the rest once many', () => {
    expect(said(['one', 'two'])).toBe('one; two')
    const many = Array.from({ length: 30 }, (_, at) => `line ${at}`)
    expect(said(many)).toBe(`${many.slice(0, 8).join('; ')}; and 22 more`)
  })
})

describe('a value of no list or map', () => {
  it('is said as it is, a map by its pairs and an object in a list by its values', () => {
    expect(inWords({})).toBe('none')
    expect(inWords({ rounds: 3, on: true })).toBe('rounds: 3, on: on')
    expect(inWords(BigInt(7))).toBe('7')
    expect(inWords(() => 1)).toBe('')
    expect(changesOf('Accounts', ['a'], [{ name: 'codex', note: 'b' }])).toEqual(['Added codex b to Accounts', 'Removed a from Accounts'])
  })

  it('between a list and a plain value is the value’s before and after', () => {
    expect(changesOf('Never', ['force-push'], 'force-push')).toEqual(['Never: force-push → force-push'])
    expect(changesOf('Agents', { codex: 1 }, 4)).toEqual(['Agents: codex: 1 → 4'])
  })

  it('in an agent’s models or efforts, where it isn’t a map, is none of them', () => {
    expect(modelsTurnedOff('codex', { codex: ['luna'] }, names)).toEqual([`Turned off ${names.model('codex', 'luna')} in Codex`])
    expect(modelsTurnedOff({ codex: ['luna'] }, null, names)).toEqual([])
    expect(defaultEfforts(null, { 'codex/luna': 'high', plain: 'low' }, names)).toEqual([
      `Default effort for ${names.model('codex', 'luna')}: none → high`,
      'Default effort for plain: none → low',
    ])
    expect(defaultEfforts({ 'codex/luna': null }, { 'codex/luna': undefined }, names)).toEqual([])
    expect(defaultEfforts({ 'codex/luna': 'high' }, 'none', names)).toEqual([])
  })
})
