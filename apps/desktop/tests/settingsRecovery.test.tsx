import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { useAutomationsPaused } from '../src/renderer/features/settings/useAutomationsPaused'
import { useCoAuthor } from '../src/renderer/features/settings/useCoAuthor'
import { useNewProjectDefaults } from '../src/renderer/features/settings/useNewProjectDefaults'
import { usePlansAndReviews } from '../src/renderer/features/settings/usePlansAndReviews'
import { usePostTeamReviews } from '../src/renderer/features/settings/usePostTeamReviews'
import { useReviewSeal } from '../src/renderer/features/settings/useReviewSeal'
import { useRunOutside } from '../src/renderer/features/settings/useRunOutside'
import { fakeClient } from './fixtures'
import { servicesFor } from './render'

const modelOf = <T,>(client: Client, useModel: () => T) => {
  const services = servicesFor(client)
  return renderHook(useModel, {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('settings saved while an earlier change is still in flight', () => {
  it.each([
    { name: 'co-author', hook: useCoAuthor, write: 'setCoAuthor', original: true },
    { name: 'review seal', hook: useReviewSeal, write: 'setReviewSeal', original: true },
    { name: 'posting team reviews', hook: usePostTeamReviews, write: 'setPostTeamReviews', original: false },
    { name: 'pausing automations', hook: useAutomationsPaused, write: 'setAutomationsPaused', original: false },
  ] as const)(
    'keeps the latest $name choice when an older write fails, and recovers when the latest fails',
    async ({ hook, write, original }) => {
      const { client } = fakeClient()
      const older = Promise.withResolvers<void>()
      const latest = Promise.withResolvers<void>()
      const keep = vi
        .spyOn(client, write)
        .mockImplementationOnce(() => older.promise)
        .mockImplementationOnce(() => latest.promise)
      const { result } = modelOf(client, hook)
      expect(result.current).toBeNull()
      await waitFor(() => expect(result.current?.on).toBe(original))
      act(() => result.current?.set(!original))
      await waitFor(() => expect(result.current?.on).toBe(!original))
      act(() => result.current?.set(original))
      await act(async () => older.reject(new Error('Older write refused')))
      expect(result.current?.failed).toBe(false)
      expect(client.getSettings).toHaveBeenCalledOnce()
      await act(async () => latest.reject(new Error('Latest write refused')))
      await waitFor(() => expect(result.current?.failed).toBe(true))
      expect(client.getSettings).toHaveBeenCalledTimes(2)
      act(() => result.current?.set(!original))
      await waitFor(() => expect(result.current).toMatchObject({ on: !original, failed: false }))
      expect(keep.mock.calls.map(([on]) => on)).toEqual([!original, original, !original])
    },
  )

  it('defaults outside pull requests to Ask, keeps the latest trust choice, and restores the runtime’s value after refusal', async () => {
    const { client } = fakeClient()
    const older = Promise.withResolvers<void>()
    const latest = Promise.withResolvers<void>()
    vi.mocked(client.setRunOutside)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise)
    const { result } = modelOf(client, useRunOutside)
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.to).toBe('ask'))
    act(() => result.current?.set('safe'))
    await waitFor(() => expect(result.current?.to).toBe('safe'))
    act(() => result.current?.set('full'))
    await act(async () => older.reject(new Error('Older write refused')))
    expect(result.current?.failed).toBe(false)
    expect(client.getSettings).toHaveBeenCalledOnce()
    await act(async () => latest.reject(new Error('Latest write refused')))
    await waitFor(() => expect(result.current).toMatchObject({ to: 'ask', failed: true }))
    act(() => result.current?.set('safe'))
    await waitFor(() => expect(result.current).toMatchObject({ to: 'safe', failed: false }))
    expect(vi.mocked(client.setRunOutside).mock.calls.map(([to]) => to)).toEqual(['safe', 'full', 'safe'])
  })

  it('keeps changes to different new-project defaults together and ignores an older refusal', async () => {
    const { client } = fakeClient()
    const older = Promise.withResolvers<void>()
    const latest = Promise.withResolvers<void>()
    vi.mocked(client.setNewProjectDefaults)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise)
    const { result } = modelOf(client, useNewProjectDefaults)
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.value.pushCommits).toBe(true))
    act(() => result.current?.set({ pushCommits: false, end: undefined }))
    await waitFor(() => expect(result.current?.value).toMatchObject({ pushCommits: false, end: 'draft' }))
    act(() => result.current?.set({ postScreenshots: true }))
    await act(async () => older.reject(new Error('Older write refused')))
    await waitFor(() => expect(result.current?.value).toMatchObject({ pushCommits: false, postScreenshots: true, end: 'draft' }))
    expect(result.current?.failed).toBe(false)
    expect(client.getSettings).toHaveBeenCalledOnce()
    await act(async () => latest.reject(new Error('Latest write refused')))
    await waitFor(() => expect(result.current?.failed).toBe(true))
    await waitFor(() => expect(result.current?.value).toMatchObject({ pushCommits: true, postScreenshots: false, end: 'draft' }))
  })

  it('keeps a countdown edit beside a review edit and restores both from the runtime only when the latest fails', async () => {
    const { client } = fakeClient()
    const older = Promise.withResolvers<void>()
    const latest = Promise.withResolvers<void>()
    vi.mocked(client.setPlansAndReviews)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => latest.promise)
    const { result } = modelOf(client, usePlansAndReviews)
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.value.countdown).toBe(25))
    act(() => result.current?.set({ countdown: 10, roundsOut: undefined }))
    await waitFor(() => expect(result.current?.value).toMatchObject({ countdown: 10, roundsOut: 'settled' }))
    act(() => result.current?.set({ roundsOut: 'ask' }))
    await act(async () => older.reject(new Error('Older write refused')))
    await waitFor(() => expect(result.current?.value).toMatchObject({ countdown: 10, roundsOut: 'ask' }))
    expect(result.current?.failed).toBe(false)
    expect(client.getSettings).toHaveBeenCalledOnce()
    await act(async () => latest.reject(new Error('Latest write refused')))
    await waitFor(() => expect(result.current?.failed).toBe(true))
    await waitFor(() => expect(result.current?.value).toMatchObject({ countdown: 25, roundsOut: 'settled' }))
  })
})
