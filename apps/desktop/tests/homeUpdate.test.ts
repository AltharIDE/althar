import { describe, expect, it, vi } from 'vitest'

import { homeUpdates, updatedFrom } from '../src/main/homes/update'

const ran = (code: number | null, stdout = '', stderr = '') => ({ code, stdout, stderr })
const runner = { id: 'h1', name: 'runner-1', homeId: `home_${'1'.repeat(32)}`, ssh: { target: 'althar@runner-1' } }

describe('a home updated from its window', () => {
  it('is updated once the home’s own updater says it applied the release', () => {
    expect(updatedFrom(ran(0, '{"id":"u1","state":"applied","version":"0.42.0"}\n'), 'runner-1')).toEqual({
      state: 'applied',
      version: '0.42.0',
    })
  })

  it('says plainly why it didn’t: no newer release, SSH, the updater’s own words, or too long', () => {
    expect(() => updatedFrom(ran(0, '{"state":"current","version":"0.41.0"}'), 'runner-1')).toThrow(
      'There’s no newer Althar for runner-1 yet.',
    )
    expect(() => updatedFrom(ran(255, '', 'althar@runner-1: Permission denied (publickey).'), 'runner-1')).toThrow(
      'SSH couldn’t sign in to runner-1.',
    )
    expect(() => updatedFrom(ran(255, '', 'ssh: connect to host runner-1 port 22: Connection refused'), 'runner-1')).toThrow(
      'Couldn’t reach runner-1 over SSH.',
    )
    expect(() => updatedFrom(ran(1, '', 'debug1: x\nThis release changes the API or stored-data format.\n'), 'runner-1')).toThrow(
      'This release changes the API or stored-data format.',
    )
    expect(() => updatedFrom(ran(null), 'runner-1')).toThrow(/took too long/)
  })

  it('runs the home’s own update over the SSH its connection uses, once for each home however often it’s asked', async () => {
    let finish: (value: ReturnType<typeof ran>) => void = () => {}
    const run = vi.fn(() => new Promise<ReturnType<typeof ran>>((resolve) => (finish = resolve)))
    const updates = homeUpdates({ run, program: '/app/bin/althar-host-ssh', signal: new AbortController().signal })
    const first = updates.update(runner)
    const second = updates.update(runner)
    expect(run).toHaveBeenCalledOnce()
    const [program, args] = run.mock.calls[0] as unknown as [string, string[]]
    // The ssh the window's connection runs, as given: here the Flatpak's.
    expect(program).toBe('/app/bin/althar-host-ssh')
    expect(args.at(-1)).toContain('update --apply --wait --json')
    finish(ran(0, '{"state":"applied"}'))
    await expect(first).resolves.toEqual({ state: 'applied' })
    await expect(second).resolves.toEqual({ state: 'applied' })
    // Done, the next ask runs again.
    void updates.update(runner).catch(() => undefined)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
