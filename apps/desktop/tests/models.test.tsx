import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Brand } from '@charrette/ui'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModels, AgentStatus } from '@charrette/contracts'

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
      ['claude-code:opus', 'Opus', 'Opus'],
      ['claude-code:sonnet', 'Sonnet', 'Sonnet'],
      ['codex:gpt-5.2-codex', 'gpt-5.2-codex', 'gpt-5.2-codex'],
      ['codex:gpt-5.2', 'gpt-5.2', 'gpt-5.2'],
    ])
    expect(catalog.models[2]).toMatchObject({ mark: Brand.Anthropic, efforts: ['Low', 'Medium', 'High'], note: 'For everyday tasks' })
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
    const opencode: AgentStatus = { id: 'opencode', name: 'OpenCode', signIn: 'signed_in', login: 'opencode auth login', accounts: [] }
    const offered: AgentModels = {
      agentId: 'opencode',
      models: [
        { id: 'anthropic/opus', name: 'Opus', description: null },
        { id: 'qwen/qwen3-coder', name: 'qwen/Qwen3 Coder', description: null },
        { id: 'local', name: 'My own', description: null },
        { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', description: null },
        { id: 'other/big-pickle', name: 'Other / Big Pickle', description: null },
        { id: 'openai/gpt-6-sol', name: 'OpenAI/6 Sol', description: null },
        { id: 'gemini-3-pro', name: '3 Pro', description: null },
        { id: 'v2', name: '2', description: null },
      ],
      efforts: [{ id: 'xhigh', name: 'Xhigh' }],
      model: null,
      effort: null,
      defaults: [],
      probing: false,
    }
    const both = catalogOf([...models, offered], [...signedIn, opencode])
    const named = (id: string) => both.models.find((info) => info.id === id)
    expect([named('claude-code:opus')?.name, named('opencode:anthropic/opus')?.short]).toEqual(['Opus · Claude Code', 'Opus · OpenCode'])
    expect(named('opencode:qwen/qwen3-coder')).toMatchObject({ name: 'Qwen3 Coder', short: 'Qwen3 Coder', mark: Brand.Alibaba })
    expect(named('opencode:local')?.mark).toBeUndefined()
    expect([named('opencode:opencode/big-pickle')?.name, named('opencode:other/big-pickle')?.name]).toEqual([
      'Big Pickle · OpenCode Zen',
      'Big Pickle · Other',
    ])
    expect([named('opencode:openai/gpt-6-sol'), named('opencode:gemini-3-pro')?.name, named('opencode:v2')?.name]).toEqual([
      expect.objectContaining({ name: 'GPT-6 Sol', mark: Brand.OpenAI }),
      'Gemini 3 Pro',
      '2',
    ])
    // Effort levels an agent runs together are written apart.
    expect([named('opencode:local')?.efforts, effortName(both, 'opencode', 'xhigh'), effortId(both, 'opencode', 'Extra high')]).toEqual([
      ['Extra high'],
      'Extra high',
      'xhigh',
    ])
    expect(both.runtimes.at(-1)).toEqual({ id: 'opencode', name: 'OpenCode', how: 'signed in' })
    expect([makerOf('opencode', 'gemini-3-pro'), makerOf('opencode', 'o4-mini'), makerOf('codex', 'whatever')]).toEqual([
      Brand.Google,
      Brand.OpenAI,
      Brand.OpenAI,
    ])
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
    expect(infoOf(catalog, { agentId: 'claude-code', model: 'sonnet' }).name).toBe('Sonnet')
    expect(infoOf(catalog, { agentId: 'codex', model: null }).id).toBe('codex:gpt-5.2-codex')
    // One the agent no longer lists, and an agent the picker doesn't offer.
    expect(infoOf(catalog, { agentId: 'codex', model: 'gpt-4.1' })).toEqual({
      id: 'codex:gpt-4.1',
      name: 'gpt-4.1',
      short: 'gpt-4.1',
      runtime: 'codex',
      efforts: [],
      mark: Brand.OpenAI,
    })
    expect(infoOf(catalog, { agentId: 'opencode', model: null })).toMatchObject({ id: 'opencode:', name: 'opencode' })
    expect(defaultPins(catalog)).toEqual(['claude-code:default', 'codex:gpt-5.2-codex'])
    expect([modelName(catalog, 'claude-code', 'sonnet'), modelName(catalog, 'claude-code', 'default')]).toEqual(['Sonnet', null])
    expect([modelName(catalog, 'codex', 'gpt-4.1'), modelName(catalog, 'codex', null)]).toEqual(['gpt-4.1', null])
    const sol = catalogOf([{ ...models[1]!, models: [{ id: 'gpt-6-sol', name: '6 Sol', description: null }] }], signedIn)
    expect(modelName(sol, 'codex', 'gpt-6-sol')).toBe('GPT-6 Sol')
    expect([effortName(catalog, 'codex', 'extra-high'), effortName(catalog, 'codex', null)]).toEqual(['Extra high', null])
    expect([effortId(catalog, 'codex', 'Extra high'), effortId(catalog, 'opencode', 'Deep')]).toEqual(['extra-high', 'Deep'])
  })

  it('carry the person’s default effort for each model, or else what its agent is on', () => {
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
    expect(window.localStorage.getItem('charrette.models')).toBe(screen.getByRole('status').textContent)
  })

  it('are read again from storage, and what isn’t theirs is left out', () => {
    window.localStorage.setItem('charrette.models', JSON.stringify({ pins: ['a', 'b'], efforts: { 'codex:x': 'low' } }))
    const view = render(<Prefs />)
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: ['a', 'b'] })
    view.unmount()
    window.localStorage.setItem('charrette.models', JSON.stringify({ pins: [1, 'a'] }))
    render(<Prefs />)
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toEqual({ pins: null })
  })

  it('are none where storage holds something else, or can’t be read or written', () => {
    window.localStorage.setItem('charrette.models', '{not json')
    const view = render(<Prefs />)
    expect(screen.getByRole('status').textContent).toBe('{"pins":null}')
    view.unmount()
    window.localStorage.setItem('charrette.models', '"a string"')
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
        agent.agentId === 'opencode' ? { ...agent, models: [{ id: 'm', name: 'M', description: null }], probing: false } : agent,
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
