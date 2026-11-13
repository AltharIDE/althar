import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer, DictationTray } from '@althar/ui'

import type { DictationHost, DictationState } from '../src/renderer/data/services'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { forgetSessions } from '../src/renderer/shared/dictation/sessions'
import { useDictation } from '../src/renderer/shared/dictation/useDictation'
import { draftOf, forgetDrafts, setDraftText, useDraft } from '../src/renderer/shared/drafts'
import { coordinatorSnapshot, fakeClient, fakeHost, snapshot } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * Sending while dictating: Enter or the send button ends what is recorded,
 * waits for it to be written down, and sends the words and what was attached
 * as one message. If it can't be written down, nothing goes.
 */

const READY: DictationState = {
  platform: 'darwin',
  microphone: 'granted',
  settings: true,
  model: { name: 'Parakeet', ready: true, got: 1, size: 1, downloading: false },
}

/** A host whose writing down waits for the test to say what was heard, or that it couldn't be. */
const slowDictation = () => {
  const waiting: Array<{ heard: (text: string) => void; failed: () => void }> = []
  const dictation: DictationHost = {
    state: vi.fn(async () => READY),
    allow: vi.fn(async () => true),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          waiting.push({ heard: resolve, failed: () => reject(new Error('no speech process')) })
        }),
    ),
    openSettings: vi.fn(async () => true),
    onEvent: vi.fn(() => () => {}),
  }
  const next = async () => {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0))
    return waiting.shift()!
  }
  return {
    dictation,
    /** The next writing down ends: with these words. */
    heard: async (text: string) => {
      const one = await next()
      await act(async () => one.heard(text))
    },
    /** The next writing down ends: it couldn't. */
    failed: async () => {
      const one = await next()
      await act(async () => one.failed())
    },
  }
}

// The views hear a microphone that heard two seconds of something.
vi.mock('../src/renderer/shared/dictation/recorder', () => ({
  record: vi.fn(async () => {
    const heard = () => ({ samples: new Float32Array(32_000), sampleRate: 16_000 })
    return { peek: heard, stop: heard, cancel: vi.fn(), use: vi.fn(async () => {}) }
  }),
}))

const THREAD = 'thread:th1'

function Harness({
  onSubmit,
  onSendNow,
  attached,
}: {
  onSubmit: (text: string) => void
  onSendNow?: (text: string) => void
  attached: boolean
}) {
  const [draft, setDraft] = useDraft(THREAD)
  const voice = useDictation(THREAD, { projectId: 'p1' })
  return (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={onSubmit}
      {...(onSendNow === undefined ? {} : { onSendNow, busy: true })}
      placeholder="Tell the lead"
      inputRef={voice.inputRef}
      dictation={voice.dictation}
      tray={voice.tray && <DictationTray {...voice.tray} />}
      images={attached ? [{ id: 'i1', name: 'shot.png' }] : []}
    />
  )
}

const field = () => screen.getByRole('textbox', { name: 'Tell the lead' })
const finishing = () => screen.queryByRole('button', { name: 'Finishing the transcription' })

const open = (props: { attached: boolean; typed?: string; busy?: boolean }) => {
  const speech = slowDictation()
  const onSubmit = vi.fn()
  const onSendNow = vi.fn()
  if (props.typed !== undefined) setDraftText(THREAD, props.typed)
  withServices(
    <Harness onSubmit={onSubmit} attached={props.attached} {...(props.busy ? { onSendNow } : {})} />,
    fakeClient().client,
    fakeHost({ dictation: speech.dictation }),
  )
  return { speech, onSubmit, onSendNow }
}

const recording = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
  return screen.findByRole('button', { name: /^Stop dictating/ })
}

afterEach(() => {
  forgetSessions()
  forgetDrafts()
})

