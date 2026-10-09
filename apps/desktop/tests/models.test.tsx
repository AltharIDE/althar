import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Brand } from '@althar/ui'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModels, AgentStatus } from '@althar/contracts'

import { useModels, useSetDefaultEffort } from '../src/renderer/data/models'
import {
  catalogOf,
  defaultEffortOf,
  choiceOf,
  defaultPins,
  effortId,
  effortName,
  infoOf,
  keyOf,
  makerOf,
  modelName,
  moveTo,
  togglePin,
  useModelPrefs,
} from '../src/renderer/shared/models'
import { agents, fakeClient, models } from './fixtures'
import { withServices } from './render'

const signedIn = agents.filter((agent) => agent.signIn !== 'signed_out')
const catalog = catalogOf(models, signedIn)

describe('the models every agent offers', () => {
  it('are one list, each known by its agent and its own id', () => {
    expect(catalog.models.map((info) => [info.id, info.name, info.short])).toEqual([
      ['claude-code:default', 'Claude Code default', 'Claude Code default'],
      ['claude-code:opus', 'Claude Opus', 'Claude Opus'],
      ['claude-code:sonnet', 'Claude Sonnet', 'Claude Sonnet'],
      ['codex:gpt-5.2-codex', 'gpt-5.2-codex', 'gpt-5.2-codex'],
      ['codex:gpt-5.2', 'gpt-5.2', 'gpt-5.2'],
    ])
    expect(catalog.models[2]).toMatchObject({
      mark: Brand.Anthropic,
      efforts: ['Low', 'Medium', 'High'],
      note: 'For everyday tasks',
      via: 'via Claude Code',
    })
    expect(catalog.runtimes).toEqual([
      { id: 'claude-code', name: 'Claude Code', how: 'signed in', brand: Brand.ClaudeCode },
      { id: 'codex', name: 'Codex', how: 'this Mac', brand: Brand.Codex },
    ])
    expect(choiceOf(keyOf('opencode', 'anthropic/claude-sonnet:thinking'))).toEqual({
      agentId: 'opencode',
      model: 'anthropic/claude-sonnet:thinking',
    })
    expect(choiceOf(keyOf('codex', null))).toEqual({ agentId: 'codex', model: null })
  })

  it('say whose a shared name is, keep a provider apart, put back a family a name leaves out, and carry the maker’s mark', () => {
    const opencode: AgentStatus = {
      id: 'opencode',
      name: 'OpenCode',
      signIn: 'signed_in',
      login: 'opencode auth login',
      version: null,
      ways: [],
      accounts: [],
    }
    const plain = (id: string, name: string) => ({ id, name, description: null, efforts: [], effort: null })
    const offered: AgentModels = {
      agentId: 'opencode',
      models: [
        plain('anthropic/opus', 'Opus'),
        plain('qwen/qwen3-coder', 'qwen/Qwen3 Coder'),
        { ...plain('local', 'My own'), efforts: [{ id: 'xhigh', name: 'Xhigh' }] },
        plain('opencode/big-pickle', 'OpenCode Zen/Big Pickle'),
        plain('other/big-pickle', 'Other / Big Pickle'),
        plain('acme/kimi-k3', 'Acme/Kimi K3'),
        plain('zeta/kimi-k3', 'Zeta/Kimi K3'),
        plain('openai/gpt-6-sol', 'OpenAI/6 Sol'),
        plain('gemini-3-pro', '3 Pro'),
        plain('v2', '2'),
      ],
      model: null,
      effort: null,
      defaults: [],
      blocked: [],
      probing: false,
    }
    const both = catalogOf([...models, offered], [...signedIn, opencode])
    const named = (id: string) => both.models.find((info) => info.id === id)
    // In a picker, a model its maker's agent runs is named alone; through another agent, it says which way it goes.
    expect([named('claude-code:opus')?.name, named('opencode:anthropic/opus')?.short]).toEqual(['Claude Opus', 'Opus · OpenCode'])
    expect(named('opencode:qwen/qwen3-coder')).toMatchObject({
      name: 'Qwen3 Coder · OpenCode',
      short: 'Qwen3 Coder · OpenCode',
      mark: Brand.Alibaba,
    })
    // A provider that names the agent is the way; two that would still read the same say their providers.
    expect(named('opencode:local')?.mark).toBeUndefined()
    expect([named('opencode:opencode/big-pickle')?.name, named('opencode:other/big-pickle')?.name]).toEqual([
      'Big Pickle · OpenCode Zen',
      'Big Pickle · OpenCode',
    ])
    expect([named('opencode:acme/kimi-k3')?.name, named('opencode:zeta/kimi-k3')?.name]).toEqual(['Kimi K3 · Acme', 'Kimi K3 · Zeta'])
    // Where a model is only named, not chosen, it is named alone; the hover says the way.
    const alone = catalogOf([...models, offered], [...signedIn, opencode], { apart: false })
    expect(alone.models.find((info) => info.id === 'opencode:other/big-pickle')).toMatchObject({ name: 'Big Pickle', via: 'via OpenCode' })
    expect([named('opencode:openai/gpt-6-sol'), named('opencode:gemini-3-pro')?.name, named('opencode:v2')?.name]).toEqual([
      expect.objectContaining({ name: 'GPT-6 Sol · OpenCode', mark: Brand.OpenAI }),
      'Gemini 3 Pro · OpenCode',
      '2 · OpenCode',
    ])
    expect(alone.models.find((info) => info.id === 'opencode:openai/gpt-6-sol')?.name).toBe('GPT-6 Sol')
    // Each model has effort levels of its own, and some none; levels an agent runs together are written apart.
    expect([named('opencode:local')?.efforts, named('opencode:v2')?.efforts]).toEqual([['Extra high'], []])
    expect([effortName(both, 'opencode:local', 'xhigh'), effortId(both, 'opencode:local', 'Extra high')]).toEqual(['Extra high', 'xhigh'])
    expect([effortName(both, 'opencode:v2', 'xhigh'), effortId(both, 'opencode:v2', 'Extra high')]).toEqual([null, 'Extra high'])
    expect(both.runtimes.at(-1)).toEqual({ id: 'opencode', name: 'OpenCode', how: 'signed in' })
    expect([makerOf('opencode', 'gemini-3-pro'), makerOf('opencode', 'o4-mini'), makerOf('codex', 'whatever')]).toEqual([
      Brand.Google,
      Brand.OpenAI,
      Brand.OpenAI,
    ])
  })

  it('offer nothing of an agent whose every model is switched off, not its own default', () => {
    const codex = models.find((offered) => offered.agentId === 'codex')
    if (codex === undefined) throw new Error('Codex offers models')
    const off = catalogOf([{ ...codex, blocked: codex.models.map((model) => model.id) }], signedIn)
    expect(off.models.some((info) => info.runtime === 'codex')).toBe(false)
  })

  it('stand for an agent whose models aren’t known yet by its own default', () => {
    const unknown = catalogOf([], signedIn)
    expect(unknown.models.map((info) => [info.id, info.name])).toEqual([
      ['claude-code:', 'Claude Code default'],
      ['codex:', 'Codex default'],
    ])
    expect(infoOf(unknown, { agentId: 'codex', model: null }).id).toBe('codex:')
    expect(defaultPins(unknown)).toEqual(['claude-code:', 'codex:'])
  })

  it('show a choice as its model, what its agent is on, or as it was set', () => {
    expect(infoOf(catalog, { agentId: 'claude-code', model: 'sonnet' }).name).toBe('Claude Sonnet')
    expect(infoOf(catalog, { agentId: 'codex', model: null }).id).toBe('codex:gpt-5.2-codex')
    // One the agent no longer lists, and an agent the picker doesn't offer.
    expect(infoOf(catalog, { agentId: 'codex', model: 'gpt-4.1' })).toEqual({
      id: 'codex:gpt-4.1',
      name: 'gpt-4.1',
      short: 'gpt-4.1',
      runtime: 'codex',
      efforts: [],
      via: 'via Codex',
      mark: Brand.OpenAI,
    })
    expect(infoOf(catalog, { agentId: 'opencode', model: null })).toMatchObject({ id: 'opencode:', name: 'opencode' })
    expect(defaultPins(catalog)).toEqual(['claude-code:default', 'codex:gpt-5.2-codex'])
    expect([modelName(catalog, 'claude-code', 'sonnet'), modelName(catalog, 'claude-code', 'default')]).toEqual(['Sonnet', null])
    expect([modelName(catalog, 'codex', 'gpt-4.1'), modelName(catalog, 'codex', null)]).toEqual(['gpt-4.1', null])
    const sol = catalogOf(
      [{ ...models[1]!, models: [{ id: 'gpt-6-sol', name: '6 Sol', description: null, efforts: [], effort: null }] }],
      signedIn,
    )
    expect(modelName(sol, 'codex', 'gpt-6-sol')).toBe('GPT-6 Sol')
    // An agent's own default has the efforts of the model it is on.
    expect([effortName(catalog, 'codex:', 'extra-high'), effortName(catalog, 'codex:gpt-5.2', null)]).toEqual(['Extra high', null])
    expect([effortId(catalog, 'codex:gpt-5.2', 'Extra high'), effortId(catalog, 'opencode:', 'Deep')]).toEqual(['extra-high', 'Deep'])
  })

  it('carry the person’s default effort for each model, or else the one it starts at', () => {
    const kept = catalogOf(
      models.map((offered) =>
        offered.agentId === 'codex' ? { ...offered, defaults: [{ model: 'gpt-5.2', effort: 'extra-high' }] } : offered,
      ),
      signedIn,
    )
    expect([...kept.defaults]).toEqual([['codex:gpt-5.2', 'extra-high']])
    const info = (id: string) => kept.models.find((model) => model.id === id)!
    expect([defaultEffortOf(kept, info('codex:gpt-5.2')), defaultEffortOf(kept, info('codex:gpt-5.2-codex'))]).toEqual([
      'Extra high',
      'Medium',
    ])
    // Until the one it starts at is known, what its agent is on, for the model it is on only.
    const seen = catalogOf(
      models.map((offered) =>
        offered.agentId === 'codex'
          ? { ...offered, effort: 'high', models: offered.models.map((model) => ({ ...model, effort: null })) }
          : offered,
      ),
      signedIn,
    )
    const on = (id: string) => seen.models.find((model) => model.id === id)!
    expect([defaultEffortOf(seen, on('codex:gpt-5.2-codex')), defaultEffortOf(seen, on('codex:gpt-5.2'))]).toEqual(['High', null])
  })
})

