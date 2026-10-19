import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Room } from '@althar/ui'

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { record } from '../src/renderer/shared/dictation/recorder'
import { changeSession, listeningIn } from '../src/renderer/shared/dictation/sessions'
import { forgetDrafts } from '../src/renderer/shared/drafts'
import { fakeClient, fakeHost, items, snapshot } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * What the person writes in a composer stays with its thread: they go to the
 * home or another tab, come back, and it is there, its images too. Sending
 * clears it. What they dictate is written down whether or not they stay, and
 * lands in the thread they said it in.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
])

function Project({ room }: { room?: Room }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      {...(room === undefined ? {} : { room })}
    />
  )
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

  it('keeps a queued message taken back to change, through going elsewhere and back', async () => {
    const queued = items.you('Use the helper', { state: 'queued', interrupting: false })
    const busy = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...busy,
        session: busy.session && { ...busy.session, turnRunning: true },
        items: [items.you('Add a retry'), queued],
      })),
    })
    const view = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(client.takeBack).toHaveBeenCalledWith(queued.id)
    // Behind a running turn, the field adds to the queue.
    const queueBox = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Add to the queue, or interrupt the lead' })
    await waitFor(async () => expect((await queueBox()).value).toBe('Use the helper'))
    view.unmount()
    withServices(<Task />, client)
    expect((await queueBox()).value).toBe('Use the helper')
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

  it('goes on listening as they leave, carried over the next composer, and writes it down in its own thread once stopped', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = tasks()
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    view.unmount()
    // Another task: nothing is written down yet; the pill says whose it is, still listening.
    const next = withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    const pill = await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Carry on with the tests.')
    // Written: to read, change and send, there or here.
    const card = await screen.findByRole('region', { name: 'To the lead · Add a retry' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Carry on with the tests.')
    expect((await taskBox()).value).toBe('')
    next.unmount()
    // Back at its own composer, the words are in its draft, and nothing is carried.
    withServices(<Task />, client, host)
    expect((await taskBox()).value).toBe('Carry on with the tests.')
    expect(screen.getByText(AWAY)).toBeTruthy()
    expect(screen.queryByRole('region', { name: /^To the lead/ })).toBeNull()
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

describe('dictation, once its composer goes from the screen while the view stays', () => {
  it('goes on listening as the project shows its board, and is still listening back in the conversation', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient()
    withServices(<Project room={Room.Both} />, client, host)
    await coordinatorBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    const views = screen.getByRole('radiogroup', { name: 'View' })
    await userEvent.click(within(views).getByRole('radio', { name: 'Board' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Tell the coordinator something' })).toBeNull())
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
    await userEvent.click(within(views).getByRole('radio', { name: 'Conversation' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await speech.heard('Why is checkout slow?')
    expect((await coordinatorBox()).value).toBe('Why is checkout slow?')
    // They were back before it was written: nothing to say.
    expect(screen.queryByText(AWAY)).toBeNull()
  })

  it('goes on listening as a task shows its outputs', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    // o for the outputs, from outside the field.
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    await userEvent.keyboard('o')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /^Tell .* something$/ })).toBeNull())
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
    await userEvent.keyboard('c')
    await userEvent.click(await screen.findByRole('button', { name: /^Stop dictating/ }))
    await speech.heard('Carry on with the tests.')
    expect((await taskBox()).value).toBe('Carry on with the tests.')
  })
})

describe('dictation carried from a task', () => {
  it('is sent to the task’s lead from the coordinator', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = tasks()
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    view.unmount()
    withServices(<Project />, client, host)
    await coordinatorBox()
    const pill = await screen.findByRole('group', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Carry on with the tests.')
    const card = await screen.findByRole('region', { name: 'To the lead · Add a retry' })
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Carry on with the tests.', disposition: 'after_current' }),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'To the lead · Add a retry' })).toBeNull())
    expect((await coordinatorBox()).value).toBe('')
  })
})

describe('dictation carried with the person', () => {
  /** Talking to the coordinator, then off to a task while it listens. */
  const toTheTask = async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = tasks()
    const view = withServices(<Project />, client, host)
    await coordinatorBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    view.unmount()
    const task = withServices(<Task />, client, host)
    await taskBox()
    const pill = await screen.findByRole('group', { name: 'To the coordinator · meridian' })
    return { speech, client, host, pill, task }
  }

  it('shows the words as they are said over the task, and still over the next one', async () => {
    const { speech, client, host, pill, task } = await toTheTask()
    const [thread] = listeningIn()
    act(() => changeSession(thread!, { interim: 'Why is checkout' }))
    expect(within(pill).getByText(/Why is checkout/)).toBeTruthy()
    task.unmount()
    withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    const again = await screen.findByRole('group', { name: 'To the coordinator · meridian' })
    act(() => changeSession(thread!, { interim: 'Why is checkout slow on mobile' }))
    expect(within(again).getByText(/slow on mobile/)).toBeTruthy()
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
  })

  it('sends once while the person goes on elsewhere, and leaves what they write meanwhile as it is', async () => {
    const { speech, client, host, pill, task } = await toTheTask()
    let arrive = () => {}
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((resolve) => void (arrive = resolve)))
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the coordinator' }))
    // What is being sent stays as it went.
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).readOnly).toBe(true)
    // Another task meanwhile: still being sent, and not sent again.
    task.unmount()
    const next = withServices(<Task threadId="th2" />, client, host)
    await taskBox()
    const again = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(again).getByRole('button', { name: 'Send to the coordinator' }))
    expect(client.send).toHaveBeenCalledTimes(1)
    // Back at the coordinator before it is there: nothing of it to send again from its composer.
    next.unmount()
    withServices(<Project />, client, host)
    const box = await coordinatorBox()
    expect(box.value).toBe('')
    await userEvent.type(box, '{Enter}')
    expect(client.send).toHaveBeenCalledTimes(1)
    // What they write there, even starting the same, is theirs once it is there.
    await userEvent.type(box, 'Why is checkout slow? On mobile')
    await act(async () => arrive())
    await waitFor(() => expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull())
    expect(box.value).toBe('Why is checkout slow? On mobile')
    expect(client.send).toHaveBeenCalledTimes(1)
  })

  it('goes on carrying what they started saying while it was sent', async () => {
    const { speech, client, host, pill, task } = await toTheTask()
    let arrive = () => {}
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((resolve) => void (arrive = resolve)))
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the coordinator' }))
    // Back at the coordinator, they start saying more, and are off to the task again while it listens.
    task.unmount()
    const project = withServices(<Project />, client, host)
    await coordinatorBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    project.unmount()
    withServices(<Task />, client, host)
    await taskBox()
    // The first arrives: the second is still carried, listening.
    await act(async () => arrive())
    const again = screen.getByRole('group', { name: 'To the coordinator · meridian' })
    expect(within(again).getByRole('button', { name: /^Stop and write it down/ })).toBeTruthy()
  })

  it('is back in its composer, before what they wrote meanwhile, where it didn’t go', async () => {
    const { speech, client, host, pill, task } = await toTheTask()
    let fail = () => {}
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((_, reject) => void (fail = () => reject(new Error('offline')))))
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Use Redis')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the coordinator' }))
    task.unmount()
    withServices(<Project />, client, host)
    const box = await coordinatorBox()
    await userEvent.type(box, 'Use Redisson')
    await act(async () => fail())
    await waitFor(() => expect(box.value).toBe('Use Redis\n\nUse Redisson'))
  })

  it('sends what was written to the thread it was said in, and is gone', async () => {
    const { speech, client, pill } = await toTheTask()
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    const field = within(card).getByRole('textbox', { name: 'What you said' })
    // Changed before it goes.
    await userEvent.type(field, ' On mobile.')
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the coordinator' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Why is checkout slow? On mobile.', disposition: 'after_current' }),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull())
    // Nothing went to the task.
    expect((await taskBox()).value).toBe('')
  })

  it('keeps it, to send again, where it didn’t send', async () => {
    const { speech, client, pill } = await toTheTask()
    vi.mocked(client.send).mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Send to the coordinator' }))
    expect(await within(card).findByRole('alert')).toBeTruthy()
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Why is checkout slow?')
  })

  it('moves into the composer on screen instead, after what is there', async () => {
    const { speech, pill } = await toTheTask()
    await userEvent.type(await taskBox(), 'First,')
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('check the retry path.')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Move it to this task' }))
    expect((await taskBox()).value).toBe('First,\n\ncheck the retry path.')
    expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull()
  })

  it('keeps what couldn’t be written down, to try again from the pill', async () => {
    const { speech, pill } = await toTheTask()
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.fails()
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    expect(within(card).getByText(/of what you said couldn’t be written down/)).toBeTruthy()
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }))
    await speech.heard('Why is checkout slow?')
    const written = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    expect(within(written).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Why is checkout slow?')
  })

  it('throws away what couldn’t be written down, from the pill', async () => {
    const { speech, pill } = await toTheTask()
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.fails()
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Throw it away' }))
    expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull()
  })

  it('keeps what was written for later, and goes back to its composer', async () => {
    const { speech, pill } = await toTheTask()
    await userEvent.click(within(pill).getByRole('button', { name: /^Stop and write it down/ }))
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Back to it' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Keep it for later' }))
    expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull()
  })

  it('is thrown away from the pill, and never written down', async () => {
    const { speech, pill } = await toTheTask()
    await userEvent.click(within(pill).getByRole('button', { name: 'Show all of what you said' }))
    const card = screen.getByRole('region', { name: 'To the coordinator · meridian' })
    await userEvent.click(within(card).getByRole('button', { name: 'Throw it away' }))
    expect(screen.queryByRole('region', { name: 'To the coordinator · meridian' })).toBeNull()
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
  })

  it('isn’t lost by Escape, which goes back from a task', async () => {
    const { speech } = await toTheTask()
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('group', { name: 'To the coordinator · meridian' })).toBeTruthy()
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
  })

  it('stops with the shortcut, rather than the composer on screen starting its own', async () => {
    const { speech } = await toTheTask()
    fireEvent.keyDown(window, { key: 'd', metaKey: true, shiftKey: true })
    await waitFor(() => expect(speech.dictation.transcribe).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /^Stop dictating/ })).toBeNull()
  })

  it('is written down as the person starts talking to another thread, so only one listens', async () => {
    const { speech } = await toTheTask()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    await speech.heard('Why is checkout slow?')
    const card = await screen.findByRole('region', { name: 'To the coordinator · meridian' })
    expect(within(card).getByRole<HTMLTextAreaElement>('textbox', { name: 'What you said' }).value).toBe('Why is checkout slow?')
  })
})

