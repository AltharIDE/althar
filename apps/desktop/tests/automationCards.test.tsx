import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type CoordinatorSnapshot } from '@althar/contracts'
import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import {
  automationsSnapshot,
  automationSummary,
  automationView,
  changed,
  coordinatorSnapshot,
  definition,
  fakeClient,
  items,
} from './fixtures'
import { useSettingsOf, withServices } from './render'

/* On this Mac's clock: Tuesday 29 September 2026, at noon. */
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 8, day, hours, minutes).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 29, 12, 0) })
})
afterEach(() => {
  vi.useRealTimers()
})

function Project({
  room,
  onRoomChange,
  onAutomationChange,
}: {
  room?: Room
  onRoomChange?: (room: Room) => void
  onAutomationChange?: (automation: string | null) => void
}) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      {...(room === undefined ? {} : { room })}
      {...(onRoomChange === undefined ? {} : { onRoomChange })}
      {...(onAutomationChange === undefined ? {} : { onAutomationChange })}
    />
  )
}

/** The coordinator's thread with these automation cards in it. */
const talking = (...cards: CoordinatorSnapshot['items']) => vi.fn(async () => coordinatorSnapshot({ items: cards }))

describe('an automation’s card in the coordinator’s thread', () => {
  it('proposed: the whole card, changed there, its limits folded out, tried once, and turned on, by the card’s item', async () => {
    const { client } = fakeClient({ getCoordinator: talking(items.automation({}, 'ia1')) })
    withServices(<Project />, client)
    expect(await screen.findByText('Automation · meridian')).toBeTruthy()
    expect(screen.getByText('Morning review')).toBeTruthy()
    expect(screen.getByText('Nothing runs until you turn it on.')).toBeTruthy()
    // When it would first run, from its schedule, as nothing has said yet.
    expect(screen.getByText('next tomorrow at 9:00')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Its limits' }))
    expect(screen.getByText('45 minutes')).toBeTruthy()
    expect(screen.getByText('Run once when it’s back, if it’s not too late')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Every weekday at 9:00/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Every day at 9:00' }))
    expect(client.changeAutomation).toHaveBeenCalledWith(
      'auto1',
      definition({ schedule: { every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '09:00' } }),
    )
    // Shown at once.
    expect(await screen.findByRole('button', { name: /Every day at 9:00/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try it once now' }))
    expect(client.runAutomationNow).toHaveBeenCalledWith('auto1', 'ia1')
  })

  it('turns a proposed one on by its item, and stays pressed until the card comes back', async () => {
    const { client } = fakeClient({ getCoordinator: talking(items.automation({}, 'ia1')) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1', 'ia1')
    expect(screen.getByRole('button', { name: 'Turn on' }).getAttribute('aria-busy')).toBe('true')
  })

  it('on: folded to one line, opening it in Automations, and turned off there', async () => {
    const onRoomChange = vi.fn()
    const onAutomationChange = vi.fn()
    const { client } = fakeClient({
      getCoordinator: talking(items.automation({ state: 'on', nextAt: local(30, 9) }, 'ia1')),
      getAutomations: vi.fn(async () => automationsSnapshot()),
      getAutomation: vi.fn(async () => ({ cursor: 6, automation: automationView({ nextAt: local(30, 9) }) })),
    })
    withServices(<Project onRoomChange={onRoomChange} onAutomationChange={onAutomationChange} />, client)
    expect(await screen.findByText('is on. It runs next tomorrow at 9:00.')).toBeTruthy()
    expect(screen.queryByText('Nothing runs until you turn it on.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(client.pauseAutomation).toHaveBeenCalledWith('auto1')
    await userEvent.click(screen.getByRole('button', { name: 'Open in Automations' }))
    await waitFor(() => expect(onRoomChange).toHaveBeenLastCalledWith(Room.Automations))
    expect(onAutomationChange).toHaveBeenLastCalledWith('auto1')
    expect(await screen.findByRole('heading', { name: 'Morning review' })).toBeTruthy()
    expect(screen.getByText('Runs next tomorrow at 9:00')).toBeTruthy()
  })

  it('paused: folded, turned on again', async () => {
    const { client } = fakeClient({ getCoordinator: talking(items.automation({ state: 'paused' }, 'ia1')) })
    withServices(<Project />, client)
    expect(await screen.findByText('is paused.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1', 'ia1')
  })

  it('changed by the coordinator while on: what it was, struck through, holding from its next run, undone by its item', async () => {
    const was = definition({
      schedule: { every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '02:00' },
      lead: { agentId: 'codex', model: null, effort: null },
    })
    const { client } = fakeClient({
      getCoordinator: talking(
        items.automation(
          { state: 'on', nextAt: local(30, 9), was, definition: definition({ work: { kind: 'task', review: null, end: 'ready' } }) },
          'ia2',
        ),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('Automation, changed · meridian')).toBeTruthy()
    expect(screen.getByText('Every night at 2:00').closest('s')).not.toBeNull()
    expect(screen.getByText('Holds from its next run, tomorrow at 9:00.')).toBeTruthy()
    // Nothing on it changes but by Undo.
    expect(screen.queryByRole('button', { name: /Every weekday at 9:00/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(client.undoAutomationChange).toHaveBeenCalledWith('ia2')
    await userEvent.click(screen.getByRole('button', { name: 'Open in Automations' }))
    expect(await screen.findByRole('heading', { name: 'Morning review' })).toBeTruthy()
  })

  it('says who led it and who reviewed it before, as it was, and its lead as it is now', async () => {
    const was = definition({ lead: { agentId: 'codex', model: null, effort: null }, work: { kind: 'task', review: null, end: null } })
    const now = definition({ work: { kind: 'task', review: { agentId: 'codex', model: null, effort: null }, end: null } })
    const { client } = fakeClient({ getCoordinator: talking(items.automation({ state: 'on', was, definition: now }, 'ia9')) })
    withServices(<Project />, client)
    await screen.findByText('Automation, changed · meridian')
    const struck = Array.from(document.querySelectorAll('s'), (old) => old.textContent)
    expect(struck).toEqual(expect.arrayContaining([expect.stringMatching(/Codex|gpt/), 'was None']))
    // Without a next run known, it holds from its next run, whenever that is.
    expect(screen.getByText('Holds from its next run.')).toBeTruthy()
  })

  it('changed in a way it didn’t make: runs again once turned on, or is undone', async () => {
    const was = definition({ work: { kind: 'task', review: { agentId: 'codex', model: null, effort: null }, end: null } })
    const { client } = fakeClient({
      getCoordinator: talking(
        items.automation({ state: 'proposed', was, definition: definition({ work: { kind: 'task', review: null, end: 'draft' } }) }, 'ia3'),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('It runs again once you turn it on.')).toBeTruthy()
    expect(screen.getByText('Nothing leaves this Mac').closest('s')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1', 'ia3')
  })

  it('asks to resume it or run it now: one button, by its item, and once done a line', async () => {
    const { client } = fakeClient({
      getCoordinator: talking(
        items.automation({ state: 'paused', ask: { what: 'resume', done: false } }, 'ia4'),
        items.automation({ automationId: 'auto2', state: 'on', ask: { what: 'run', done: false } }, 'ia5'),
        items.automation({ automationId: 'auto3', state: 'on', ask: { what: 'resume', done: true } }, 'ia6'),
        items.automation({ automationId: 'auto4', state: 'on', ask: { what: 'run', done: true } }, 'ia7'),
      ),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1', 'ia4')
    await userEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(client.runAutomationNow).toHaveBeenCalledWith('auto2', 'ia5')
    expect(screen.getByText('Resumed.')).toBeTruthy()
    expect(screen.getByText('Started a run.')).toBeTruthy()
    expect(screen.getAllByText('Morning review · Every weekday at 9:00')).toHaveLength(2)
  })

  it('deleted: a line saying so', async () => {
    const { client } = fakeClient({ getCoordinator: talking(items.automation({ state: 'deleted' }, 'ia8')) })
    withServices(<Project />, client)
    expect(await screen.findByText('was deleted.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open in Automations' })).toBeNull()
  })

  it('says under the card what couldn’t be done, and lets it be pressed again', async () => {
    const { client } = fakeClient({
      getCoordinator: talking(items.automation({}, 'ia1')),
      turnOnAutomation: vi.fn(async () => {
        throw new ApiError({ reason: 'Busy', message: 'Its lead isn’t signed in.' })
      }),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That didn’t go through. Its lead isn’t signed in.')
    expect(screen.getByRole('button', { name: 'Turn on' }).getAttribute('aria-busy')).toBeNull()
  })

  it('reads its cards again as one of the project’s automations changes or runs', async () => {
    const card = items.automation({}, 'ia1')
    const getThreadItem = vi.fn(async () => ({ ...card, content: { ...(card.content as object), state: 'on' } }) as typeof card)
    const { client, emit } = fakeClient({ getCoordinator: talking(card), getThreadItem })
    withServices(<Project />, client)
    await screen.findByText('Nothing runs until you turn it on.')
    act(() => emit(changed('automation', 'auto1', null)))
    await waitFor(() => expect(getThreadItem).toHaveBeenCalledWith('thc', 'ia1'))
    expect(await screen.findByText(/^is on\./)).toBeTruthy()
    getThreadItem.mockClear()
    // Another project's automation moves nothing here.
    act(() => emit(changed('automation_occurrence', 'occ1', null, 'p2')))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(getThreadItem).not.toHaveBeenCalled()
  })
})

describe('the project’s Automations view', () => {
  it('has a violet dot in the bar while one of them paused itself, and none otherwise', async () => {
    const getAutomations = vi.fn(async () =>
      automationsSnapshot({
        automations: [automationSummary({ state: 'paused', pausedBy: 'itself', pauseReason: 'Failed three times.' })],
      }),
    )
    const { client, emit } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()), getAutomations })
    withServices(<Project />, client)
    const views = await screen.findByRole('radiogroup', { name: 'View' })
    expect(await within(views).findByRole('radio', { name: 'Automations, needs you' })).toBeTruthy()
    // Turned back on, the feed says so, and the dot goes.
    getAutomations.mockResolvedValue(automationsSnapshot())
    act(() => emit(changed('automation', 'auto1', null)))
    expect(await within(views).findByRole('radio', { name: 'Automations' })).toBeTruthy()
  })

  it('shows its tab in the views’ place, under the front page, and its page as the address asks', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot()),
      getAutomations: vi.fn(async () => automationsSnapshot()),
    })
    withServices(<Project room={Room.Automations} />, client)
    expect(await screen.findByRole('heading', { name: 'Automations' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'meridian' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Tell the coordinator/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Morning review' }))
    expect(await screen.findByText('What it does')).toBeTruthy()
    // b steps back to the conversation.
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('b')
    expect(await screen.findByRole('textbox', { name: /Tell the coordinator/ })).toBeTruthy()
  })
})
