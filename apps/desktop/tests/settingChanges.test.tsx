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
 * An agent's change to a setting (ADR-097), in its thread: a line of what
 * changed, whose Undo names its item; one that loosens what asks and that no
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
            moves: [
              { key: 'allowEverything', label: 'Allow everything', before: 'off', after: 'on', changes: ['Allow everything: off → on'] },
            ],
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
    expect(document.body.textContent).toContain('Review rounds: 3 → 5')
    expect(document.body.textContent).toContain('Make this change in Meridian › Rules?')
    expect(document.body.textContent).toContain('Allow everything: off → on')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(client.undoSettingChange).toHaveBeenCalledWith('set1')
    expect(screen.getByText('Builds keep stopping to ask.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(client.answerSettingChange).toHaveBeenCalledWith('set2', true)
  })

  it('says what changed in a list, never the list, and folds many changes to a count', async () => {
    const turnedOff = Array.from({ length: 150 }, (_, at) => `anthropic/model-${at}`)
    const { client } = fakeClient({
      getCoordinator: talking(
        items.setting(
          {
            section: 'althar/agents',
            title: 'Agents',
            moves: [
              {
                key: 'turnedOff',
                label: 'Models turned off',
                before: 'none',
                after: turnedOff.join(', ').slice(0, 59),
                changes: ['Turned on Kimi K3.1 Pro in OpenCode'],
              },
            ],
          },
          'set1',
        ),
        items.setting(
          {
            section: 'althar/agents',
            title: 'Agents',
            moves: [
              {
                key: 'turnedOff',
                label: 'Models turned off',
                before: 'none',
                after: 'many',
                changes: ['Turned off GPT-6 Luna in Codex', 'Turned off GPT-6 Sol in Codex', 'Turned on Kimi K3 in OpenCode'],
              },
            ],
          },
          'set2',
        ),
        // A change kept before its lines were words: its raw lists are never shown.
        items.setting(
          {
            section: 'althar/agents',
            title: 'Agents',
            moves: [{ key: 'turnedOff', label: 'Models turned off', before: `{"claude-code":${JSON.stringify(turnedOff)}}`, after: '{}' }],
          },
          'set3',
        ),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('Turned on Kimi K3.1 Pro in OpenCode')).toBeTruthy()
    expect(screen.getByText('3 changes')).toBeTruthy()
    expect(screen.queryByText('Turned off GPT-6 Luna in Codex')).toBeNull()
    expect(screen.getByText('Models turned off changed')).toBeTruthy()
    expect(document.body.textContent).not.toContain('{"claude-code"')
    await userEvent.click(screen.getByRole('button', { name: 'Show all 3' }))
    expect(screen.getByText('Turned off GPT-6 Luna in Codex')).toBeTruthy()
    expect(screen.getByText('Turned on Kimi K3 in OpenCode')).toBeTruthy()
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

  it('shows in Settings what the agent moved, in the same words as its line', async () => {
    const { client } = fakeClient({
      getSettingChanges: vi.fn(async () => [
        {
          section: 'althar/agents',
          key: 'turnedOff',
          label: 'Models turned off',
          by: { kind: 'coordinator' as const, taskId: null, title: null },
          at: new Date().toISOString(),
          threadId: 'th-coordinator',
          changes: ['Turned on Kimi K3.1 Pro in OpenCode', 'Turned off GPT-6 Luna in Codex'],
        },
        {
          section: 'althar/agents',
          key: 'efforts',
          label: 'Default efforts',
          by: { kind: 'coordinator' as const, taskId: null, title: null },
          at: new Date().toISOString(),
          threadId: 'th-coordinator',
          changes: ['Default effort for Claude Opus 5.5: high → xhigh', 'Default effort for GPT-6 Sol: low → high'],
        },
      ]),
    })
    withServices(<ChangedBy projectId={null} section="althar/agents" />, client)
    expect(await screen.findByText('The coordinator changed Models turned off and Default efforts just now.')).toBeTruthy()
    expect(screen.getByText('Turned on Kimi K3.1 Pro in OpenCode')).toBeTruthy()
    expect(screen.queryByText('Default effort for GPT-6 Sol: low → high')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show all 4' }))
    expect(screen.getByText('Default effort for GPT-6 Sol: low → high')).toBeTruthy()
  })
})
