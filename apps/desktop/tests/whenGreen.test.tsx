import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ChangeSummary, ThreadSnapshot } from '@althar/contracts'

import { useWhenGreen } from '../src/renderer/data/whenGreen'
import { Outputs } from '../src/renderer/features/task/Outputs'
import { change, fakeClient, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * Merge when checks pass, on a task's Change card and on the track of a
 * change with several pull requests, and the window's own record of a press:
 * waiting from the press, Don't merge at once, and why one came back.
 */

const running = {
  outcome: 'running' as const,
  passed: 1,
  failed: 0,
  running: 1,
  total: 2,
  failing: [],
  list: [
    { name: 'lint', state: 'passed' as const, summary: null },
    { name: 'test', state: 'running' as const, summary: null },
  ],
}

const pr = (repository: string, number: number, overrides: Partial<ChangeSummary> = {}): ChangeSummary =>
  change({
    repository: `meridian/${repository}`,
    slug: repository,
    number,
    url: `https://github.com/meridian/${repository}/pull/${number}`,
    draft: false,
    head: `head-${number}`,
    checks: running,
    ...overrides,
  })

const task = (changes: ReadonlyArray<ChangeSummary>): ThreadSnapshot =>
  snapshot({ session: null, task: { ...snapshot().task, phase: 'ready', changes: [...changes] } })

const show = (
  snap: ThreadSnapshot,
  stands: { readonly waiting?: ReadonlyArray<string>; readonly back?: Readonly<Record<string, string>> } = {},
) => {
  const whenGreen = {
    waiting: (one: ChangeSummary) => stands.waiting?.includes(one.url) === true,
    back: (one: ChangeSummary) => stands.back?.[one.url] ?? null,
    onPress: vi.fn(),
    onLeave: vi.fn(),
  }
  withServices(
    <Outputs
      snapshot={snap}
      pending={false}
      error={null}
      whenGreen={whenGreen}
      onAccept={vi.fn()}
      onMergeHere={vi.fn()}
      onOpenChange={vi.fn()}
      onPush={vi.fn()}
      onMarkReady={vi.fn()}
      onMarkAllReady={vi.fn()}
      onOpenFile={vi.fn()}
      onPushBranch={vi.fn()}
      onConnect={vi.fn()}
      onReplace={vi.fn()}
      onBringIn={vi.fn()}
    />,
    fakeClient().client,
  )
  return whenGreen
}

describe('Merge when checks pass on a task’s Change card', () => {
  it('offers it in Merge’s place while only its checks run, at the head shown', async () => {
    const one = pr('api', 12)
    const { onPress } = show(task([one]))
    expect(screen.queryByRole('button', { name: 'Accept and merge' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Merge when checks pass' }))
    expect(onPress).toHaveBeenCalledWith(one.url, 'head-12')
  })

  it('offers Merge itself once its checks passed', () => {
    show(task([pr('api', 12, { checks: { ...running, outcome: 'passed', passed: 2, running: 0, list: [] } })]))
    expect(screen.getByRole('button', { name: 'Accept and merge' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge when checks pass' })).toBeNull()
  })

  it('isn’t offered on Bitbucket Cloud, whose merge can’t be held to the head shown', () => {
    show(task([pr('api', 12, { product: 'bitbucket_cloud' })]))
    expect(screen.queryByRole('button', { name: 'Merge when checks pass' })).toBeNull()
  })

  it('waits, with Don’t merge beside it; once in its queue, the card’s own word says so and Don’t merge stays', async () => {
    const one = pr('api', 12)
    const { onLeave } = show(task([one]), { waiting: [one.url] })
    expect(screen.getByText('Merges after checks')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Don’t merge' }))
    expect(onLeave).toHaveBeenCalledWith(one.url)
  })

  it('in its queue, offers only Don’t merge', async () => {
    const one = pr('api', 12, { queued: true })
    const { onLeave } = show(task([one]), { waiting: [one.url] })
    expect(screen.queryByText('Merges after checks')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Don’t merge' }))
    expect(onLeave).toHaveBeenCalledWith(one.url)
  })

  it('says why one came back, where nothing else went wrong', () => {
    const one = pr('api', 12)
    show(task([one]), { back: { [one.url]: 'Not merged: its checks failed.' } })
    expect(screen.getByText('Not merged: its checks failed.')).toBeTruthy()
  })
})

describe('Merge when checks pass on a change of several pull requests', () => {
  it('offers it for the first still open, so they still merge in order', async () => {
    const first = pr('api', 12)
    const second = pr('web', 7)
    const { onPress } = show(task([first, second]))
    await userEvent.click(screen.getByRole('button', { name: /Merge when checks pass: / }))
    expect(onPress).toHaveBeenCalledWith(first.url, 'head-12')
  })

  it('waits there with Don’t merge, or only Don’t merge once queued', async () => {
    const first = pr('api', 12)
    const { onLeave } = show(task([first, pr('web', 7)]), { waiting: [first.url] })
    expect(screen.getByText('Merges after checks')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Don’t merge' }))
    expect(onLeave).toHaveBeenCalledWith(first.url)
  })

  it('queued and waiting, offers only Don’t merge', () => {
    const first = pr('api', 12, { queued: true })
    show(task([first, pr('web', 7)]), { waiting: [first.url] })
    expect(screen.getByRole('button', { name: 'Don’t merge' })).toBeTruthy()
    expect(screen.queryByText('Merges after checks')).toBeNull()
  })

  it('says why one came back on its own stop', () => {
    const first = pr('api', 12)
    show(task([first, pr('web', 7)]), { back: { [first.url]: 'Not merged: it conflicts with main.' } })
    expect(screen.getByText(/it conflicts with main/).textContent).not.toMatch(/Not merged: Not merged/)
  })
})

/** A pull request as a read gives it, which the test changes as the runtime would, and the window's press of it. */
function Pressing({ initial }: { initial: ChangeSummary }) {
  const green = useWhenGreen()
  const [read, setRead] = useState(initial)
  return (
    <div>
      <p data-testid="stands">{green.waiting(read) ? 'waiting' : 'not waiting'}</p>
      <p data-testid="back">{green.back(read) ?? 'none'}</p>
      <button type="button" onClick={() => green.press('t1', read.url, read.head ?? '')}>
        press
      </button>
      <button type="button" onClick={() => green.leave('t1', read.url)}>
        leave
      </button>
      <button type="button" onClick={() => setRead((was) => ({ ...was, whenGreen: { state: 'waiting', head: 'head-12' } }))}>
        read waiting
      </button>
      <button
        type="button"
        onClick={() => setRead((was) => ({ ...was, whenGreen: { state: 'sent_back', reason: 'Not merged: its checks failed.' } }))}
      >
        read sent back, of before
      </button>
      <button type="button" onClick={() => setRead((was) => ({ ...was, state: 'merged' }))}>
        read merged
      </button>
      <button type="button" onClick={() => setRead((was) => ({ ...was, whenGreen: undefined }))}>
        read nothing
      </button>
      <PressAnswered setRead={setRead} />
    </div>
  )
}

/** A read that answers the last press made, by its id, as the runtime's does: sent back at once. */
function PressAnswered({ setRead }: { setRead: (next: (was: ChangeSummary) => ChangeSummary) => void }) {
  return (
    <button
      type="button"
      onClick={() =>
        setRead((was) => ({
          ...was,
          whenGreen: { state: 'sent_back', reason: 'Not merged: new commits were pushed after you pressed.', press: lastPress() },
        }))
      }
    >
      read answered
    </button>
  )
}

let pressIds: Array<string> = []
const lastPress = () => pressIds.at(-1) ?? ''

const pressing = (client: ReturnType<typeof fakeClient>['client']) => {
  withServices(<Pressing initial={pr('api', 12)} />, client)
  const stands = () => screen.getByTestId('stands').textContent
  const back = () => screen.getByTestId('back').textContent
  const press = (name: string) => userEvent.click(screen.getByRole('button', { name }))
  return { stands, back, press }
}

describe('the window’s record of Merge when checks pass', () => {
  it('waits from the press, and lets older reads not take it back; a read of this very press says why it came back', async () => {
    pressIds = []
    const { client } = fakeClient({
      mergeWhenGreen: vi.fn(async (_task: string, _url: string, _head: string, press: string) => {
        pressIds.push(press)
      }),
    })
    const { stands, back, press } = pressing(client)
    expect(stands()).toBe('not waiting')
    await press('press')
    expect(stands()).toBe('waiting')
    await waitFor(() =>
      expect(client.mergeWhenGreen).toHaveBeenCalledWith('t1', 'https://github.com/meridian/api/pull/12', 'head-12', expect.any(String)),
    )
    // A read of before the press, sent back then: not this press's answer.
    await press('read sent back, of before')
    expect(stands()).toBe('waiting')
    expect(back()).toBe('none')
    // This press's own answer, sent back at once: said, not held as waiting.
    await press('read answered')
    expect(stands()).toBe('not waiting')
    expect(back()).toBe('Not merged: new commits were pushed after you pressed.')
    // Merged: nothing of it any more.
    await press('read merged')
    expect(stands()).toBe('not waiting')
    expect(back()).toBe('none')
  })

  it('Don’t merge stops waiting at once, and a press the runtime refused says why', async () => {
    const { client } = fakeClient({
      mergeWhenGreen: vi.fn(async () => {
        throw new Error('That pull request isn’t this task’s.')
      }),
    })
    const { stands, back, press } = pressing(client)
    await press('read waiting')
    expect(stands()).toBe('waiting')
    await press('leave')
    expect(stands()).toBe('not waiting')
    await waitFor(() => expect(client.leaveMergeLine).toHaveBeenCalled())
    // The read still says waiting, from before Don't merge: not taken back by it.
    expect(stands()).toBe('not waiting')
    await press('read nothing')
    expect(stands()).toBe('not waiting')
    await press('press')
    // Refused: said, whatever the words the runtime gives.
    await waitFor(() => expect(back()).not.toBe('none'))
    expect(stands()).toBe('not waiting')
  })

  it('shows nothing for a pull request that isn’t open', () => {
    const { client } = fakeClient()
    withServices(<Pressing initial={pr('api', 12, { state: 'closed', whenGreen: { state: 'waiting' } })} />, client)
    expect(within(screen.getByTestId('stands')).getByText('not waiting')).toBeTruthy()
  })
})
