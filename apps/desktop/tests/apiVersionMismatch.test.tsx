import { API_VERSION_MISMATCH, ApiError, type DomMessagePort } from '@althar/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { connect } from '../src/renderer/data/client'
import { openWindow } from '../src/renderer/data/open'
import { ApiVersionMismatchView } from '../src/renderer/features/update/ApiVersionMismatchView'
import { fakeHost } from './fixtures'

/* A runtime that serves another API version than the window speaks (DEV-117): the window says so and never half-opens. */

vi.mock('../src/renderer/data/client', async (original) => ({ ...(await original<object>()), connect: vi.fn() }))

const refusal = new ApiError({
  reason: API_VERSION_MISMATCH,
  message: 'This client speaks API version 2; this runtime serves version 1.',
  clientVersion: 2,
  runtimeVersion: 1,
})

describe('the window, opening over a runtime of another API version', () => {
  it('fails to open with the runtime’s refusal, naming both versions, rather than opening with nothing in it', async () => {
    vi.mocked(connect).mockResolvedValue({
      listProjects: () => Promise.reject(refusal),
    } as unknown as Awaited<ReturnType<typeof connect>>)
    const failure = await openWindow({} as DomMessagePort, fakeHost()).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBe(refusal)
  })
})

describe('the page it shows', () => {
  it('names both versions and tries again on the person’s word', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<ApiVersionMismatchView windowVersion={2} runtimeVersion={1} host={fakeHost()} />)
    expect(screen.getByRole('alert').textContent).toContain('The window speaks API version 2; the runtime serves version 1.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('says so where the window named none', () => {
    render(<ApiVersionMismatchView windowVersion={null} runtimeVersion={1} host={fakeHost()} />)
    expect(screen.getByRole('alert').textContent).toContain('didn’t say which API version')
  })
})
