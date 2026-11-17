import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ShipFar, ShipStop } from '@althar/ui'

import { kitRoute, routeOf, kitStop } from '../src/renderer/shared/shipRoute'
import { useShipRoute } from '../src/renderer/features/settings/useShipRoute'
import { ServicesProvider } from '../src/renderer/data/services'
import { fakeClient } from './fixtures'
import { servicesFor } from './render'

it('preserves the selected review and destination through the runtime and kit vocabulary', () => {
  for (const [far, kit] of [
    ['push', ShipFar.Push],
    ['ready', ShipFar.Ready],
    ['merge', ShipFar.Merge],
  ] as const) {
    for (const review of [true, false]) {
      expect(kitRoute({ review, far })).toEqual({ review, far: kit })
      expect(routeOf({ review, far: kit })).toEqual({ review, far })
    }
  }
  for (const [stop, kit] of [
    ['review', ShipStop.Review],
    ['push', ShipStop.Push],
    ['ready', ShipStop.Ready],
    ['merge', ShipStop.Merge],
  ] as const)
    expect(kitStop(stop)).toBe(kit)
})

it('shows a default immediately, removes it on reset, and reads the saved route again on refusal', async () => {
  let reject!: (error: Error) => void
  const { client } = fakeClient({
    setShipRoute: vi.fn(
      () =>
        new Promise<void>((_, no) => {
          reject = no
        }),
    ),
  })
  const services = servicesFor(client)
  const hook = renderHook(useShipRoute, { wrapper: ({ children }) => <ServicesProvider value={services}>{children}</ServicesProvider> })
  expect(hook.result.current).toBeNull()
  await waitFor(() => expect(hook.result.current).not.toBeNull())
  const route = { review: false, far: 'merge' as const }
  act(() => hook.result.current!.set(route))
  await waitFor(() => expect(hook.result.current?.route).toEqual(route))
  expect(client.setShipRoute).toHaveBeenCalledWith(route)
  await act(async () => reject(new Error('Refused')))
  await waitFor(() => expect(hook.result.current?.failed).toBe(true))
  await waitFor(() => expect(hook.result.current?.route).toBeNull())
  expect(client.getSettings).toHaveBeenCalledTimes(2)
  act(() => hook.result.current!.set(null))
  await waitFor(() => expect(hook.result.current?.failed).toBe(false))
  expect(hook.result.current?.route).toBeNull()
  expect(client.setShipRoute).toHaveBeenLastCalledWith(null)
})

it('ignores a refusal of an older choice after a newer default has been chosen', async () => {
  let reject!: (error: Error) => void
  const baseline = await fakeClient().client.getSettings()
  const { client } = fakeClient({
    setShipRoute: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, no) => {
            reject = no
          }),
      )
      .mockResolvedValue(undefined),
    getSettings: vi.fn(async () => ({ ...baseline, shipRoute: { review: true, far: 'ready' as const } })),
  })
  const services = servicesFor(client)
  const hook = renderHook(useShipRoute, { wrapper: ({ children }) => <ServicesProvider value={services}>{children}</ServicesProvider> })
  await waitFor(() => expect(hook.result.current?.route?.far).toBe('ready'))
  act(() => hook.result.current!.set({ review: true, far: 'push' }))
  act(() => hook.result.current!.set({ review: false, far: 'merge' }))
  await act(async () => reject(new Error('Old choice refused')))
  await waitFor(() => expect(hook.result.current?.route).toEqual({ review: false, far: 'merge' }))
  expect(hook.result.current?.failed).toBe(false)
  expect(client.getSettings).toHaveBeenCalledOnce()
})
