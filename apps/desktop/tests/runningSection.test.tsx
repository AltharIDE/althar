import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectRepository, type ProjectRulesView } from '@althar/contracts'
import { TaskEnd } from '@althar/ui'

import { branchesOf, finishOf, RunningSection } from '../src/renderer/features/projectSettings/RunningSection'
import { fakeClient, projectRules, repositories, runnables } from './fixtures'
import { withServices } from './render'

/*
 * A project's settings on what it runs and where its work goes, drawn
 * before its coordinator, rules or repositories are read, and for each way
 * its branches are named and a task ends: by the person's pattern, as its
 * repositories' docs say, all or some, on a host Althar doesn't know, or
 * pushed with no pull request.
 */

const [api] = repositories as [ProjectRepository, ...ProjectRepository[]]
const notConnected = { ...api, host: { ...api.host!, account: null } }
const unknownHost = {
  ...api,
  host: { product: null, name: 'git.northwind.io', instance: null, path: 'ops/infra', url: null, account: null },
}

const rulesWith = (overrides: Partial<ProjectRulesView> = {}): ProjectRulesView => ({ ...projectRules, ...overrides })

const show = (props: Partial<Parameters<typeof RunningSection>[0]> = {}, client = fakeClient().client) => {
  const onRules = vi.fn()
  const onCode = vi.fn()
  const { unmount } = withServices(
    <RunningSection
      projectId="p1"
      project="meridian"
      runnables={null}
      rules={null}
      repositories={null}
      worktrees={null}
      onRules={onRules}
      onCode={onCode}
      {...props}
    />,
    client,
  )
  return { onRules, onCode, unmount }
}

describe('what a task ends with', () => {
  it('is pushed only where the person said so, whatever its hosts', () => {
    expect(finishOf('none', [unknownHost])).toEqual({ kind: 'end', end: TaskEnd.PushOnly })
  })

  it('stays on its branch where no repository is on a host Althar knows', () => {
    expect(finishOf(null, [{ host: null }, unknownHost])).toEqual({ kind: 'unknown' })
  })

  it('is the person’s choice on a known host, or a draft once Althar is signed in to one; else on its branch until it is', () => {
    expect(finishOf('ready', [notConnected])).toEqual({ kind: 'end', end: TaskEnd.ReadyPr })
    expect(finishOf(null, [api])).toEqual({ kind: 'end', end: TaskEnd.DraftPr })
    expect(finishOf(null, [notConnected])).toEqual({ kind: 'unconnected', host: 'GitHub' })
  })
})

describe('how its branches are named', () => {
  /** A repository's conventions: its docs' branch pattern, where they say one. */
  const convention = (repository: string, branch: string | null) => ({
    repository,
    branch: branch === null ? null : { pattern: branch, from: 'CONTRIBUTING.md' },
    title: null,
    template: null,
  })

  it('is the person’s pattern, else what every repository’s docs say, else Althar’s own where they say nothing or some do', () => {
    expect(branchesOf(rulesWith({ branchPattern: 'feat/{slug}' }))).toBe('feat/{slug}')
    expect(branchesOf(rulesWith({ conventions: [convention('api', null)] }))).toBe('althar/{key}-{slug}')
    expect(branchesOf(rulesWith({ conventions: [convention('api', 'feature/*'), convention('web', 'feat/*')] }))).toBe(
      'As each repository’s docs say',
    )
    expect(branchesOf(rulesWith({ conventions: [convention('api', 'feature/*'), convention('web', null)] }))).toBe(
      'As each repository’s docs say, else althar/{key}-{slug}',
    )
  })

  it('shows each as it reads: words, words and code, or code', () => {
    const all = rulesWith({ conventions: [convention('api', 'feature/*')] })
    const some = rulesWith({ conventions: [convention('api', 'feature/*'), convention('web', null)] })
    const { unmount } = show({ runnables: [], rules: all, repositories: [] })
    expect(screen.getByText('As each repository’s docs say')).toBeTruthy()
    unmount()
    show({ rules: some })
    expect(screen.getByText('As each repository’s docs say, else', { exact: false })).toBeTruthy()
    expect(screen.getByText('althar/{key}-{slug}')).toBeTruthy()
  })
})

describe('the running section', () => {
  it('lists nothing to run and no ending before the coordinator, rules and repositories are read, and says where worktrees will be', () => {
    show()
    expect(screen.getByText('Made with its first task, never in its repositories’ own folders')).toBeTruthy()
    expect(screen.queryByText('Branch names')).toBeNull()
    expect(screen.queryByText('When a task is done')).toBeNull()
  })

  it('says a task stays on its branch on a host Althar doesn’t know, with the rules to change it', async () => {
    const { onRules } = show({ rules: rulesWith(), repositories: [unknownHost], worktrees: '/Users/me/Althar/meridian' })
    expect(screen.getByText('~/Althar/meridian')).toBeTruthy()
    expect(screen.getByText('Leave it on its branch. Its repositories are on no host Althar knows, so no pull request opens.')).toBeTruthy()
    const changes = screen.getAllByRole('button', { name: 'Change in Rules' })
    await userEvent.click(changes.at(-1) as HTMLElement)
    expect(onRules).toHaveBeenCalled()
  })

  it('says what went wrong in the list, where no dialog is open to say it', async () => {
    const client = fakeClient({
      dropRunnable: vi.fn(async () => {
        throw new ApiError({ reason: 'RunnableFailed', message: 'The runtime is restarting.' })
      }),
    }).client
    show({ runnables }, client)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Storybook' }))
    await waitFor(() => expect(screen.getByText('The runtime is restarting.')).toBeTruthy())
  })
})
