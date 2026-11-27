import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { claimOnce } from '../src/main/claimOnce'
import { type ExperimentalStore, experimentalText, useExperimental } from '../src/renderer/features/homes/Experimental'

/*
 * Homes being experimental is said once for the computer: claimed in the
 * main process for the whole profile, before it is kept, so windows and
 * dialogs asking together never both say it.
 */

afterEach(cleanup)

/** A write to disk held until let go, as a slow one is. */
const slowDisk = (said = false) => {
  let release: () => void = () => undefined
  const kept = { said }
  const keep = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = () => {
          kept.said = true
          resolve()
        }
      }),
  )
  return { kept, keep, release: () => release() }
}

/** Connect a home's or Manage homes' head, in one window or another. */
function Dialog({ store }: { store: ExperimentalStore }) {
  return <div data-testid="dialog">{useExperimental(store)}</div>
}

describe('claiming it, in the main process', () => {
  it('gives it to the first ask only, while the write is still under way', async () => {
    const disk = slowDisk()
    const claim = claimOnce(async () => disk.kept.said, disk.keep)
    // Two windows at once, then a third dialog while the write waits.
    const [one, two] = await Promise.all([claim(), claim()])
    expect([one, two]).toEqual([true, false])
    expect(await claim()).toBe(false)
    expect(disk.keep).toHaveBeenCalledTimes(1)
    disk.release()
    await waitFor(() => expect(disk.kept.said).toBe(true))
  })

  it('gives it to none where it was said at an earlier launch, or can’t be read', async () => {
    const disk = slowDisk(true)
    expect(await claimOnce(async () => disk.kept.said, disk.keep)()).toBe(false)
    expect(disk.keep).not.toHaveBeenCalled()
    expect(await claimOnce(() => Promise.reject(new Error('gone')), disk.keep)()).toBe(false)
  })
})

describe('Homes are still experimental, in the dialogs', () => {
  it('shows in one dialog of two opened together in two windows, under StrictMode, with the write held', async () => {
    const disk = slowDisk()
    const store: ExperimentalStore = { claimHomesExperimental: claimOnce(async () => disk.kept.said, disk.keep) }
    render(
      <>
        <StrictMode>
          <Dialog store={store} />
        </StrictMode>
        <Dialog store={store} />
      </>,
    )
    expect(await screen.findByText(experimentalText.title)).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getAllByText(experimentalText.title)).toHaveLength(1)
    disk.release()
    expect(screen.getAllByText(experimentalText.title)).toHaveLength(1)
  })

  it('isn’t said where nothing claims it', () => {
    render(<Dialog store={{}} />)
    expect(screen.queryByText(experimentalText.title)).toBeNull()
  })
})
