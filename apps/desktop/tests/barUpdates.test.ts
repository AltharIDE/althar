import { describe, expect, it, vi } from 'vitest'

import type { HomeWorker } from '@althar/contracts'
import { fleetUpdate, WORKER_UPDATE_COMMAND } from '@althar/ui'

import { appRow, homeRow, workersRow } from '../src/renderer/features/updates/rows'
import { updateText, updating, updatingWorkersOf, workerUpdateOf } from '../src/renderer/shared/workerUpdates'

/*
 * The bar's Updates, worked out: each worker's update from what its home
 * says and the newest worker release; then a row each, for Althar's own
 * update, the window's home's and its workers'.
 */

const worker = (more: Partial<HomeWorker> = {}): HomeWorker => ({
  workerId: 'wrk_hermes',
  name: 'hermes-box',
  connected: true,
  busy: false,
  providers: ['codex'],
  projects: [],
  task: null,
  release: '0.2.2',
  updatesOnRequest: true,
  ...more,
})
const task = { taskId: 'task_1', threadId: 'thr_1', title: 'Repair token refresh', project: 'Meridian' }

describe('a worker’s update', () => {
  it('is offered where its release is older than the newest, and only where its home can ask it', () => {
    expect(workerUpdateOf(worker(), '0.3.0')).toEqual({ state: 'offer', to: '0.3.0', from: '0.2.2' })
    expect(workerUpdateOf(worker({ updatesOnRequest: undefined }), '0.3.0')).toEqual({ state: 'byItself', to: '0.3.0' })
    expect(workerUpdateOf(worker({ release: '0.3.0' }), '0.3.0')).toBeUndefined()
    expect(workerUpdateOf(worker({ release: '0.10.0' }), '0.9.9')).toBeUndefined()
    // Not knowing either release, nothing is said.
    expect(workerUpdateOf(worker(), null)).toBeUndefined()
    expect(workerUpdateOf(worker({ release: undefined }), '0.3.0')).toBeUndefined()
  })

  it('follows what its home says of an update asked for', () => {
    expect(workerUpdateOf(worker({ update: { state: 'asked' } }), '0.3.0')).toEqual({ state: 'running', to: '0.3.0', step: 'getting' })
    expect(workerUpdateOf(worker({ busy: true, task, update: { state: 'asked' } }), '0.3.0')).toEqual({ state: 'afterTask', to: '0.3.0' })
    expect(workerUpdateOf(worker({ connected: false, update: { state: 'asked' } }), '0.3.0')).toEqual({ state: 'whenOnline', to: '0.3.0' })
    // Its updater restarts it: gone from its home meanwhile.
    expect(workerUpdateOf(worker({ connected: false, update: { state: 'started' } }), '0.3.0')).toEqual({
      state: 'running',
      to: '0.3.0',
      step: 'restarting',
    })
    expect(workerUpdateOf(worker({ release: '0.3.0', update: { state: 'done', version: '0.3.0' } }), '0.3.0')).toEqual({
      state: 'done',
      version: '0.3.0',
    })
    expect(workerUpdateOf(worker({ update: { state: 'failed', message: 'No room' } }), '0.3.0')).toEqual({
      state: 'failed',
      to: '0.3.0',
      message: 'No room',
    })
    // Its updater found nothing newer while the window knows of one: said, as it can't be helped from here.
    expect(workerUpdateOf(worker({ update: { state: 'current' } }), '0.3.0')).toEqual({
      state: 'failed',
      to: '0.3.0',
      message: updateText.noneNewer,
    })
    expect(workerUpdateOf(worker({ release: '0.3.0', update: { state: 'current' } }), '0.3.0')).toBeUndefined()
    // Refused by its home: why, until it's asked again.
    expect(workerUpdateOf(worker(), '0.3.0', 'It can’t be asked')).toEqual({ state: 'failed', to: '0.3.0', message: 'It can’t be asked' })
  })

  it('is watched closely only while one is asked for or under way', () => {
    expect(updating({ enabled: true, workers: [worker()] })).toBe(false)
    expect(updating({ enabled: true, workers: [worker({ update: { state: 'started' } })] })).toBe(true)
    expect(updating(null)).toBe(false)
    expect(updatingWorkersOf({ enabled: true, workers: [worker({ busy: true, task })] }, '0.3.0', new Map())).toEqual([
      {
        id: 'wrk_hermes',
        name: 'hermes-box',
        task: { title: 'Repair token refresh' },
        update: { state: 'offer', to: '0.3.0', from: '0.2.2' },
      },
    ])
  })
})

