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
    ).toEqual(['Added git push (allow) to Commands'])
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

  it('never prints an object where one side has none', () => {
    const line = changesOf('Ship’s default route', null, { review: true, far: 'merge' })
    expect(line).toEqual(['Ship’s default route: none → review: on, far: merge'])
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
