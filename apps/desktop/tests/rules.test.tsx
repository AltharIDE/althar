import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@charrette/contracts'

import { RulesView } from '../src/renderer/features/rules/RulesView'
import { useRules } from '../src/renderer/features/rules/useRules'
import { agents, fakeClient, projectRules, usual } from './fixtures'
import { withServices } from './render'

function Rules({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <RulesView model={useRules('p1')} onBack={onBack} />
}

describe('a project’s rules', () => {
  it('shows them as kept, and saves each change at once', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => ({ ...projectRules, commands: [{ pattern: 'npm publish', decision: 'never' as const }] })),
    })
    withServices(<Rules onBack={onBack} />, client)
    const always = await screen.findByRole('group', { name: 'Always ask me' })
    expect(within(always).getByRole('checkbox', { name: 'Force pushes' })).toBeTruthy()
    const never = screen.getByRole('group', { name: 'Never' })
    expect((within(never).getByRole('checkbox', { name: 'Running npm publish' }) as HTMLButtonElement).dataset.state).toBe('checked')

    await userEvent.click(within(always).getByRole('checkbox', { name: 'Force pushes' }))
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        alwaysAsk: ['default-branch', 'many-branches', 'delete-branch', 'deploy', 'outside'],
        commands: [{ pattern: 'npm publish', decision: 'never' }],
      }),
    )
    // Unticking a command the person named takes it away.
    await userEvent.click(within(never).getByRole('checkbox', { name: 'Running npm publish' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', never: [], commands: [] }))

    // The first list's button adds to it.
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a rule' })[0]!)
    await userEvent.type(screen.getByRole('textbox', { name: 'A command, as it starts' }), 'terraform *{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', commands: [{ pattern: 'terraform *', decision: 'ask' }] }),
    )

    await userEvent.click(screen.getByRole('radio', { name: /Allow everything/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', permissions: 'allow' }))
    await userEvent.click(screen.getByRole('radio', { name: /Push the branch only/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'none' }))
    await userEvent.click(screen.getByRole('radio', { name: /Wait for the reset/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', usageLimit: 'wait' }))
    // What Charrette doesn't do isn't offered.
    expect(screen.queryByRole('radiogroup', { name: 'Review findings' })).toBeNull()
    expect(screen.queryByText(/A card in the thread/)).toBeNull()
    // No agent has more than one account here: no accounts row.
    expect(screen.queryByRole('radiogroup', { name: 'Accounts' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /meridian/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('offers the accounts of an agent with more than one: which run work here, and whether work moves on to the next', async () => {
    const codex = agents[1] ?? agents[0]!
    const { client } = fakeClient({
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: [{ ...codex, accounts: [usual('acc_main', 'signed_in'), { ...usual('acc_work', 'signed_in'), name: 'work', home: '/w' }] }],
      })),
    })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /The next account/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', rotateAccounts: true }))
    const allowed = screen.getByRole('group', { name: 'Codex accounts this project may use' })
    await userEvent.click(within(allowed).getByRole('checkbox', { name: 'main' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', onlyAccounts: { codex: ['acc_work'] } }))
    // Every account again is no limit at all.
    await userEvent.click(within(allowed).getByRole('checkbox', { name: 'main' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', onlyAccounts: null }))
  })

  it('says what went wrong saving', async () => {
    const { client } = fakeClient({
      setProjectRules: vi.fn(async () => Promise.reject(new ApiError({ reason: 'SqlError', message: 'The disk is full.' }))),
    })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Ask me/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('disk is full')
  })
})