describe.each([
  ['Enter', () => fireEvent.keyDown(field(), { key: 'Enter' })],
  ['the send button', () => fireEvent.click(screen.getByRole('button', { name: 'Send' }))],
])('%s while recording', (_name, send) => {
  it('stops it, waits for the transcript, and sends it with the attachment as one message', async () => {
    const { speech, onSubmit } = open({ attached: true })
    await recording()
    send()
    // Stopped, being written down: nothing has gone, and the button says why.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Stop dictating/ })).toBeNull())
    expect(await screen.findByRole('button', { name: 'Finishing the transcription' })).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('check the retry path')
    expect(draftOf(THREAD).dictated).toBe(true)
    expect(finishing()).toBeNull()
  })

  // With no attachment and nothing typed there is no send button: Enter only.
  it.runIf(_name === 'Enter')('does the same with nothing attached', async () => {
    const { speech, onSubmit } = open({ attached: false })
    await recording()
    send()
    expect(await screen.findByRole('button', { name: 'Finishing the transcription' })).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('check the retry path'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('adds the transcript to what was typed', async () => {
    const { speech, onSubmit } = open({ attached: false, typed: 'Look at this.' })
    await recording()
    send()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('Look at this. check the retry path')
  })
})

describe.each([
  ['Enter', () => fireEvent.keyDown(field(), { key: 'Enter' })],
  ['the send button', () => fireEvent.click(screen.getByRole('button', { name: 'Send' }))],
])('%s while it is being transcribed', (_name, send) => {
  /** Recording, stopped with the microphone; the transcript has not come. */
  const transcribing = async (props: Parameters<typeof open>[0]) => {
    const opened = open(props)
    await userEvent.click(await recording())
    await waitFor(() => expect(opened.speech.dictation.transcribe).toHaveBeenCalledTimes(1))
    return opened
  }

  it('waits for the transcript and sends it with the attachment, once', async () => {
    const { speech, onSubmit } = await transcribing({ attached: true })
    send()
    // Pressed again, it still goes once.
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Finishing the transcription' })).toBeTruthy()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('check the retry path'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.runIf(_name === 'Enter')('does the same with nothing attached', async () => {
    const { speech, onSubmit } = await transcribing({ attached: false })
    send()
    expect(onSubmit).not.toHaveBeenCalled()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('check the retry path'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('adds the transcript to what was typed', async () => {
    const { speech, onSubmit } = await transcribing({ attached: true, typed: 'Look at this.' })
    send()
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Look at this. check the retry path'))
  })
})

describe('when it can’t be written down', () => {
  it('sends nothing, keeps the attachment, and says why', async () => {
    const { speech, onSubmit } = open({ attached: true, typed: 'Look at this.' })
    await userEvent.click(await recording())
    fireEvent.keyDown(field(), { key: 'Enter' })
    await speech.failed()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Not sent'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(finishing()).toBeNull()
    // What was typed and attached is where it was, and what was said is kept to try again.
    expect(screen.getByRole('list', { name: '1 attachment to send' })).toBeTruthy()
    expect(field()).toHaveProperty('value', 'Look at this.')
    expect(screen.getByText('Couldn’t write that down')).toBeTruthy()
    // Typing works again, and the next send goes.
    await userEvent.type(field(), ' Typed instead.')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('Look at this. Typed instead.')
  })

  it('sends it once it is tried again, from the tray, and the next send', async () => {
    const { speech, onSubmit } = open({ attached: true })
    await userEvent.click(await recording())
    fireEvent.keyDown(field(), { key: 'Enter' })
    await speech.failed()
    await screen.findByText('Couldn’t write that down')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await speech.heard('check the retry path')
    await waitFor(() => expect(field()).toHaveProperty('value', 'check the retry path'))
    // The line is gone with the failure.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('check the retry path')
  })

  it('doesn’t hold back what is said after an earlier one that failed', async () => {
    const { speech, onSubmit } = open({ attached: true })
    await userEvent.click(await recording())
    await speech.failed()
    await screen.findByText('Couldn’t write that down')
    // The first is kept; a second one is written down, and goes.
    await recording()
    fireEvent.keyDown(field(), { key: 'Enter' })
    await speech.heard('second try')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('second try'))
  })
})

describe('sending with Send now while the lead works', () => {
  it('waits for the transcript too', async () => {
    const { speech, onSubmit, onSendNow } = open({ attached: true, busy: true })
    await recording()
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, ctrlKey: true })
    await speech.heard('check the retry path')
    await waitFor(() => expect(onSendNow).toHaveBeenCalledWith('check the retry path'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('a task’s composer', () => {
  it('sends what was said as the message to the lead, once it is written down', async () => {
    const speech = slowDictation()
    const { client } = fakeClient({ getThread: vi.fn(async () => snapshot()) })
    function Task() {
      return <TaskView model={useTask('th1')} onBack={vi.fn()} />
    }
    withServices(<Task />, client, fakeHost({ dictation: speech.dictation }))
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /^Tell .* something$/ })
    await userEvent.type(box, 'Look at this.')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(client.send).not.toHaveBeenCalled()
    await speech.heard('check the retry path')
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Look at this. check the retry path', dictated: true }))
  })
})

describe('the coordinator’s composer', () => {
  function Project() {
    return (
      <ProjectView
        model={useProject('p1')}
        board={useBoard('p1')}
        connections={useConnections()}
        settings={useSettingsOf('p1')}
        onTask={vi.fn()}
      />
    )
  }

  it('sends what was said as the message to the coordinator, once it is written down', async () => {
    const speech = slowDictation()
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project />, client, fakeHost({ dictation: speech.dictation }))
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /Tell the coordinator something/ })
    await userEvent.type(box, 'Look at this.')
    await userEvent.click(screen.getByRole('button', { name: 'Dictate' }))
    await screen.findByRole('button', { name: /^Stop dictating/ })
    fireEvent.click(screen.getByRole('button', { name: /^Send|^Queue/ }))
    expect(client.send).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Finishing the transcription' })).toBeTruthy()
    await speech.heard('check the retry path')
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Look at this. check the retry path', dictated: true }))
  })
})