describe('dictation started just as the person leaves', () => {
  it('closes a microphone that opens once they have gone, so nothing listens where nobody sees', async () => {
    const speech = slowDictation()
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    const cancel = vi.fn()
    const stop = vi.fn(() => ({ samples: new Float32Array(32_000), sampleRate: 16_000 }))
    let open: () => void = () => {}
    vi.mocked(record).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          open = () => resolve({ peek: stop, stop, cancel, use: vi.fn(async () => {}) })
        }),
    )
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await waitFor(() => expect(record).toHaveBeenCalled())
    // Gone before the system hands the microphone over.
    view.unmount()
    await act(async () => open())
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speech.dictation.transcribe).not.toHaveBeenCalled()
    withServices(<Task />, client, host)
    await taskBox()
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Stop dictating/ })).toBeNull()
  })

  it('opens no microphone once they have gone while the system asked for it', async () => {
    const speech = slowDictation()
    let allow: (allowed: boolean) => void = () => {}
    vi.mocked(speech.dictation.state).mockResolvedValue({ ...READY, microphone: 'ask' })
    vi.mocked(speech.dictation.allow).mockImplementationOnce(() => new Promise<boolean>((resolve) => (allow = resolve)))
    const host = fakeHost({ dictation: speech.dictation })
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    vi.mocked(record).mockClear()
    const view = withServices(<Task />, client, host)
    await taskBox()
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await waitFor(() => expect(speech.dictation.allow).toHaveBeenCalled())
    view.unmount()
    await act(async () => allow(true))
    expect(record).not.toHaveBeenCalled()
  })
})