describe('the rows', () => {
  it('say Althar’s own update as its line did: Restart while nothing runs, else at quitting; restarting; why it didn’t', () => {
    const onRestart = vi.fn()
    expect(appRow(null)).toBeNull()
    expect(appRow({ version: '0.10.1', onRestart })).toMatchObject({
      kind: 'app',
      tone: 'offer',
      title: 'Althar 0.10.1 is ready',
      who: 'Althar 0.10.1',
      end: { kind: 'press', label: 'Restart', onPress: onRestart },
      hides: true,
    })
    expect(appRow({ version: '0.10.1' })).toMatchObject({ tone: 'quiet', line: 'Installs when you quit, as tasks are running here.' })
    expect(appRow({ version: '0.10.1', onRestart, restarting: true })).toMatchObject({ tone: 'running', hides: false })
    expect(appRow({ version: '0.10.1', onRestart, error: 'No room' })).toMatchObject({
      tone: 'failed',
      title: 'Couldn’t restart into Althar 0.10.1',
      line: 'No room',
      end: { kind: 'press', label: 'Try again' },
    })
  })

  it('say the window’s home’s update as Settings runs it, asking first where its restart stops tasks', () => {
    const onUpdate = vi.fn()
    const onAsk = vi.fn()
    const base = { name: 'runner-1', newest: '0.3.0', onUpdate, onCancelUpdate: vi.fn(), asking: false, onAsk }
    // Nothing newer, or still being looked for: no row.
    expect(homeRow({ ...base, offer: { command: 'x', release: 'unreleased' } })).toBeNull()
    expect(homeRow({ ...base, newest: null, offer: { command: 'x', run: { state: 'idle' } } })).toBeNull()
    expect(homeRow({ ...base, offer: { command: 'x', run: { state: 'idle' } } })).toMatchObject({
      tone: 'offer',
      title: 'runner-1 can update to 0.3.0',
      line: 'runner-1 restarts once, in a minute or two.',
      end: { kind: 'press', label: 'Update', onPress: onUpdate },
    })
    // Its restart stops two tasks: the press asks first, in the row.
    const busy = homeRow({ ...base, offer: { command: 'x', run: { state: 'idle', busy: 2 } } })
    expect(busy).toMatchObject({ line: '2 tasks are running on runner-1. They stop while it restarts.' })
    if (busy?.end?.kind !== 'press') throw new Error('expected a press')
    busy.end.onPress()
    expect(onAsk).toHaveBeenCalledWith(true)
    const asking = homeRow({ ...base, asking: true, offer: { command: 'x', run: { state: 'idle', busy: 2 } } })
    expect(asking).toMatchObject({ tone: 'asking', title: 'Stop 2 running tasks?', end: { kind: 'ask', label: 'Update anyway' } })
    if (asking?.end?.kind !== 'ask') throw new Error('expected asking')
    asking.end.onPress()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(homeRow({ ...base, offer: { command: 'x', run: { state: 'running', step: 'restarting' } } })).toMatchObject({
      tone: 'running',
      line: 'Restarting runner-1',
      end: { kind: 'steps', at: 1 },
      hides: false,
    })
    expect(homeRow({ ...base, offer: { command: 'x', run: { state: 'failed', problem: 'It dropped' } } })).toMatchObject({
      tone: 'failed',
      line: 'It dropped',
    })
    // Where the window can't run it: its command, to copy.
    expect(homeRow({ ...base, offer: { command: 'update-it' } })).toMatchObject({ end: { kind: 'copy', command: 'update-it' } })
  })

  it('say the workers’ update as Computers does, asking the ones it names', () => {
    const onUpdate = vi.fn()
    const offer = fleetUpdate([
      { id: 'a', name: 'a', update: { state: 'offer', to: '0.3.0' } },
      { id: 'b', name: 'b', update: { state: 'offer', to: '0.3.0' } },
    ])
    const row = workersRow(offer, 2, onUpdate, vi.fn())
    expect(row).toMatchObject({ kind: 'workers', tone: 'offer', title: '2 workers can update to 0.3.0', who: '2 workers', hides: true })
    if (row?.end?.kind !== 'press') throw new Error('expected a press')
    row.end.onPress()
    expect(onUpdate).toHaveBeenCalledWith(['a', 'b'])
    expect(
      workersRow(fleetUpdate([{ id: 'a', name: 'a', update: { state: 'byItself', to: '0.3.0' } }]), 1, onUpdate, vi.fn()),
    ).toMatchObject({
      tone: 'quiet',
      who: 'a',
      end: { kind: 'copy', command: WORKER_UPDATE_COMMAND },
    })
    expect(
      workersRow(fleetUpdate([{ id: 'a', name: 'a', update: { state: 'running', to: '0.3.0', step: 'getting' } }]), 1, onUpdate, vi.fn()),
    ).toMatchObject({ tone: 'running', end: { kind: 'steps', at: 0 }, hides: false })
    expect(workersRow(null, 0, onUpdate, vi.fn())).toBeNull()
  })
})
