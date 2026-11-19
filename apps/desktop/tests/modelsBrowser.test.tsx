import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModels } from '@althar/contracts'

import { readModelsAgain } from '../src/renderer/data/models'
import { canPick } from '../src/renderer/shared/agents'
import { ModelsBrowser } from '../src/renderer/shared/ModelChoice'
import { agents, fakeClient, models } from './fixtures'
import { withServices } from './render'

/*
 * The full model picker: a model's default effort, and a model switched off
 * or on again, show in the frame they are pressed, however long the runtime
 * takes, and only a change that doesn't go through is taken back, with a
 * line (docs/decisions/foundations.md, "The UI is instant").
 */

const signedIn = agents.filter(canPick)
const settled = models.map((agent) => ({ ...agent, probing: false }))

/** The models as the runtime has Codex's: the person's defaults, and the models they switched off. */
const codexWith = (defaults: AgentModels['defaults'], blocked: AgentModels['blocked'] = []): ReadonlyArray<AgentModels> =>
  settled.map((agent) => (agent.agentId === 'codex' ? { ...agent, defaults, blocked } : agent))

const later = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** A runtime whose every read and write after the first read answers only when the test says. */
const slowRuntime = () => {
  const reads: Array<ReturnType<typeof later<ReadonlyArray<AgentModels>>>> = []
  const writes: Array<{ input: unknown; answer: ReturnType<typeof later<void>> }> = []
  const getModels = vi
    .fn()
    .mockResolvedValueOnce(codexWith([]))
    .mockImplementation(() => {
      const read = later<ReadonlyArray<AgentModels>>()
      reads.push(read)
      return read.promise
    })
  const written = (input: unknown) => {
    const answer = later<void>()
    writes.push({ input, answer })
    return answer.promise
  }
  const setDefaultEffort = vi.fn(written)
  const setModelBlocked = vi.fn(written)
  const { client } = fakeClient({ getModels, setDefaultEffort, setModelBlocked })
  return { client, reads, writes, getModels, setDefaultEffort, setModelBlocked }
}

const open = async (client: ReturnType<typeof fakeClient>['client']) => {
  withServices(<ModelsBrowser agents={signedIn} value="codex:gpt-5.2-codex" onPick={() => undefined} onClose={() => undefined} />, client)
  return screen.findByRole('combobox', { name: 'Default effort for gpt-5.2' })
}

const chooseEffort = async (name: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: 'Default effort for gpt-5.2' }))
  await userEvent.click(await screen.findByRole('option', { name }))
}

// Hidden from roles while its list is open, it still shows what it's on.
const effortShown = () => screen.getByRole('combobox', { name: 'Default effort for gpt-5.2', hidden: true }).textContent
const switchedOff = () => screen.getByRole('button', { name: 'Don’t use gpt-5.2' }).getAttribute('aria-pressed')

