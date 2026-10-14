import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { forgetDrafts } from '../src/renderer/shared/drafts'
import { fakeClient, fakeHost, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * What the person writes in a composer stays with its thread: they go to the
 * home or another tab, come back, and it is there, its images too. Sending
 * clears it. What they dictate is written down whether or not they stay, and
 * lands in the thread they said it in.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
])

function Project() {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onTask={vi.fn()} />
}

function Task({ threadId = 'th1' }: { threadId?: string }) {
  return <TaskView model={useTask(threadId)} onBack={vi.fn()} />
}

/** Two tasks of the project, each its own thread. */
const tasks = () =>
  fakeClient({
    getThread: vi.fn(async (threadId: string) =>
      threadId === 'th2' ? snapshot({ threadId: 'th2', task: { ...snapshot().task, id: 't2', title: 'Second' } }) : snapshot(),
    ),
  })

const READY: DictationState = {
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  model: { ready: true, got: 1, size: 1, downloading: false },
}

/** A dictation host whose writing down waits until the test says what was heard, or that it failed. */
const slowDictation = () => {
  const waiting: Array<{ resolve: (text: string) => void; reject: (error: Error) => void }> = []
  const dictation: DictationHost = {
    state: vi.fn(async () => READY),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(() => new Promise<string>((resolve, reject) => void waiting.push({ resolve, reject }))),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn(() => () => {}),
  }
  const heard = async (text: string) => {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0))
    await act(async () => waiting.shift()?.resolve(text))
  }
  const fails = async () => {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0))
    await act(async () => waiting.shift()?.reject(new Error('The speech process stopped.')))
  }
  return { dictation, heard, fails }
}

// The views hear a microphone that heard two seconds of something.
vi.mock('../src/renderer/shared/dictation/recorder', () => ({
  record: vi.fn(async () => {
    const heard = () => ({ samples: new Float32Array(32_000), sampleRate: 16_000 })
    return { peek: heard, stop: heard, cancel: vi.fn(), use: vi.fn(async () => {}) }
  }),
}))

const coordinatorBox = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell the coordinator something' })
const taskBox = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: /^Tell .* something$/ })
const AWAY = 'What you said was written down while you were away.'

describe('a draft', () => {
  it('is there again, the cursor at its end, after going elsewhere and coming back', async () => {
    const { client } = fakeClient()
    const view = withServices(<Project />, client)
    await userEvent.type(await coordinatorBox(), 'Why is checkout slow')
    // To the home, and back.
    view.unmount()
    withServices(<Project />, client)
    const box = await coordinatorBox()
    expect(box.value).toBe('Why is checkout slow')
    expect(box.selectionStart).toBe(box.value.length)
  })

  it('keeps its images while the person is away', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const view = withServices(<Task />, client)
    const box = await taskBox()
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.type(box, 'Look at this')
    view.unmount()
    withServices(<Task />, client)
    expect((await taskBox()).value).toBe('Look at this')
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy()
  })

  it('is cleared once it is sent, and stays cleared', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const view = withServices(<Task />, client)
    const box = await taskBox()
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([PNG], 'shot.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeTruthy()
    await userEvent.type(box, 'Look at this{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'th1', body: 'Look at this' })))
    expect(box.value).toBe('')
    view.unmount()
    withServices(<Task />, client)
    expect((await taskBox()).value).toBe('')
    expect(screen.queryByRole('list', { name: /to send/ })).toBeNull()
    expect(window.localStorage.getItem('althar.drafts')).toBeNull()
  })

  it('outlives a restart, its words if not its images', async () => {
    const { client } = fakeClient()
    const view = withServices(<Project />, client)
    await userEvent.type(await coordinatorBox(), 'Before you go')
    view.unmount()
    // A new window: nothing held but what storage kept.
    forgetDrafts()
    withServices(<Project />, client)
    expect((await coordinatorBox()).value).toBe('Before you go')
  })

  it('is each thread’s own: the coordinator’s and each task’s never mix', async () => {
    const { client } = tasks()
    let view = withServices(<Project />, client)
    // Written all at once, as pasted: what matters here is where it is kept, not each key.
    fireEvent.change(await coordinatorBox(), { target: { value: 'For the coordinator' } })
    view.unmount()
    view = withServices(<Task />, client)
    expect((await taskBox()).value).toBe('')
    fireEvent.change(await taskBox(), { target: { value: 'For the first task' } })
    view.unmount()
    view = withServices(<Task threadId="th2" />, client)
    expect((await taskBox()).value).toBe('')
    fireEvent.change(await taskBox(), { target: { value: 'For the second' } })
    view.unmount()
    view = withServices(<Task />, client)
    expect((await taskBox()).value).toBe('For the first task')
    view.unmount()
    withServices(<Project />, client)
    expect((await coordinatorBox()).value).toBe('For the coordinator')
  })
})

describe('dictation, once the person leaves', () => {
  it('finishes writing down while they are away, in the thread it was said in, and says so when they are back', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = tasks()
    let view = withServices(<Task />, client, host)
    await userEvent.type(await taskBox(), 'Before the PR,')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    expect(await screen.findByRole('button', { name: 'Writing down what you said' })).toBeTruthy()
    // Off to another task while it is still being written down; it lands meanwhile.
    view.unmount()
    view = withServices(<Task threadId="th2" />, client, host)
    await speech.heard('check the retry path.')
    expect((await taskBox()).value).toBe('')
    expect(screen.queryByText(AWAY)).toBeNull()
    view.unmount()
    // Back: the words are in the draft, with a quiet line saying when they came.
    withServices(<Task />, client, host)
    expect((await taskBox()).value).toBe('Before the PR, check the retry path.')
    expect(screen.getByText(AWAY)).toBeTruthy()
    // Once the person carries on, the line has done its work.
    await userEvent.type(await taskBox(), ' Thanks')
    expect(screen.queryByText(AWAY)).toBeNull()
  })

  it('shows it is still writing down when they come back before it is done, then writes it there', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient()
    const view = withServices(<Project />, client, host)
    await coordinatorBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    view.unmount()
    withServices(<Project />, client, host)
    expect(await screen.findByRole('button', { name: 'Writing down what you said' })).toBeTruthy()
    expect((await coordinatorBox()).readOnly).toBe(true)
    await speech.heard('Why is checkout slow?')
    expect((await coordinatorBox()).value).toBe('Why is checkout slow?')
    // They were there as it landed: nothing to say.
    expect(screen.queryByText(AWAY)).toBeNull()
  })

  it('stops listening as they leave, and writes down what they said up to then', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    view.unmount()
    await speech.heard('Carry on with the tests.')
    withServices(<Task />, client, host)
    expect((await taskBox()).value).toBe('Carry on with the tests.')
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
  })

  it('keeps what was said when it couldn’t be written down while they were away, to try again', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    view.unmount()
    await speech.fails()
    withServices(<Task />, client, host)
    expect(await screen.findByText('Couldn’t write that down')).toBeTruthy()
    expect(screen.getByText('What you said (0:00) is kept; try again.')).toBeTruthy()
    // Escape doesn't throw it away; only Throw it away does.
    fireEvent.keyDown(screen.getByRole('group', { name: 'Dictation' }), { key: 'Escape' })
    expect(screen.getByText('Couldn’t write that down')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await speech.heard('Carry on with the tests.')
    expect((await taskBox()).value).toBe('Carry on with the tests.')
    expect(screen.queryByText('Couldn’t write that down')).toBeNull()
  })
})
