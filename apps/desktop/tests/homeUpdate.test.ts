import { describe, expect, it, vi } from 'vitest'

import { LAST_WITHOUT_MAKING_PROJECTS, releaseMakesProjects } from '../src/homes'
import { newestHostVersion } from '../src/main/homes/release'
import { homeUpdates, problemOf, updatedFrom } from '../src/main/homes/update'

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

  it('says in a short line what the home’s updater found went wrong', () => {
    const kept = ' The installed release is unchanged.'
    // What runner-1 said: its updater, 0.1.0, says only that the download didn't complete.
    expect(
      problemOf(
        'The host update could not be downloaded completely. The installed release is unchanged; try again when the update source is available.',
        'runner-1',
      ),
    ).toBe('runner-1 couldn’t download the update.')
    // Later updaters say what failed.
    expect(problemOf(`DNS didn’t answer for api.github.com.${kept}`, 'runner-1')).toBe('runner-1’s DNS didn’t answer for api.github.com.')
    expect(problemOf(`Couldn’t connect to github.com.${kept}`, 'runner-1')).toBe('runner-1 couldn’t connect to github.com.')
    expect(problemOf(`github.com took too long to answer.${kept}`, 'runner-1')).toBe('github.com took too long to answer runner-1.')
    expect(problemOf(`api.github.com is limiting requests from this computer. Try again in an hour.${kept}`, 'runner-1')).toBe(
      'api.github.com is limiting requests from runner-1. Try again in an hour.',
    )
    expect(problemOf(`api.github.com answered with HTTP 404.${kept}`, 'runner-1')).toBe('api.github.com answered runner-1 with HTTP 404.')
    expect(
      problemOf(
        'No authenticated host release is available from the configured update source. The installed host is unchanged.',
        'runner-1',
      ),
    ).toBe('runner-1 found no update it could take.')
    expect(
      problemOf('The downloaded host release does not match its authenticated digest and size. It will not be installed.', 'runner-1'),
    ).toBe('The update runner-1 downloaded was damaged. Nothing changed.')
    // Anything else: its first sentence.
    expect(
      problemOf('An update or recovery transaction owns this installation. Downloading will resume after it is resolved.', 'runner-1'),
    ).toBe('An update or recovery transaction owns this installation.')
  })

  it('asks a 0.1.0 home again where its download failed, and logs what the home said in full', async () => {
    const failed = ran(
      1,
      '',
      'The host update could not be downloaded completely. The installed release is unchanged; try again when the update source is available.\n',
    )
    const run = vi
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(ran(0, '{"state":"current","version":"0.1.0"}'))
    const log = vi.fn()
    const updates = homeUpdates({ run, program: '/usr/bin/ssh', signal: new AbortController().signal, log })
    // Through, it says what the home found: nothing newer.
    await expect(updates.update(runner)).rejects.toThrow('There’s no newer Althar for runner-1 yet.')
    expect(run).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Updating runner-1 stopped (exit 1): The host update could not be downloaded completely.'),
    )

    // Three times at most, then its line.
    const always = vi.fn(async () => failed)
    const again = homeUpdates({ run: always, program: '/usr/bin/ssh', signal: new AbortController().signal })
    await expect(again.update(runner)).rejects.toThrow('runner-1 couldn’t download the update.')
    expect(always).toHaveBeenCalledTimes(3)

    // What trying again won't change is said at once.
    const other = vi.fn(async () => ran(1, '', 'This release changes the API or stored-data format.'))
    await expect(homeUpdates({ run: other, program: '/usr/bin/ssh', signal: new AbortController().signal }).update(runner)).rejects.toThrow(
      'This release changes the API or stored-data format.',
    )
    expect(other).toHaveBeenCalledOnce()
  })
})

describe('whether an update would help an older home', () => {
  const listed = (releases: ReadonlyArray<Record<string, unknown>>) => vi.fn(async () => new Response(JSON.stringify(releases)))
  const signal = new AbortController().signal

  it('finds the newest host release published, among the app’s own releases, drafts and prereleases left out', async () => {
    const fetch = listed([
      { tag_name: 'v0.9.0', draft: false, prerelease: false },
      { tag_name: 'host-v0.3.0', draft: true, prerelease: false },
      { tag_name: 'host-v0.2.1', draft: false, prerelease: true },
      { tag_name: 'host-v0.1.0', draft: false, prerelease: false },
      { tag_name: 'host-v0.1.10', draft: false, prerelease: false },
    ])
    expect(await newestHostVersion({ keys: [], fetch }, signal)).toBe('0.1.10')
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/AltharIDE/althar/releases?per_page=100', expect.anything())
    expect(
      await newestHostVersion({ keys: [], fetch: listed([{ tag_name: 'v0.9.0', draft: false, prerelease: false }]) }, signal),
    ).toBeNull()
  })

  it('reads a release of your own’s version from its manifest', async () => {
    const payload = Buffer.from(JSON.stringify({ format: 1, version: '0.4.0' })).toString('base64url')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ format: 1, keyId: 'k', payload, signature: '' })))
    expect(await newestHostVersion({ keys: [], manifest: 'https://x.test/m.json', fetch }, signal)).toBe('0.4.0')
  })

  it('offers it only once a release past the last without making projects is out', () => {
    expect(LAST_WITHOUT_MAKING_PROJECTS).toBe('0.1.0')
    expect(releaseMakesProjects({ newest: null })).toBe(false)
    expect(releaseMakesProjects({ newest: '0.1.0' })).toBe(false)
    expect(releaseMakesProjects({ newest: '0.0.9' })).toBe(false)
    expect(releaseMakesProjects({ newest: '0.1.1' })).toBe(true)
    expect(releaseMakesProjects({ newest: '0.2.0' })).toBe(true)
    expect(releaseMakesProjects({ newest: '1.0.0' })).toBe(true)
  })
})
