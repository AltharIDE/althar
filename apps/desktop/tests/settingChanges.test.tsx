import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CoordinatorSnapshot } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { ChangedBy } from '../src/renderer/features/settings/ChangedBy'
import { coordinatorSnapshot, fakeClient, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * An agent's change to a setting (ADR-097), in its thread: a line, before and
 * after, whose Undo names its item; one that loosens what asks and that no
 * message of the person's asked for is a card whose Change makes it. Settings
 * says which agent changed a section's settings last.
 */

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

const talking = (...cards: CoordinatorSnapshot['items']) => vi.fn(async () => coordinatorSnapshot({ items: cards }))

describe('an agent’s change to a setting', () => {
  it('is a line with Undo, and a card the person presses where it loosens what asks', async () => {
    const { client } = fakeClient({
      getCoordinator: talking(
        items.setting({}, 'set1'),
        items.setting(
          {
            changeId: null,
            section: 'project/rules',
            title: 'Rules',
            project: 'Meridian',
            moves: [{ key: 'allowEverything', label: 'Allow everything', before: 'off', after: 'on' }],
            loosens: true,
            why: 'Builds keep stopping to ask.',
            state: 'asked',
          },
          'set2',
        ),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('Settings › Plans and reviews')).toBeTruthy()
    expect(document.body.textContent).toContain('Review rounds 3 → 5')
    expect(document.body.textContent).toContain('Change Allow everything off → on in Meridian › Rules?')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(client.undoSettingChange).toHaveBeenCalledWith('set1')
    expect(screen.getByText('Builds keep stopping to ask.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(client.answerSettingChange).toHaveBeenCalledWith('set2', true)
  })

  it('shows in Settings, named for the agent that made it', async () => {
    const { client } = fakeClient({
      getSettingChanges: vi.fn(async () => [
        {
          section: 'althar/plans-and-reviews',
          key: 'rounds',
          label: 'Review rounds',
          by: { kind: 'lead' as const, taskId: 'task1', title: 'Review the importer' },
          at: new Date().toISOString(),
          threadId: 'th-task1',
        },
      ]),
    })
    withServices(<ChangedBy projectId={null} section="althar/plans-and-reviews" />, client)
    expect(await screen.findByText('The lead of “Review the importer” changed Review rounds just now.')).toBeTruthy()
  })
})
