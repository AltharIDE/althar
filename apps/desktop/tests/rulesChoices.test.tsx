import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectRulesView } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { RulesSection } from '../src/renderer/features/rules/RulesSection'
import { useRules } from '../src/renderer/features/rules/useRules'
import { fakeClient, projectRules } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * A project's rules from where the rest of their tests don't start: asking
 * about the rest, a task ending ready for review, work waiting at a limit,
 * the person's own branch pattern followed back to the repository's, a
 * title pattern; and rules that aren't read yet, or can't be.
 */

function Rules() {
  return <RulesSection model={useRules('p1')} />
}

const rulesOf = (rules: Partial<ProjectRulesView>) => vi.fn(async () => ({ ...projectRules, ...rules }))

/** One sentence of the rules, by its word in the margin. */
const sentence = (label: string) => screen.findByRole('listitem', { name: label })

/** Opens a built-in word's menu and picks what it should be. */
const choose = async (word: HTMLElement, option: string) => {
  await userEvent.click(word)
  await userEvent.click(await screen.findByRole('menuitemradio', { name: option }))
}

describe('a project’s rules, changed from where they stand', () => {
  it('goes back from asking about the rest to allowing it, except what is kept', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ permissions: 'ask' }) })
    withServices(<Rules />, client)
    await choose(await within(await sentence('The rest')).findByRole('button', { name: 'ask me' }), 'Allowed')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', permissions: 'rules' }))
  })

  it('ends a task ready for review where the rules say so, and changes it to a draft and back', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ end: 'ready' }) })
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'a pull request for review' }), 'Open a draft pull request')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'draft' }))
    await choose(await screen.findByRole('button', { name: 'a draft pull request' }), 'Open a pull request for review')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', end: 'ready' }))
  })

  it('moves work on again where a limit made it wait', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ usageLimit: 'wait' }) })
    withServices(<Rules />, client)
    await choose(await screen.findByRole('button', { name: 'waits for the reset' }), 'Move the work to the next agent free')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', usageLimit: 'move' }))
  })

  it('follows the repository again in place of the person’s branch pattern, and keeps a title pattern', async () => {
    const { client } = fakeClient({ getProjectRules: rulesOf({ branchPattern: 'team/{key}-{slug}' }) })
    withServices(<Rules />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'team/MER-128-fix-login' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Follow the repository' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', branchPattern: null }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Fix login' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Pull request titles' }), '{{key}: {{title}{Enter}')
    await waitFor(() => expect(client.setProjectRules).toHaveBeenLastCalledWith({ projectId: 'p1', titlePattern: '{key}: {title}' }))
  })
})

describe('a project’s rules not read', () => {
  it('says why they couldn’t be', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async () => {
        throw new ApiError({ reason: 'Unavailable', message: 'The runtime is restarting.' })
      }),
    })
    withServices(<Rules />, client)
    expect((await screen.findByRole('alert')).textContent).toContain('The runtime is restarting.')
  })

  it('keeps no change made before they are read', async () => {
    const { client } = fakeClient({ getProjectRules: vi.fn(() => new Promise<ProjectRulesView>(() => undefined)) })
    const services = servicesFor(client)
    const { result } = renderHook(() => useRules('p1'), {
      wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
    })
    await act(async () => result.current.change({ usageLimit: 'wait' }))
    expect(result.current.rules).toBeNull()
    expect(client.setProjectRules).not.toHaveBeenCalled()
  })
})
