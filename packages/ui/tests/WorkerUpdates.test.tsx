import { render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { Updates, type UpdateRow, updatesText } from '../src/chrome/Updates/Updates'
import { WORKER_AT_WORK, WORKER_FREE } from '../src/fixtures/computers'
import { LOAD_BUSY } from '../src/fixtures/load'
import { Computers, type ComputerWorker } from '../src/setup/Computers/Computers'
import { WorkerUpdateStrip } from '../src/setup/Computers/WorkerUpdateStrip'
import { fleetUpdate, shortUpdate, WORKER_UPDATE_COMMAND, type WorkerUpdateView } from '../src/setup/Computers/workerUpdate'

/*
 * A worker's update as the window says it: each worker's, the fleet's in a
 * line, the strip at the head of Workers with its press, Computers' modules
 * and sheet; and the bar's one glyph for every update, its rows in order,
 * each put aside on its own.
 */

const hermes = (update: WorkerUpdateView, task: ComputerWorker['task'] = null): ComputerWorker => ({
  ...WORKER_FREE,
  id: 'wrk_hermes',
  name: 'hermes-box',
  release: '0.2.2',
  task,
  state: task === null ? 'free' : 'working',
  update,
})
const refresh = { id: 'task_1', title: 'Repair token refresh', project: 'Meridian' }

describe('the fleet’s update, said', () => {
  it('says one worker’s update through each of its states', () => {
    expect(fleetUpdate([hermes({ state: 'offer', to: '0.3.0', from: '0.2.2' })])).toMatchObject({
      state: 'offer',
      title: 'hermes-box can update to 0.3.0',
      line: 'From 0.2.2. It restarts once, in about a minute.',
      press: 'Update',
      ids: ['wrk_hermes'],
      byHand: false,
    })
    expect(fleetUpdate([hermes({ state: 'offer', to: '0.3.0' }, refresh)])).toMatchObject({
      line: 'It’s at work on Repair token refresh. It updates once that’s done, before its next task.',
      press: 'Update after its task',
    })
    expect(fleetUpdate([hermes({ state: 'afterTask', to: '0.3.0' }, refresh)])).toMatchObject({
      state: 'waiting',
      title: 'hermes-box updates after its task',
      line: 'Once Repair token refresh is done, before its next task.',
      cancel: 'wrk_hermes',
    })
    expect(fleetUpdate([hermes({ state: 'whenOnline', to: '0.3.0' })])).toMatchObject({
      state: 'waiting',
      title: 'hermes-box updates when it connects',
    })
    expect(fleetUpdate([hermes({ state: 'running', to: '0.3.0', step: 'restarting' })])).toMatchObject({
      state: 'running',
      title: 'Updating hermes-box',
      line: 'Restarting hermes-box',
      step: { at: 1, names: ['Getting 0.3.0', 'Restarting hermes-box'] },
    })
    expect(fleetUpdate([hermes({ state: 'done', version: '0.3.0' })])).toMatchObject({ state: 'done', title: 'hermes-box is on 0.3.0' })
    expect(fleetUpdate([hermes({ state: 'failed', to: '0.3.0', message: 'No space left on device' })])).toMatchObject({
      state: 'failed',
      title: 'Couldn’t update hermes-box',
      line: 'No space left on device',
      press: 'Try again',
      byHand: true,
    })
    // One that can't be asked updates on its own, and says how to run it now by hand.
    expect(fleetUpdate([hermes({ state: 'byItself', to: '0.3.0' })])).toMatchObject({
      state: 'byItself',
      line: 'It updates on its own within the hour, between its tasks.',
      ids: [],
      byHand: true,
    })
    expect(fleetUpdate([{ ...WORKER_FREE }])).toBeNull()
  })

  it('leads a fleet with what failed, then what runs, what can update, what waits and what’s done', () => {
    const worker = (id: string, update: WorkerUpdateView, task: ComputerWorker['task'] = null) => ({ id, name: id, task, update })
    const offer = { state: 'offer', to: '0.3.0' } as const
    expect(
      fleetUpdate([
        worker('a', offer),
        worker('b', offer, refresh),
        worker('c', { state: 'byItself', to: '0.3.0' }),
        { id: 'd', name: 'd' },
      ]),
    ).toMatchObject({
      state: 'offer',
      one: null,
      title: '2 workers can update to 0.3.0',
      line: 'Each restarts once, between its tasks: the one at work once it’s done. 1 more updates on its own within the hour.',
      press: 'Update all',
      ids: ['a', 'b'],
    })
    const mixed = [
      worker('a', { state: 'running', to: '0.3.0', step: 'getting' }),
      worker('b', { state: 'done', version: '0.3.0' }),
      worker('c', { state: 'afterTask', to: '0.3.0' }, refresh),
      worker('d', { state: 'failed', to: '0.3.0', message: 'x' }),
    ]
    expect(fleetUpdate(mixed)).toMatchObject({
      state: 'running',
      title: 'Updating 4 workers',
      line: '1 on 0.3.0 · 1 after its task · d couldn’t',
      done: 1,
      of: 4,
    })
    expect(fleetUpdate(mixed.slice(1))).toMatchObject({
      state: 'failed',
      one: { id: 'd' },
      title: 'Couldn’t update d',
      line: 'x 1 on 0.3.0 · 1 after its task',
      ids: ['d'],
    })
    expect(fleetUpdate(mixed.slice(1, 3))).toMatchObject({ state: 'waiting', title: 'c updates after its task', line: '1 on 0.3.0' })
    expect(fleetUpdate(mixed.slice(1, 2).concat(worker('e', { state: 'done', version: '0.3.0' })))).toMatchObject({
      state: 'done',
      title: 'Your workers are on 0.3.0',
    })
  })

  it('says a worker’s update in a few words, under where it stands', () => {
    expect(shortUpdate({ state: 'offer', to: '0.3.0' }, 'x')).toBe('Can update to 0.3.0')
    expect(shortUpdate({ state: 'running', to: '0.3.0', step: 'getting' }, 'x')).toBe('Getting 0.3.0')
    expect(shortUpdate({ state: 'done', version: '0.3.0' }, 'x')).toBe('Updated to 0.3.0')
    expect(shortUpdate(undefined, 'x')).toBeNull()
  })
})

describe('the strip', () => {
  it('asks the workers it names, takes back one waiting, and folds the command away where it can’t ask', async () => {
    const onUpdate = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <WorkerUpdateStrip fleet={fleetUpdate([hermes({ state: 'offer', to: '0.3.0' })])!} onUpdate={onUpdate} onCancel={onCancel} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledWith(['wrk_hermes'])
    rerender(
      <WorkerUpdateStrip
        fleet={fleetUpdate([hermes({ state: 'afterTask', to: '0.3.0' }, refresh)])!}
        onUpdate={onUpdate}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledWith('wrk_hermes')
    rerender(<WorkerUpdateStrip fleet={fleetUpdate([hermes({ state: 'byItself', to: '0.3.0' })])!} onUpdate={onUpdate} />)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Update it on hermes-box yourself/ }))
    expect(await screen.findByText(WORKER_UPDATE_COMMAND)).toBeTruthy()
    // Said, not pressed, where the window can't ask.
    rerender(<WorkerUpdateStrip fleet={fleetUpdate([hermes({ state: 'offer', to: '0.3.0' })])!} />)
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })
})

