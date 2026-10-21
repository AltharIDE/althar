import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { CarriedAtFoot } from '../src/renderer/shared/dictation/Carried'
import { fakeClient, fakeHost, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * Dictation carried with the person from one task to another, or to where
 * no composer shows: moved into the composer on screen, stopped with the
 * shortcut as any system writes it, and sent only where a lead is on the
 * task it was said to.
 */

function Task({ threadId = 'th1' }: { threadId?: string }) {
  return <TaskView model={useTask(threadId)} onBack={vi.fn()} />
}

const READY: DictationState = {
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  model: { ready: true, got: 1, size: 1, downloading: false },
}

/** A dictation host whose writing down waits until the test says what was heard. */
const slowDictation = () => {
  const waiting: Array<(text: string) => void> = []
  const dictation: DictationHost = {
    state: vi.fn(async () => READY),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(() => new Promise<string>((resolve) => void waiting.push(resolve))),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn(() => () => {}),
  }
  const heard = async (text: string) => {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0))
    await act(async () => waiting.shift()?.(text))
  }
  return { dictation, heard }
}

// The views hear a microphone that heard two seconds of something.
vi.mock('../src/renderer/shared/dictation/recorder', () => ({
  record: vi.fn(async () => {
    const heard = () => ({ samples: new Float32Array(32_000), sampleRate: 16_000 })
    return { peek: heard, stop: heard, cancel: vi.fn(), use: vi.fn(async () => {}) }
  }),
}))

const taskBox = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: /^Tell .* something$/ })

/** Two tasks of the project, each its own thread; the first with its lead on it unless told otherwise. */
const tasks = (first = snapshot()) =>
  fakeClient({
    getThread: vi.fn(async (threadId: string) =>
      threadId === 'th2' ? snapshot({ threadId: 'th2', task: { ...snapshot().task, id: 't2', title: 'Second' } }) : first,
    ),
  })

/** Dictating to the first task, then gone from it while it listens. */
const leaving = async (first = snapshot()) => {
  const speech = slowDictation()
  const host = fakeHost({ dictation: speech.dictation })
  const { client } = tasks(first)
  const view = withServices(<Task />, client, host)
  await taskBox()
  await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
  await screen.findByRole('button', { name: /^Stop dictating/ })
  view.unmount()
  return { speech, host, client }
}

describe('dictation carried from a task', () => {
  it('moves into another task’s empty composer as it was said', async () => {
    const { speech, host, client } = await leaving()
    withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    const pill = await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Check the retry path.')
    const card = await screen.findByRole('region', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(card).getByRole('button', { name: 'Move it to this task' }))
    expect((await taskBox()).value).toBe('Check the retry path.')
    expect(client.send).not.toHaveBeenCalled()
  })

  it('stops with the shortcut as a PC writes it, with Ctrl', async () => {
    const { speech, host, client } = await leaving()
    withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(speech.dictation.transcribe).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /^Stop dictating/ })).toBeNull()
  })

  it('shows at the window’s foot where no composer shows, to send, with nothing to move it into', async () => {
    const { speech, host, client } = await leaving()
    withServices(<CarriedAtFoot />, client, host)
    const pill = await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Check the retry path.')
    const card = await screen.findByRole('region', { name: 'To the lead · Add a retry' })
    expect(within(card).queryByRole('button', { name: /^Move it/ })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({
        threadId: 'th1',
        body: 'Check the retry path.',
        disposition: 'after_current',
        dictated: true,
      }),
    )
  })

  it('isn’t sent from elsewhere to a task with no lead on it: its own composer starts one', async () => {
    const { speech, host, client } = await leaving(snapshot({ session: null }))
    withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    const pill = await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Check the retry path.')
    const card = await screen.findByRole('region', { name: 'To the lead · Add a retry' })
    expect(within(card).queryByRole('button', { name: 'Send to the lead' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Move it to this task' })).toBeTruthy()
  })
})
