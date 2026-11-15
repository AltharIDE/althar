import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Client } from '../src/renderer/data/client'
import { ServicesProvider } from '../src/renderer/data/services'
import { useSkills } from '../src/renderer/features/settings/useSkills'
import { fakeClient, installedSkill, skillCard } from './fixtures'
import { servicesFor } from './render'

const modelOf = (client: Client, check = false) => {
  const services = servicesFor(client)
  const hook = renderHook(() => useSkills({ check }), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
  return { ...hook, services }
}

describe('a skill update that needs another try', () => {
  it('checks GitHub quietly, keeps failures per skill, and removes only the update that was installed', async () => {
    const { client } = fakeClient({
      listSkills: vi.fn<Client['listSkills']>(async () => ({
        enabled: true,
        skills: [{ ...installedSkill, source: 'github', repo: skillCard.source.repo }],
      })),
      checkSkillUpdates: vi.fn<Client['checkSkillUpdates']>(async () => [
        { id: skillCard.id, state: 'available', card: skillCard },
        { id: 'other', state: 'failed', error: 'Repository unavailable.' },
        { id: 'current', state: 'current', sha: 'a'.repeat(40) },
      ]),
    })
    const { result, rerender } = modelOf(client, true)
    await waitFor(() => expect(result.current.checked).toBe(true))
    expect(result.current.available).toEqual([skillCard.id])
    expect(result.current.unchecked).toEqual([{ id: 'other', error: 'Repository unavailable.' }])
    rerender()
    expect(client.checkSkillUpdates).toHaveBeenCalledOnce()
    act(() => result.current.reviewUpdate('missing'))
    expect(result.current.card).toBeNull()
    act(() => result.current.reviewUpdate(skillCard.id))
    expect(result.current.card?.id).toBe(skillCard.id)
    act(() => result.current.install(false))
    await waitFor(() => expect(result.current.added).toBe(1))
    expect(result.current.card).toBeNull()
    expect(result.current.available).toEqual([])
    expect(result.current.unchecked).toHaveLength(1)
    expect(client.approveSkill).toHaveBeenCalledWith(skillCard, false)
  })

  it('lets a failed quiet check be tried explicitly, and says why that attempt failed', async () => {
    const { client } = fakeClient({
      listSkills: vi.fn<Client['listSkills']>(async () => ({ enabled: true, skills: [{ ...installedSkill, source: 'github' }] })),
      checkSkillUpdates: vi.fn(async () => {
        throw new Error('Offline')
      }),
    })
    const { result } = modelOf(client, true)
    await waitFor(() => expect(client.checkSkillUpdates).toHaveBeenCalledOnce())
    expect(result.current.error).toBeNull()
    expect(result.current.checked).toBe(false)
    act(() => result.current.checkUpdates())
    await waitFor(() => expect(result.current.error).toBe('Offline'))
    act(() => result.current.cancel())
    expect(result.current.error).toBeNull()
    act(() => result.current.review('missing'))
    act(() => result.current.install(false))
    expect(client.stageSkill).not.toHaveBeenCalled()
    expect(client.approveSkill).not.toHaveBeenCalled()
  })

  it('rolls one skill back in the cached list, keeps the others, and reports an unstructured removal failure', async () => {
    const { client } = fakeClient({
      listSkills: vi.fn(async () => ({ enabled: true, skills: [installedSkill, { ...installedSkill, id: 'other' }] })),
      rollBackSkill: vi.fn(async () => ({ ...installedSkill, description: 'The previous version.' })),
      uninstallSkill: vi.fn(async () => {
        throw 'The store is read-only'
      }),
    })
    const { result, services } = modelOf(client)
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.rollBack(installedSkill.id))
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(services.cache.getQueryData(['skills'])).toMatchObject({
      skills: [{ description: 'The previous version.' }, { id: 'other', description: installedSkill.description }],
    })
    act(() => result.current.remove(installedSkill.id))
    await waitFor(() => expect(result.current.error).toBe('The store is read-only'))
  })
})