describe('Computers, with updates', () => {
  const computers = (list: ComputerWorker[], opened: string | null = null) => {
    const onUpdate = vi.fn()
    render(
      <Computers
        home={{ name: 'This Mac', load: LOAD_BUSY, agents: null }}
        workers={{ enabled: true, list }}
        opened={opened}
        onOpen={() => undefined}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onUpdate={onUpdate}
        newest="0.3.0"
      />,
    )
    return onUpdate
  }

  it('leads Workers with the fleet’s update, each module saying only what differs from it', async () => {
    const onUpdate = computers([
      { ...WORKER_FREE, update: { state: 'offer', to: '0.3.0' } },
      { ...WORKER_AT_WORK, update: { state: 'afterTask', to: '0.3.0' } },
      { ...WORKER_FREE, id: 'wrk_up', name: 'up-to-date' },
    ])
    const strip = screen.getByRole('region', { name: 'Linux worker 98b21d can update to 0.3.0' })
    await userEvent.click(within(strip).getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledWith([WORKER_FREE.id])
    // The module of the one offered doesn't say it again; the one waiting says so.
    expect(screen.queryByText('Can update to 0.3.0')).toBeNull()
    expect(screen.getByText('Updates after its task')).toBeTruthy()
  })

  it('says Updating where Free would be while its updater runs, and its release beside the newest, opened out', () => {
    computers([{ ...WORKER_FREE, release: '0.2.2', update: { state: 'running', to: '0.3.0', step: 'getting' } }], WORKER_FREE.id)
    expect(screen.getByText('Updating', { selector: 'span' })).toBeTruthy()
    expect(screen.queryByText('Free')).toBeNull()
    expect(screen.getByText('0.2.2')).toBeTruthy()
    expect(screen.getByText('0.3.0 is out')).toBeTruthy()
  })
})

describe('the bar’s Updates', () => {
  const rows = (over: Partial<Record<'app' | 'home' | 'workers', Partial<UpdateRow>>> = {}): UpdateRow[] => [
    { kind: 'workers', tone: 'offer', title: '3 workers can update to 0.3.0', who: '3 workers', hides: true, ...over.workers },
    { kind: 'app', tone: 'offer', title: 'Althar 0.10.1 is ready', who: 'Althar 0.10.1', hides: true, ...over.app },
    { kind: 'home', tone: 'offer', title: 'runner-1 can update to 0.3.0', who: 'runner-1', hides: true, ...over.home },
  ]

  it('is one glyph, named by what’s under it, a dot while something can update; nothing with nothing to update', () => {
    const { rerender, container } = render(<Updates rows={rows()} />)
    const glyph = screen.getByRole('button', { name: 'Updates: Althar 0.10.1, runner-1 and 3 workers' })
    expect(glyph.getAttribute('data-tone')).toBe('offer')
    expect(glyph.className).toMatch(/marked/)
    rerender(<Updates rows={rows({ home: { tone: 'failed' } })} />)
    expect(screen.getByRole('button', { name: 'Updates: runner-1, Althar 0.10.1 and 3 workers' }).getAttribute('data-tone')).toBe('failed')
    rerender(<Updates rows={[]} />)
    expect(container.textContent).toBe('')
  })

  it('opens to a row an update, most urgent first, each with its press, and each put aside on its own', async () => {
    const onHide = vi.fn()
    const restart = vi.fn()
    render(
      <Updates
        rows={rows({ app: { end: { kind: 'press', label: 'Restart', onPress: restart } }, workers: { tone: 'running', hides: false } })}
        onHide={onHide}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /^Updates:/ }))
    const items = within(await screen.findByRole('list')).getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-tone'))).toEqual(['running', 'offer', 'offer'])
    expect(items[1]?.textContent).toContain('Althar 0.10.1 is ready')
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Restart' }))
    expect(restart).toHaveBeenCalledOnce()
    // What runs can't be put aside; what can update can.
    expect(within(items[0]!).queryByRole('button', { name: updatesText.hide })).toBeNull()
    await userEvent.click(within(items[2]!).getByRole('button', { name: updatesText.hide }))
    expect(onHide).toHaveBeenCalledWith('home')
  })

  it('asks first in the row, with Cancel, and says where they still are once none is left', async () => {
    const anyway = vi.fn()
    const cancel = vi.fn()
    const { rerender } = render(
      <Updates
        rows={[
          {
            kind: 'home',
            tone: 'asking',
            title: 'Stop 2 running tasks?',
            who: 'runner-1',
            hides: false,
            end: { kind: 'ask', label: 'Update anyway', onPress: anyway, onCancel: cancel },
          },
        ]}
        open
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Update anyway' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect([anyway.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 1])
    const onShow = vi.fn()
    rerender(<Updates rows={[]} still={{ where: 'Settings › Computers', onShow }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Still in Settings › Computers' }))
    expect(onShow).toHaveBeenCalledOnce()
  })
})
