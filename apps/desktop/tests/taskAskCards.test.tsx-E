import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CoordinatorSnapshot } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { coordinatorSnapshot, fakeClient, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * The coordinator's card asking the person to stop, hold, restart or settle a
 * task (ADR-086), in its thread: its button answers it by its item, Not now
 * too, and its title opens the task; answered, it is one line.
 */

function Project({ onTask }: { onTask: (threadId: string) => void }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={onTask}
    />
  )
}

const talking = (...cards: CoordinatorSnapshot['items']) => vi.fn(async () => coordinatorSnapshot({ items: cards }))

describe('the coordinator’s card asking to move a task on', () => {
  it('stops it by the card’s item, says not now, and opens the task from its title', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ getCoordinator: talking(items.taskAsk({}, 'ask1')) })
    withServices(<Project onTask={onTask} />, client)
    expect(await screen.findByText('Its pull request was closed.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open Review the importer' }))
    expect(onTask).toHaveBeenCalledWith('th-task1')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(client.answerTaskAsk).toHaveBeenCalledWith('ask1', true)
  })

  it('answered, is one line saying what became of it', async () => {
    const { client } = fakeClient({
      getCoordinator: talking(
        items.taskAsk({ state: 'done', move: 'discard' }, 'ask1'),
        items.taskAsk({ state: 'moot', said: 'review-the-importer isn’t running: there is nothing to stop.' }, 'ask2'),
      ),
    })
    withServices(<Project onTask={vi.fn()} />, client)
    expect(await screen.findByText('Discarded.')).toBeTruthy()
    expect(screen.getByText('review-the-importer isn’t running: there is nothing to stop.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })
})
