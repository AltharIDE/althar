import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Effect, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { afterExit, RESTARTS_PER_MINUTE } from '../src/main/restarts'
import { failureForWindow, storeFailureOf } from '../src/main/storeFailure'
import type { StoreFailure } from '../src/renderer/data/services'
import { ProfileInUseView } from '../src/renderer/features/update/ProfileInUseView'
import { profileInUse } from '../src/runtime/profileInUse'
import { fakeHost } from './fixtures'

/* A profile another Althar or the command line has open (DEV-115): the person's to put right, so not a crash (ADR-047). */

const IN_USE = 'Another copy of Althar is using this profile.'

describe('the runtime, on a profile that is open elsewhere', () => {
  it('tells main in the words the runtime has for it, then serves nothing and waits to be shut down', async () => {
    const post = vi.fn()
    const fiber = Effect.runFork(profileInUse(post))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: 'profile-in-use', reason: IN_USE })
    // It hasn't failed or finished, so the process doesn't exit 1 for main to restart.
    expect(fiber.pollUnsafe()).toBeUndefined()
    await Effect.runPromise(Fiber.interrupt(fiber))
  })
})

describe('main, hearing it', () => {
  it('keeps it as a store it can’t serve that moved and copied nothing, and sends the window the words', () => {
    const failure = storeFailureOf({ type: 'profile-in-use', reason: IN_USE })
    expect(failure).toEqual({ stopped: 'held', backup: null, reason: IN_USE })
    expect(failureForWindow(failure as StoreFailure, '/Users/ada')).toEqual({ stopped: 'held', backup: null, reason: IN_USE })
    expect(storeFailureOf({ type: 'profile-in-use' })).toBeUndefined()
  })

  it('does not start the runtime again, whatever the earlier restarts, and reports no crash', () => {
    const now = 1_000_000
    for (const restarts of [[], Array.from({ length: RESTARTS_PER_MINUTE }, (_, i) => now - i)]) {
      expect(afterExit({ quitting: false, stopped: true, retrying: false, restarts, now })).toEqual({ next: 'stay', restarts })
    }
  })

  it('starts it again when the person tries again, without counting that as a crash', () => {
    const restarts = [1, 2]
    expect(afterExit({ quitting: false, stopped: true, retrying: true, restarts, now: 10 })).toEqual({ next: 'start', restarts })
  })

  it('still restarts a crash, up to three in a minute, then gives up', () => {
    let restarts: ReadonlyArray<number> = []
    const seen: Array<string> = []
    for (let n = 0; n < 5; n++) {
      const after = afterExit({ quitting: false, stopped: false, retrying: false, restarts, now: 1_000 + n })
      restarts = after.restarts
      seen.push(after.next)
    }
    expect(seen).toEqual(['start', 'start', 'start', 'give-up', 'give-up'])
    // A minute on, the count starts over.
    expect(afterExit({ quitting: false, stopped: false, retrying: false, restarts, now: 80_000 }).next).toBe('start')
    expect(afterExit({ quitting: true, stopped: false, retrying: false, restarts, now: 80_000 }).next).toBe('stay')
  })
})

describe('the window, on a profile that is open elsewhere', () => {
  const failure: StoreFailure = { stopped: 'held', backup: null, reason: IN_USE }

  it('says so, says to close the other, and tries again on the person’s word', async () => {
    const host = fakeHost()
    render(<ProfileInUseView failure={failure} host={host} />)
    expect(screen.getByRole('alert').textContent).toContain(IN_USE)
    expect(screen.getByRole('alert').textContent).toContain('Close it, then try again.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(host.tryAgain).toHaveBeenCalledOnce()
  })
})