describe('moving a running thread to a choice', () => {
  it('changes only what changed, or hands it to another agent', async () => {
    const { client } = fakeClient()
    const on = { agentId: 'claude-code', model: 'opus', effort: 'high' }
    await moveTo(client, 'th1', on, { ...on, model: null })
    await moveTo(client, 'th1', on, { ...on, effort: null })
    expect([client.setModel, client.setEffort, client.switchAgent].map((call) => vi.mocked(call).mock.calls.length)).toEqual([0, 0, 0])
    await moveTo(client, 'th1', on, { ...on, model: 'sonnet', effort: 'low' })
    expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' })
    expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'th1', effort: 'low' })
    await moveTo(client, 'th1', on, { agentId: 'codex', model: null, effort: 'low' })
    expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', effort: 'low' })
  })
})

function Prefs() {
  const prefs = useModelPrefs()
  return <output>{JSON.stringify(prefs)}</output>
}

describe('the person’s pins', () => {
  it('start from the pins shown, and are kept in this window’s storage', () => {
    render(<Prefs />)
    expect(screen.getByRole('status').textContent).toBe('{"pins":null}')
    act(() => togglePin('codex:gpt-5.2', ['claude-code:default']))
    act(() => togglePin('claude-code:default', ['ignored']))
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: ['codex:gpt-5.2'] })
    expect(window.localStorage.getItem('althar.models')).toBe(screen.getByRole('status').textContent)
  })

  it('are read again from storage, and what isn’t theirs is left out', () => {
    window.localStorage.setItem('althar.models', JSON.stringify({ pins: ['a', 'b'], efforts: { 'codex:x': 'low' } }))
    const view = render(<Prefs />)
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: ['a', 'b'] })
    view.unmount()
    window.localStorage.setItem('althar.models', JSON.stringify({ pins: [1, 'a'] }))
    render(<Prefs />)
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: null })
  })

  it('are none where storage holds something else, or can’t be read or written', () => {
    window.localStorage.setItem('althar.models', '{not json')
    const view = render(<Prefs />)
    expect(screen.getByRole('status').textContent).toBe('{"pins":null}')
    view.unmount()
    window.localStorage.setItem('althar.models', '"a string"')
    render(<Prefs />)
    expect(screen.getByRole('status').textContent).toBe('{"pins":null}')
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    // Kept for this window only.
    act(() => togglePin('codex:x', []))
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: ['codex:x'] })
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

