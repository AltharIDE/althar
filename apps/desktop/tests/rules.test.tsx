import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'

import { RulesView } from '../src/renderer/features/rules/RulesView'
import { useRules } from '../src/renderer/features/rules/useRules'
import { agents, fakeClient, projectRules, usual } from './fixtures'
import { withServices } from './render'

function Rules({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <RulesView model={useRules('p1')} onBack={onBack} />
}

describe('a project’s rules', () => {
  it('offers coordinator decisions and saves that mode without disabling the always-ask list', async () => {
    const { client } = fakeClient()
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /The coordinator decides/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', permissions: 'coordinator' }))
    expect(
      (within(screen.getByRole('group', { name: 'Always ask me' })).getByRole('checkbox', { name: 'Force pushes' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
  it('shows them as kept, and saves each change at once', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => ({ ...projectRules, commands: [{ pattern: 'npm publish', decision: 'never' as const }] })),
    })
    withServices(<Rules onBack={onBack} />, client)
    const always = await screen.findByRole('group', { name: 'Always ask me' })
    expect(within(always).getByRole('checkbox', { name: 'Force pushes' })).toBeTruthy()
    const never = screen.getByRole('group', { name: 'Never' })
    expect((within(never).getByRole('checkbox', { name: 'Commands starting “npm publish”' }) as HTMLButtonElement).dataset.state).toBe(
      'checked',
    )

    await userEvent.click(within(always).getByRole('checkbox', { name: 'Force pushes' }))
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        alwaysAsk: ['default-branch', 'many-branches', 'delete-branch', 'deploy', 'outside'],
        commands: [{ pattern: 'npm publish', decision: 'never' }],
        expectedRevision: 1,
      }),
    )
    // Unticking a command the person named takes it away.
    await userEvent.click(within(never).getByRole('checkbox', { name: 'Commands starting “npm publish”' }))
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', never: [], commands: [], expectedRevision: 1 }),
    )

    // The first list's button adds to it.
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a rule' })[0]!)
    await userEvent.type(screen.getByRole('textbox', { name: 'A command, as it starts' }), 'terraform *{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        commands: [{ pattern: 'terraform *', decision: 'ask' }],
        expectedRevision: 1,
      }),
    )

    await userEvent.click(screen.getByRole('radio', { name: /Allow everything/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', permissions: 'allow' }))
    await userEvent.click(screen.getByRole('radio', { name: /Push the branch only/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'none' }))
    await userEvent.click(screen.getByRole('radio', { name: /Wait for the reset/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', usageLimit: 'wait' }))
    // What Althar doesn't do isn't offered.
    expect(screen.queryByRole('radiogroup', { name: 'Review findings' })).toBeNull()
    expect(screen.queryByText(/A card in the thread/)).toBeNull()
    // No agent has more than one account here: no accounts row.
    expect(screen.queryByRole('radiogroup', { name: 'Accounts' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /meridian/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('lists what is always allowed, each rule taken off at once, and adds one by how a command starts', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => ({
        ...projectRules,
        alwaysAllow: ['deploy' as const],
        commands: [
          { pattern: 'git status', decision: 'allow' as const },
          { pattern: 'git status', decision: 'never' as const, match: 'exact' as const },
          { pattern: 'bun test src/a.test.ts', decision: 'allow' as const, match: 'exact' as const },
        ],
      })),
    })
    withServices(<Rules />, client)
    const allowed = await screen.findByRole('list', { name: 'Always allowed' })
    expect(
      within(allowed)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Deploying and publishing', 'Commands starting “git status”', 'Exactly “bun test src/a.test.ts”'])
    // An exact rule for the same words is a rule of its own, in its own list.
    expect(within(screen.getByRole('group', { name: 'Never' })).getByRole('checkbox', { name: 'Exactly “git status”' })).toBeTruthy()

    await userEvent.click(within(allowed).getByRole('button', { name: 'Remove Commands starting “git status”' }))
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        alwaysAllow: ['deploy'],
        commands: [
          { pattern: 'git status', decision: 'never', match: 'exact' },
          { pattern: 'bun test src/a.test.ts', decision: 'allow', match: 'exact' },
        ],
        expectedRevision: 1,
      }),
    )
    await userEvent.click(
      within(screen.getByRole('list', { name: 'Always allowed' })).getByRole('button', { name: 'Remove Deploying and publishing' }),
    )
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith(expect.objectContaining({ alwaysAllow: [] })))

    // The third list's button adds to it.
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a rule' })[2]!)
    await userEvent.type(screen.getByRole('textbox', { name: 'A command, as it starts' }), 'npm test{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ commands: expect.arrayContaining([{ pattern: 'npm test', decision: 'allow' }]) }),
      ),
    )
  })

  it('changes nothing when a command on a list that comes first is added to Always allowed, and says why beside it', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => ({
        ...projectRules,
        commands: [
          { pattern: 'bun test', decision: 'never' as const },
          { pattern: 'npm test', decision: 'ask' as const },
        ],
      })),
    })
    withServices(<Rules />, client)
    await screen.findByRole('group', { name: 'Never' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Add a rule' })[2]!)
    const field = screen.getByRole('textbox', { name: 'A command, as it starts' })
    await userEvent.type(field, 'bun test{Enter}')
    expect(screen.getByRole('alert').textContent).toBe(
      '“bun test” is on “Never”, which comes first, so nothing changed. Take it off “Never” first.',
    )
    await userEvent.clear(field)
    await userEvent.type(field, 'npm  test{Enter}')
    expect(screen.getByRole('alert').textContent).toContain('is on “Always ask me”, which comes first')
    expect(client.setProjectRules).not.toHaveBeenCalled()
    // Any other command is added.
    await userEvent.clear(field)
    await userEvent.type(field, 'cargo build{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ commands: expect.arrayContaining([{ pattern: 'cargo build', decision: 'allow' }]) }),
      ),
    )
  })

  it('names the revision it read when it changes a list, and reads the rules again when they had moved on', async () => {
    const getProjectRules = vi.fn(async () => ({ ...projectRules, revision: 3 }))
    const { client } = fakeClient({ getProjectRules })
    vi.mocked(client.setProjectRules).mockRejectedValueOnce(
      new ApiError({ reason: 'RulesChanged', message: "The project's rules changed meanwhile, so that change wasn't made." }),
    )
    withServices(<Rules />, client)
    const always = await screen.findByRole('group', { name: 'Always ask me' })
    await userEvent.click(within(always).getByRole('checkbox', { name: 'Force pushes' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3 })))
    expect(await screen.findByText("The project's rules changed meanwhile, so that change wasn't made.")).toBeTruthy()
    await waitFor(() => expect(getProjectRules.mock.calls.length).toBeGreaterThan(1))
    // A change of one setting alone replaces no list, so it names none.
    await userEvent.click(screen.getByRole('radio', { name: /Push the branch only/ }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'none' }))
  })

  it('sends quick changes one after another, each against the rules the last one left', async () => {
    let revision = 3
    const { client } = fakeClient({ getProjectRules: vi.fn(async () => ({ ...projectRules, revision })) })
    vi.mocked(client.setProjectRules).mockImplementation(async ({ projectId, expectedRevision, ...change }) => {
      // Each names the rules as they stand when it arrives, the last one's included.
      expect(expectedRevision).toBe(revision)
      await new Promise((resolve) => setTimeout(resolve, 30))
      revision += 1
      return { ...projectRules, ...change, projectId, revision }
    })
    withServices(<Rules />, client)
    const always = await screen.findByRole('group', { name: 'Always ask me' })
    await userEvent.click(within(always).getByRole('checkbox', { name: 'Force pushes' }))
    await userEvent.click(within(always).getByRole('checkbox', { name: 'Deploying and publishing' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledTimes(2))
    expect(vi.mocked(client.setProjectRules).mock.calls.map(([change]) => change.expectedRevision)).toEqual([3, 4])
    expect(vi.mocked(client.setProjectRules).mock.calls[1]?.[0].alwaysAsk).toEqual([
      'default-branch',
      'many-branches',
      'delete-branch',
      'outside',
    ])
  })

  it('says nothing is always allowed yet, and how a rule gets there', async () => {
    withServices(<Rules />, fakeClient().client)
    expect(await screen.findByText(/Nothing yet\. A permission answered with “always allow” adds its rule here\./)).toBeTruthy()
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

  it('says where names come from, saves a pattern Althar can follow, and says why it can’t follow one', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => ({
        ...projectRules,
        conventions: [
          {
            repository: 'api',
            branch: { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' },
            title: null,
            template: '.github/pull_request_template.md',
          },
        ],
      })),
    })
    withServices(<Rules />, client)
    expect(await screen.findByText('CONTRIBUTING.md says feature/{key}-{slug}')).toBeTruthy()
    expect(screen.getByText('.github/pull_request_template.md, filled in by the lead')).toBeTruthy()
    const branches = screen.getByRole('textbox', { name: 'Branch names' })
    await userEvent.type(branches, 'feature/{{key}{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('needs {slug}')
    expect(client.setProjectRules).not.toHaveBeenCalled()
    await userEvent.type(branches, '-{{slug}{Enter}')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', branchPattern: 'feature/{key}-{slug}' }))
    expect(screen.queryByRole('alert')).toBeNull()
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
