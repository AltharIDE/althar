import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectRulesView } from '@althar/contracts'

import { RulesSection } from '../src/renderer/features/rules/RulesSection'
import { useRules, withChange } from '../src/renderer/features/rules/useRules'
import { agents, changed, fakeClient, projectRules, usual } from './fixtures'
import { withServices } from './render'

/** The rules, as their section of the project's settings has them: named by the page around them, so with no title of their own. */
function Rules() {
  return <RulesSection model={useRules('p1')} />
}

const rulesOf = (rules: Partial<ProjectRulesView>) => vi.fn(async () => ({ ...projectRules, ...rules }))

/** One sentence of the rules, by its word in the margin. */
const sentence = (label: string) => screen.getByRole('listitem', { name: label })

/** What a sentence says, without its word in the margin. */
const says = (label: string) => sentence(label).querySelector('p')?.textContent

/** Opens a built-in word's menu and picks what it should be. */
const choose = async (word: HTMLElement, option: string) => {
  await userEvent.click(word)
  await userEvent.click(await screen.findByRole('menuitemradio', { name: option }))
}

describe('a project’s rules', () => {
  it('reads as sentences in the order a request meets them, each kind of request in one', async () => {
    const { client } = fakeClient({
      getProjectRules: rulesOf({
        // On two lists, as an older screen could leave it: Never comes first, so it reads there alone.
        never: ['force-push'],
        alwaysAsk: ['force-push', 'deploy'],
        alwaysAllow: ['outside'],
        commands: [
          { pattern: 'npm publish', decision: 'never' },
          { pattern: 'psql', decision: 'ask' },
          { pattern: 'bun test', decision: 'allow' },
          { pattern: 'pnpm replay --env staging refunds', decision: 'allow', match: 'exact' },
        ],
      }),
    })
    withServices(<Rules />, client)
    await screen.findByRole('heading', { name: 'Always', level: 3 })
    expect(screen.queryByRole('heading', { name: 'Rules' })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Always',
      'Never',
      'Ask me',
      'Go ahead',
      'The rest',
      'Sandbox',
      'Finished',
      'Limits',
    ])
    expect(says('Never')).toBe('Agents never force push, and never run npm publish.')
    expect(says('Ask me')).toBe('They ask you before deploying or publishing, and before running psql.')
    expect(says('Go ahead')).toBe('They go ahead with writing outside the task, bun test and exactly pnpm replay --env staging refunds.')
    expect(says('The rest')).toBe(
      'Everything else, like pushing to the default branch, pushing several branches or tags and deleting other branches: allowed. What Althar can’t read comes to you.',
    )
    expect(says('Finished')).toBe(
      'A finished task opens a draft pull request, on a branch named althar/MER-128-fix-login and titled Fix login, described in Althar’s own words.',
    )
  })

  it('moves a kind to one sentence, writing it on one list and off the others, against the revision it read', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ never: ['deploy'], alwaysAllow: ['deploy'] }) })
    withServices(<Rules />, client)
    await choose(
      await within(await screen.findByRole('listitem', { name: 'Ask me' })).findByRole('button', { name: 'force pushing' }),
      'Never',
    )
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        never: ['force-push', 'deploy'],
        alwaysAsk: ['default-branch', 'many-branches', 'delete-branch', 'outside'],
        alwaysAllow: [],
        expectedRevision: 1,
      }),
    )
    // Focus goes with the word to its sentence.
    await waitFor(() => expect(document.activeElement).toBe(within(sentence('Never')).getByRole('button', { name: 'force push' })))
    // With the rest: on no list.
    await choose(within(sentence('Ask me')).getByRole('button', { name: 'writing outside the task' }), 'The rest')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ alwaysAsk: ['default-branch', 'many-branches', 'delete-branch'], never: ['force-push', 'deploy'] }),
      ),
    )
  })

  it('changes what happens to the rest, and says while everything is allowed that what asks, goes ahead and the rest is off', async () => {
    const { client } = fakeClient()
    withServices(<Rules />, client)
    await choose(
      await within(await screen.findByRole('listitem', { name: 'The rest' })).findByRole('button', { name: 'allowed' }),
      'The coordinator decides',
    )
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', permissions: 'coordinator' }))
    expect(says('The rest')).toContain('the coordinator decides. What it can’t settle, and what Althar can’t read, comes to you.')
    expect(screen.queryByText('Off while everything is allowed.')).toBeNull()
    // Allowing everything is the switch over the sentences, not what the rest gets.
    await userEvent.click(screen.getByRole('switch', { name: 'Allow everything' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', allowEverything: true }))
    expect(screen.getAllByText('Off while everything is allowed.')).toHaveLength(3)
  })

  it('says what leads run outside their sandbox and the hosts they reach, and that hosts wait while the rest asks', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({}) })
    withServices(<Rules />, client)
    await screen.findByRole('heading', { name: 'Sandbox', level: 3 })
    expect(says('Sandbox')).toBe(
      'Leads run bunx playwright, node scripts/e2e.ts, ps and env -i outside their sandbox from the start. They reach github.com and registry.npmjs.org without asking. Each command still meets these rules.',
    )
    await choose(screen.getByRole('button', { name: 'allowed' }), 'Ask me')
    await waitFor(() => expect(says('Sandbox')).toContain('registry.npmjs.org without asking, once everything else is allowed.'))
  })

  it('adds a host by its name and takes a command out, each kept as the person’s edit against the revision it read', async () => {
    let kept: ProjectRulesView = { ...projectRules, revision: 4 }
    const { client } = fakeClient({ getProjectRules: vi.fn(async () => kept) })
    vi.mocked(client.setProjectRules).mockImplementation(async ({ projectId, expectedRevision, ...change }) => {
      expect(expectedRevision).toBe(kept.revision)
      kept = { ...withChange(kept, change), projectId, revision: kept.revision + 1 }
      return kept
    })
    withServices(<Rules />, client)
    await screen.findByRole('heading', { name: 'Sandbox', level: 3 })
    await userEvent.click(screen.getByRole('button', { name: 'Add a host leads reach without asking' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'A host' }), 'not a host{Enter}')
    expect(screen.getByRole('textbox', { name: 'A host', description: /isn’t a host/ })).toBeTruthy()
    await userEvent.clear(screen.getByRole('textbox', { name: 'A host' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'A host' }), '*.example.com{Enter}')
    expect(screen.getByRole('textbox', { name: 'A host', description: /Name each host on its own/ })).toBeTruthy()
    expect(client.setProjectRules).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByRole('textbox', { name: 'A host' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'A host' }), 'HTTPS://PyPI.org/simple{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        sandbox: { hosts: { added: ['pypi.org'], removed: [] } },
        expectedRevision: 4,
      }),
    )
    await waitFor(() => expect(within(sentence('Sandbox')).getByText('pypi.org')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Remove env -i' }))
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        sandbox: { commands: { added: [], removed: ['env -i'] } },
        expectedRevision: 5,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Remove env -i' })).toBeNull()
    // Claude Code keeps a line that starts with bun in its sandbox, whatever the list says.
    const calls = vi.mocked(client.setProjectRules).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Add a command leads run outside their sandbox' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'A command, as it starts' }), 'bun run test:e2e{Enter}')
    expect(screen.getByRole('textbox', { name: 'A command, as it starts', description: /starts with bun/ })).toBeTruthy()
    expect(client.setProjectRules).toHaveBeenCalledTimes(calls)
  })

  it('takes a command out at once, and adds one where its sentence ends', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ commands: [{ pattern: 'npm publish', decision: 'never' }] }) })
    withServices(<Rules />, client)
    await userEvent.click(
      await within(await screen.findByRole('listitem', { name: 'Never' })).findByRole('button', { name: 'Remove npm publish' }),
    )
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', commands: [], expectedRevision: 1 }))
    expect(says('Never')).toBe('Nothing is refused outright.')
    // Focus goes to the sentence's +, as nothing is left to take out.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a command to Never' })))

    await userEvent.click(screen.getByRole('button', { name: 'Add a command to Ask me' }))
    await userEvent.paste('terraform   *')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        commands: [{ pattern: 'terraform *', decision: 'ask' }],
        expectedRevision: 1,
      }),
    )
    expect(screen.queryByRole('textbox', { name: 'A command, as it starts' })).toBeNull()
    expect(within(sentence('Ask me')).getByText('terraform *')).toBeTruthy()
  })

  it('adds a whole line exactly, as it is typed', async () => {
    const { client } = fakeClient()
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a command to Go ahead' }))
    await userEvent.paste('git  status --short')
    await userEvent.click(screen.getByRole('combobox', { name: 'How it matches' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Exactly' }))
    expect(screen.getByText('Holds for this line alone')).toBeTruthy()
    // Back in the field once the match is chosen, to go on.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'A command, as it starts' })))
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        commands: [{ pattern: 'git  status --short', decision: 'allow', match: 'exact' }],
        expectedRevision: 1,
      }),
    )
  })

  it('never lets a command go ahead that comes first elsewhere, and says why', async () => {
    const { client } = fakeClient({
      getProjectRules: rulesOf({
        commands: [
          { pattern: 'bun test', decision: 'never' },
          { pattern: 'npm test', decision: 'ask' },
          { pattern: 'cargo build', decision: 'allow' },
        ],
      }),
    })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a command to Go ahead' }))
    const field = screen.getByRole('textbox', { name: 'A command, as it starts' })
    await userEvent.click(field)
    await userEvent.paste('bun test')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('alert').textContent).toBe(
      '“bun test” is under Never, which comes first, so nothing changed. Take it out there first.',
    )
    expect(field.getAttribute('aria-invalid')).toBe('true')
    await userEvent.clear(field)
    await userEvent.click(field)
    await userEvent.paste('npm  test')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('alert').textContent).toContain('is under Ask me, which comes first')
    // Already there: nothing to change.
    await userEvent.clear(field)
    await userEvent.click(field)
    await userEvent.paste('cargo build')
    await userEvent.keyboard('{Enter}')
    expect(client.setProjectRules).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'A command, as it starts' })).toBeNull()
  })

  it('moves the same words from another sentence: never takes the place of what went ahead', async () => {
    const { client } = fakeClient({
      getProjectRules: rulesOf({
        commands: [
          { pattern: 'bun test', decision: 'never' },
          { pattern: 'npm test', decision: 'ask' },
          { pattern: 'cargo build', decision: 'allow' },
        ],
      }),
    })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Add a command to Never' }))
    await userEvent.paste('cargo build')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p1',
        commands: [
          { pattern: 'bun test', decision: 'never' },
          { pattern: 'npm test', decision: 'ask' },
          { pattern: 'cargo build', decision: 'never' },
        ],
        expectedRevision: 1,
      }),
    )
  })

  it('keeps every command added quickly, each saved against the rules the last one left, and shows them all meanwhile', async () => {
    let kept: ProjectRulesView = { ...projectRules }
    const { client } = fakeClient({ getProjectRules: vi.fn(async () => kept) })
    vi.mocked(client.setProjectRules).mockImplementation(async ({ projectId, expectedRevision, ...change }) => {
      expect(expectedRevision).toBe(kept.revision)
      await new Promise((resolve) => setTimeout(resolve, 150))
      kept = { ...withChange(kept, change), projectId, revision: kept.revision + 1 }
      return kept
    })
    withServices(<Rules />, client)
    for (const command of ['bun test', 'bun install', 'git fetch']) {
      await userEvent.click(await screen.findByRole('button', { name: 'Add a command to Go ahead' }))
      await userEvent.paste(command)
      await userEvent.keyboard('{Enter}')
    }
    expect(says('Go ahead')).toBe('They go ahead with bun test, bun install and git fetch.')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(kept.commands.map((rule) => rule.pattern)).toEqual(['bun test', 'bun install', 'git fetch']))
    expect(says('Go ahead')).toBe('They go ahead with bun test, bun install and git fetch.')
  })

  it('keeps each project’s changes to its own rules when the screen goes from one project to another', async () => {
    const rulesFor = (projectId: string): ProjectRulesView => ({
      ...projectRules,
      projectId,
      revision: projectId === 'p1' ? 11 : 1,
      never: projectId === 'p1' ? ['deploy'] : [],
    })
    const { client } = fakeClient({ getProjectRules: vi.fn(async (projectId: string) => rulesFor(projectId)) })
    vi.mocked(client.setProjectRules).mockImplementation(async ({ projectId, expectedRevision, ...change }) => {
      // Each against its own project's rules.
      expect(expectedRevision).toBe(rulesFor(projectId).revision)
      return { ...withChange(rulesFor(projectId), change), revision: rulesFor(projectId).revision + 1 }
    })
    function Switching() {
      const [projectId, setProjectId] = useState('p1')
      return (
        <>
          <button type="button" onClick={() => setProjectId('p2')}>
            Another project
          </button>
          <RulesSection model={useRules(projectId)} />
        </>
      )
    }
    withServices(<Switching />, client)
    await choose(await screen.findByRole('button', { name: 'force pushing' }), 'Never')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: 'Another project' }))
    await waitFor(() => expect(says('Never')).toBe('Nothing is refused outright.'))
    await choose(screen.getByRole('button', { name: 'deleting other branches' }), 'Never')
    await waitFor(() =>
      expect(client.setProjectRules).toHaveBeenLastCalledWith({
        projectId: 'p2',
        never: ['delete-branch'],
        alwaysAsk: ['default-branch', 'force-push', 'many-branches', 'deploy', 'outside'],
        alwaysAllow: [],
        expectedRevision: 1,
      }),
    )
  })

  it('reads the rules again when a save is answered while a newer read is on its way, so a rule kept meanwhile shows', async () => {
    let server: ProjectRulesView = { ...projectRules }
    const getProjectRules = vi.fn(async () => {
      const now = server
      // The read after the card kept its rule is the slow one.
      if (now.revision === 3) await new Promise((resolve) => setTimeout(resolve, 120))
      return now
    })
    const { client, emit } = fakeClient({ getProjectRules })
    vi.mocked(client.setProjectRules).mockImplementation(async ({ projectId, expectedRevision, ...change }) => {
      expect(expectedRevision).toBe(1)
      const kept = { ...withChange(server, change), projectId, revision: 2 }
      // Saved; then a permission answered with always allow keeps a rule, and the watch says so before this answer arrives.
      server = { ...kept, commands: [{ pattern: 'git status', decision: 'allow' }], revision: 3 }
      emit(changed('policy', 'pol3', null, 'p1'))
      await new Promise((resolve) => setTimeout(resolve, 30))
      return kept
    })
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'force pushing' }), 'Never')
    await waitFor(() => expect(says('Go ahead')).toBe('They go ahead with git status.'))
    expect(says('Never')).toBe('Agents never force push.')
  })

  it('says nothing is let through by a rule yet, and how one gets there; Escape leaves a command being added', async () => {
    const { client } = fakeClient()
    withServices(<Rules />, client)
    expect(
      await screen.findByText('Nothing goes ahead by a rule yet: a permission answered with “always allow” adds one here.'),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add a command to Go ahead' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'A command, as it starts' }), 'rm{Escape}')
    expect(screen.queryByRole('textbox', { name: 'A command, as it starts' })).toBeNull()
    expect(client.setProjectRules).not.toHaveBeenCalled()
  })

  it('names the revision it read when it changes a list, and reads the rules again when they had moved on', async () => {
    const getProjectRules = rulesOf({ revision: 3 })
    const { client } = fakeClient({ getProjectRules })
    vi.mocked(client.setProjectRules).mockRejectedValueOnce(
      new ApiError({ reason: 'RulesChanged', message: "The project's rules changed meanwhile, so that change wasn't made." }),
    )
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'force pushing' }), 'Never')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3 })))
    expect(await screen.findByText("The project's rules changed meanwhile, so that change wasn't made.")).toBeTruthy()
    await waitFor(() => expect(getProjectRules.mock.calls.length).toBeGreaterThan(1))
    // A change of one setting alone replaces no list, so it names none.
    await choose(screen.getByRole('button', { name: 'a draft pull request' }), 'Push the branch only')
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
      return { ...withChange(projectRules, change), projectId, revision }
    })
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'force pushing' }), 'The rest')
    await choose(screen.getByRole('button', { name: 'deploying or publishing' }), 'The rest')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledTimes(2))
    expect(vi.mocked(client.setProjectRules).mock.calls.map(([change]) => change.expectedRevision)).toEqual([3, 4])
    expect(vi.mocked(client.setProjectRules).mock.calls[1]?.[0].alwaysAsk).toEqual([
      'default-branch',
      'many-branches',
      'delete-branch',
      'outside',
    ])
  })

  it('changes how a task ends and what a usage limit does, and offers only what Althar does', async () => {
    const { client } = fakeClient()
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'a draft pull request' }), 'Push the branch only')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'none' }))
    expect(says('Finished')).toContain(
      'A finished task pushes its branch alone, named althar/MER-128-fix-login. A pull request opened from it is titled Fix login',
    )
    await userEvent.click(screen.getByRole('button', { name: 'moves to the next agent free' }))
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Move the work to the next agent free'),
      expect.stringContaining('Wait for the reset'),
      expect.stringContaining('Ask me'),
    ])
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Wait for the reset' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', usageLimit: 'wait' }))
    // No agent has more than one account here: the accounts aren't said.
    expect(says('Limits')).toBe('When an account runs out, the work waits for the reset.')
    // Or the step waits for the person, who moves it or waits.
    await choose(screen.getByRole('button', { name: 'waits for the reset' }), 'Ask me')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', usageLimit: 'ask' }))
    expect(says('Limits')).toBe(
      'When an account runs out, the work waits for you to move it to a model that’s free, or to wait for the reset.',
    )
  })

  it('offers the accounts of an agent with more than one: which run work here, and whether work goes on with the next', async () => {
    const codex = agents[1] ?? agents[0]!
    const { client } = fakeClient({
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: [{ ...codex, accounts: [usual('acc_main', 'signed_in'), { ...usual('acc_work', 'signed_in'), name: 'work', home: '/w' }] }],
      })),
    })
    withServices(<Rules />, client)
    await waitFor(() =>
      expect(says('Limits')).toBe('When an account runs out, the work moves to the next agent free. Codex works on main.'),
    )
    await userEvent.click(within(sentence('Limits')).getByRole('button', { name: 'main' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Go on with the next' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', rotateAccounts: true }))
    expect(says('Limits')).toBe(
      'When an account runs out, the work goes on with the agent’s next account, then moves to the next agent free. Codex works on main, then work.',
    )
    await userEvent.click(within(sentence('Limits')).getByRole('button', { name: 'main, then work' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'main' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', onlyAccounts: { codex: ['acc_work'] } }))
    // The last one on stays on.
    expect(screen.getByRole('menuitemcheckbox', { name: 'work' }).getAttribute('aria-disabled')).toBe('true')
    // Every account again is no limit at all.
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'main' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', onlyAccounts: null }))
  })

  it('says where names come from, saves a pattern Althar can follow, and says why it can’t follow one', async () => {
    const { client } = fakeClient({
      getProjectRules: rulesOf({
        conventions: [
          {
            repository: 'api',
            branch: { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' },
            title: null,
            template: '.github/pull_request_template.md',
          },
        ],
      }),
    })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'each repository’s template' }))
    expect(await screen.findByText('.github/pull_request_template.md, filled in by the lead')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'feature/MER-128-fix-login' }))
    expect(await screen.findByText('CONTRIBUTING.md says feature/{key}-{slug}')).toBeTruthy()
    const branches = screen.getByRole('textbox', { name: 'Branch names' })
    await userEvent.type(branches, 'team/{{key}{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('needs {slug}')
    expect(client.setProjectRules).not.toHaveBeenCalled()
    await userEvent.type(branches, '-{{slug}{Enter}')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', branchPattern: 'team/{key}-{slug}' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'team/MER-128-fix-login' })).toBeTruthy()
  })

  it('says the repositories each name their own, where they differ', async () => {
    const { client } = fakeClient({
      getProjectRules: rulesOf({
        conventions: [
          { repository: 'api', branch: { pattern: 'feature/{key}-{slug}', from: 'CONTRIBUTING.md' }, title: null, template: null },
          { repository: 'web', branch: null, title: null, template: '.github/pull_request_template.md' },
        ],
      }),
    })
    withServices(<Rules />, client)
    expect(await screen.findByRole('button', { name: 'as each repository says' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'each repository’s template, where it has one' })).toBeTruthy()
  })

  it('says what went wrong saving', async () => {
    const { client } = fakeClient({
      setProjectRules: vi.fn(async () => Promise.reject(new ApiError({ reason: 'SqlError', message: 'The disk is full.' }))),
    })
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'allowed' }), 'Ask me')
    expect((await screen.findByRole('alert')).textContent).toContain('disk is full')
  })
})