function Known() {
  const known = useModels()
  return <output>{known === null ? 'none yet' : known.map((agent) => `${agent.agentId}:${agent.models.length}`).join(' ')}</output>
}

describe('reading the models', () => {
  it('reads them once for the window, and again shortly while an agent is still being asked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const asked = models.map((agent) =>
        agent.agentId === 'opencode'
          ? { ...agent, models: [{ id: 'm', name: 'M', description: null, efforts: [], effort: null }], probing: false }
          : agent,
      )
      const getModels = vi.fn().mockResolvedValueOnce(models).mockResolvedValue(asked)
      const { client } = fakeClient({ getModels })
      withServices(
        <>
          <Known />
          <Known />
        </>,
        client,
      )
      expect(screen.getAllByRole('status')[0]?.textContent).toBe('none yet')
      await waitFor(() => expect(screen.getAllByRole('status')[1]?.textContent).toBe('claude-code:3 codex:2 opencode:0'))
      expect(getModels).toHaveBeenCalledTimes(1)
      await act(() => vi.advanceTimersByTimeAsync(2000))
      await waitFor(() => expect(screen.getAllByRole('status')[0]?.textContent).toBe('claude-code:3 codex:2 opencode:1'))
      await act(() => vi.advanceTimersByTimeAsync(4000))
      expect(getModels).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads them again once the person sets a default effort, and keeps the one there was when it isn’t set', async () => {
    let kept: ReadonlyArray<{ readonly model: string; readonly effort: string }> = []
    let first: (known: ReadonlyArray<AgentModels>) => void = () => undefined
    const now = () => models.map((offered) => (offered.agentId === 'codex' ? { ...offered, defaults: kept, probing: false } : offered))
    const getModels = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (first = resolve)))
      .mockImplementation(async () => now())
    const setDefaultEffort = vi
      .fn()
      .mockImplementationOnce(async (input: { model: string; effort: string }) => {
        kept = [{ model: input.model, effort: input.effort }]
      })
      .mockRejectedValueOnce(new Error('The port closed'))
    const { client } = fakeClient({ getModels, setDefaultEffort })
    function Defaults() {
      const known = useModels()
      const setDefault = useSetDefaultEffort()
      return (
        <>
          <output>{JSON.stringify(known?.find((offered) => offered.agentId === 'codex')?.defaults ?? null)}</output>
          <button type="button" onClick={() => void setDefault({ agentId: 'codex', model: 'gpt-5.2', effort: 'high' })}>
            Set
          </button>
        </>
      )
    }
    withServices(<Defaults />, client)
    // Set while the first read is on its way: read again once it is back.
    await userEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'high' }))
    act(() => first(now()))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('[{"model":"gpt-5.2","effort":"high"}]'))
    expect(getModels).toHaveBeenCalledTimes(2)
    // One that isn't set leaves what there was, and isn't read again for.
    await userEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => expect(setDefaultEffort).toHaveBeenCalledTimes(2))
    expect(getModels).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toBe('[{"model":"gpt-5.2","effort":"high"}]')
  })

  it('offers each agent’s own default when they can’t be read', async () => {
    const { client } = fakeClient({ getModels: vi.fn(async () => Promise.reject(new Error('The port closed'))) })
    withServices(<Known />, client)
    await waitFor(() => expect(client.getModels).toHaveBeenCalled())
    expect(screen.getByRole('status').textContent).toBe('none yet')
  })
})
