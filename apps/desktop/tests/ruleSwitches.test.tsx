import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ProjectRulesView } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { useProjectSettings } from '../src/renderer/features/projectSettings/useProjectSettings'
import { withChange } from '../src/renderer/features/rules/useRules'
import { fakeClient, projectRules } from './fixtures'
import { servicesFor } from './render'

/*
 * A project's rule switches switched one after another, quicker than the runtime keeps them: each shows as switched from
 * the press, and holds until a read of the rules has it, whatever lands meanwhile (docs/decisions/foundations.md, The UI
 * is instant, rule 2): the first's reply, which hasn't the second, and a read from before either.
 */

type Change = Parameters<Client['setProjectRules']>[0]

/** The runtime's rules, as each switch is kept in turn, each a revision; each reply waits until the test lets it go. */
const runtime = () => {
  let kept: ProjectRulesView = { ...projectRules }
  const replies: Array<{ readonly change: Change; readonly answer: (failure?: unknown) => void }> = []
  const setProjectRules = vi.fn(
    (change: Change) =>
      new Promise<ProjectRulesView>((resolve, reject) =>
        replies.push({
          change,
          answer: (failure) => {
            if (failure !== undefined) return reject(failure)
            kept = { ...withChange(kept, change), projectId: kept.projectId, revision: kept.revision + 1 }
            resolve(kept)
          },
        }),
      ),
  )
  return { setProjectRules, replies, kept: () => kept }
}

const hook = () => {
  const rules = runtime()
  const { client } = fakeClient({ setProjectRules: rules.setProjectRules, getProjectRules: vi.fn(async () => rules.kept()) })
  const services = servicesFor(client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  const view = renderHook(() => useProjectSettings('p1', () => undefined), { wrapper })
  return { ...rules, ...view, cache: services.cache }
}

describe('a project’s rule switches, switched one after another', () => {
  it('keeps the second switched while the first’s reply, and a read from before both, land', async () => {
    const { result, replies, cache, kept } = hook()
    await waitFor(() => expect(result.current.rules).not.toBeNull())
    const before = result.current.rules!
    act(() => result.current.setMoveIssues(false))
    act(() => result.current.setPushCommits(false))
    expect([result.current.rules?.moveIssues, result.current.rules?.pushCommits]).toEqual([false, false])
    // The first is kept, and its reply hasn't the second: neither flicks back.
    await waitFor(() => expect(replies).toHaveLength(1))
    await act(async () => replies[0]!.answer())
    expect([result.current.rules?.moveIssues, result.current.rules?.pushCommits]).toEqual([false, false])
    // A read from before either lands late.
    act(() => void cache.setQueryData(keys.rules('p1'), before))
    expect([result.current.rules?.moveIssues, result.current.rules?.pushCommits]).toEqual([false, false])
    // The second kept: from its reply on, the rules as read say both.
    await waitFor(() => expect(replies).toHaveLength(2))
    await act(async () => replies[1]!.answer())
    expect(result.current.rules).toEqual(kept())
    expect(result.current.ruleFailed).toBeNull()
  })

  it('keeps the second of the same switch, pressed back before the first is kept', async () => {
    const { result, replies } = hook()
    await waitFor(() => expect(result.current.rules).not.toBeNull())
    act(() => result.current.setResolveConflicts(true))
    act(() => result.current.setResolveConflicts(false))
    await waitFor(() => expect(replies).toHaveLength(1))
    await act(async () => replies[0]!.answer())
    expect(result.current.rules?.resolveConflicts).toBe(false)
    await waitFor(() => expect(replies).toHaveLength(2))
    await act(async () => replies[1]!.answer())
    expect(result.current.rules?.resolveConflicts).toBe(false)
  })

  it('takes back the one the runtime refused, saying why, and keeps the one switched before it', async () => {
    const { result, replies, cache } = hook()
    await waitFor(() => expect(result.current.rules).not.toBeNull())
    act(() => result.current.setMoveIssues(false))
    act(() => result.current.setPushCommits(false))
    await waitFor(() => expect(replies).toHaveLength(1))
    await act(async () => replies[0]!.answer())
    await waitFor(() => expect(replies).toHaveLength(2))
    await act(async () => replies[1]!.answer(new ApiError({ reason: 'RulesChanged', message: 'The rules changed meanwhile.' })))
    expect(result.current.ruleFailed).toEqual({ rule: 'pushCommits', message: 'The rules changed meanwhile.' })
    // Read again, the rules as kept: the first switched, the second as it was.
    await waitFor(() => expect(result.current.rules?.pushCommits).toBe(true))
    expect(result.current.rules?.moveIssues).toBe(false)
    expect(cache.getQueryData<ProjectRulesView>(keys.rules('p1'))?.pushCommits).toBe(true)
  })
})