describe('the full model picker', () => {
  it('shows a default effort and a model switched off as they are pressed, while the runtime hasn’t answered', async () => {
    const runtime = slowRuntime()
    await open(runtime.client)
    expect(effortShown()).toBe('Medium')

    await chooseEffort('High')
    // In the same frame: nothing has answered, and no read has landed.
    expect(effortShown()).toBe('High')
    expect(runtime.setDefaultEffort).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'high' })

    await userEvent.click(screen.getByRole('button', { name: 'Don’t use gpt-5.2' }))
    expect(switchedOff()).toBe('true')
    expect((screen.getByRole('button', { name: 'Use gpt-5.2' }) as HTMLButtonElement).disabled).toBe(true)
    expect(runtime.setModelBlocked).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', blocked: true })

    // Taken, then confirmed by a read that began after: the read says from there, and says the same.
    act(() => runtime.writes.forEach((write) => write.answer.resolve()))
    await waitFor(() => expect(runtime.reads).toHaveLength(1))
    act(() => runtime.reads[0]?.resolve(codexWith([{ model: 'gpt-5.2', effort: 'high' }], ['gpt-5.2'])))
    await waitFor(() => expect(runtime.getModels).toHaveBeenCalledTimes(2))
    expect(effortShown()).toBe('High')
    expect(switchedOff()).toBe('true')
    expect(screen.getByRole('status').textContent).not.toMatch(/Couldn’t/)
  })

  it('takes back a change the runtime doesn’t take, with a line, and makes it again on Try again', async () => {
    const runtime = slowRuntime()
    await open(runtime.client)

    await userEvent.click(screen.getByRole('button', { name: 'Don’t use gpt-5.2' }))
    expect(switchedOff()).toBe('true')
    act(() => runtime.writes[0]?.answer.reject(new Error('The store is busy')))
    await waitFor(() => expect(switchedOff()).toBe('false'))
    expect(screen.getByRole('status').textContent).toBe('Couldn’t switch gpt-5.2 off.Try again')
    expect((screen.getByRole('button', { name: 'Use gpt-5.2' }) as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(switchedOff()).toBe('true')
    expect(screen.getByRole('status').textContent).not.toMatch(/Couldn’t/)
    expect(runtime.setModelBlocked).toHaveBeenCalledTimes(2)

    await chooseEffort('Extra high')
    expect(effortShown()).toBe('Extra high')
    act(() => runtime.writes[2]?.answer.reject(new Error('The store is busy')))
    await waitFor(() => expect(effortShown()).toBe('Medium'))
    expect(screen.getByRole('status').textContent).toBe('Couldn’t set gpt-5.2’s default effort to Extra high.Try again')
    // The switch made again is still shown: its write hasn't answered.
    expect(switchedOff()).toBe('true')
  })

  it('settles on the last of changes made one after another, with no older value shown on the way', async () => {
    const runtime = slowRuntime()
    await open(runtime.client)
    const shown: Array<string | null> = []
    const watch = new MutationObserver(() => shown.push(effortShown()))
    watch.observe(document.body, { subtree: true, childList: true, characterData: true })

    await chooseEffort('High')
    await chooseEffort('Low')
    expect(effortShown()).toBe('Low')
    // One write at a time for a model: the first is on its way, the rest wait for it.
    expect(runtime.setDefaultEffort).toHaveBeenCalledTimes(1)

    // The first isn't taken: no line, nor anything taken back, as a later change speaks for the model now, and is written next.
    act(() => runtime.writes[0]?.answer.reject(new Error('The store is busy')))
    await waitFor(() => expect(runtime.setDefaultEffort).toHaveBeenCalledTimes(2))
    expect(runtime.setDefaultEffort).toHaveBeenLastCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'low' })
    expect(effortShown()).toBe('Low')

    await chooseEffort('Extra high')
    // A read begun before the runtime takes the last, which lands after it with an older value.
    act(() => readModelsAgain(runtime.client))
    act(() => runtime.writes[1]?.answer.resolve())
    await waitFor(() => expect(runtime.setDefaultEffort).toHaveBeenCalledTimes(3))
    expect(runtime.setDefaultEffort).toHaveBeenLastCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'extra-high' })
    act(() => runtime.writes[2]?.answer.resolve())
    act(() => runtime.reads[0]?.resolve(codexWith([{ model: 'gpt-5.2', effort: 'low' }])))
    await waitFor(() => expect(runtime.reads).toHaveLength(2))
    expect(effortShown()).toBe('Extra high')
    // The read begun after it confirms it, and from there the reads say.
    act(() => runtime.reads[1]?.resolve(codexWith([{ model: 'gpt-5.2', effort: 'extra-high' }])))
    await waitFor(() => expect(runtime.getModels).toHaveBeenCalledTimes(3))
    expect(effortShown()).toBe('Extra high')
    act(() => readModelsAgain(runtime.client))
    await waitFor(() => expect(runtime.reads).toHaveLength(3))
    act(() => runtime.reads[2]?.resolve(codexWith([{ model: 'gpt-5.2', effort: 'high' }])))
    await waitFor(() => expect(effortShown()).toBe('High'))
    watch.disconnect()

    // Until then, from the one there was, it showed each of the person's choices in turn, and never went back to an older one.
    const efforts = shown.filter((effort, at) => effort !== shown[at - 1])
    expect(efforts).toEqual(['Medium', 'High', 'Low', 'Extra high', 'High'])
    expect(screen.getByRole('status').textContent).not.toMatch(/Couldn’t/)
  })
})
