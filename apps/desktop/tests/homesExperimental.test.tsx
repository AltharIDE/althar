import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type AppPreferences, DEFAULT_PREFERENCES, type PreferenceKey } from '../src/main/appPreferences'
import { type ExperimentalStore, experimentalText, useExperimental } from '../src/renderer/features/homes/Experimental'

/*
 * Homes being experimental is said once for the computer: the app's own
 * preference, which every window reads afresh, a home's window too, whose
 * storage is kept apart from this computer's.
 */

afterEach(cleanup)

/** The main process's preferences, shared by every window. */
const profile = (): ExperimentalStore & { kept: AppPreferences } => {
  const store = {
    kept: { ...DEFAULT_PREFERENCES },
    preferences: vi.fn(async () => ({ ...store.kept })),
    setPreference: vi.fn(async <K extends PreferenceKey>(key: K, value: AppPreferences[K]) => {
      store.kept = { ...store.kept, [key]: value }
      return { ...store.kept }
    }),
  }
  return store as ExperimentalStore & { kept: AppPreferences }
}

/** Connect a home's or Manage homes' head, in one window or another. */
function Dialog({ store }: { store: ExperimentalStore }) {
  return <div>{useExperimental(store)}</div>
}

describe('Homes are still experimental', () => {
  // Connect a home and Manage homes say it by the same hook, so either may open first.
  it('is said once, whichever dialog opens first and in whichever window', async () => {
    const shared = profile()
    // This computer's window, under StrictMode as the app runs.
    const first = render(
      <StrictMode>
        <Dialog store={shared} />
      </StrictMode>,
    )
    expect(await screen.findByText(experimentalText.title)).toBeTruthy()
    await waitFor(() => expect(shared.kept.homesExperimentalSaid).toBe(true))
    // Kept while that dialog is open.
    expect(screen.getByText(experimentalText.title)).toBeTruthy()
    first.unmount()
    // The other dialog, in a home's window: its own storage, the same preferences.
    render(<Dialog store={shared} />)
    await waitFor(() => expect(shared.preferences).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(experimentalText.title)).toBeNull()
  })

  it('isn’t said where the preferences can’t be read', async () => {
    const store = { ...profile(), preferences: vi.fn(async () => Promise.reject(new Error('gone'))) }
    render(<Dialog store={store} />)
    await waitFor(() => expect(store.preferences).toHaveBeenCalled())
    expect(screen.queryByText(experimentalText.title)).toBeNull()
  })
})
