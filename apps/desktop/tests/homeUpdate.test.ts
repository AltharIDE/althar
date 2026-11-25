import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { LAST_WITHOUT_MAKING_PROJECTS, releaseMakesProjects } from '../src/homes'
import { authenticateRelease, HOST_RELEASE_KEYS, newestHostVersion, type HostRelease } from '../src/main/homes/release'
import { changeOf, homeUpdates, problemOf, updatedFrom } from '../src/main/homes/update'

const ran = (code: number | null, stdout = '', stderr = '') => ({ code, stdout, stderr })
const runner = { id: 'h1', name: 'runner-1', homeId: `home_${'1'.repeat(32)}`, ssh: { target: 'althar@runner-1' } }

// The real, published host manifests for linux-x64, as downloaded from their GitHub releases, authenticated under the pinned key.
const published = (version: string) =>
  authenticateRelease(
    readFileSync(join(__dirname, 'fixtures', `althar-host-${version}-linux-x64.json`)),
    HOST_RELEASE_KEYS,
    'x64',
    Date.parse('2026-11-26T00:00:00Z'),
  )
/** What a home on a release says of itself (`release-info --json`): what its manifest says. */
const infoOf = (release: Pick<HostRelease, 'version' | 'apiVersion' | 'storage'>) =>
  JSON.stringify({
    version: release.version,
    updaterProtocol: 1,
    apiVersion: release.apiVersion,
    storage: release.storage,
    platform: 'linux',
    arch: 'x64',
  })
const sameData = { ...published('0.1.0'), version: '0.1.1' }
/** A home on 0.1.0: asked what it runs, it says; asked to update, `update` answers. */
const homeOn = (update: () => Promise<ReturnType<typeof ran>>, info = infoOf(published('0.1.0'))) =>
  vi.fn(async (_program: string, args: ReadonlyArray<string>) =>
    (args.at(-1) ?? '').includes('release-info') ? ran(0, `${info}\n`) : update(),
  )
const updatesOf = (call: (args: ReadonlyArray<string>) => boolean) => (run: ReturnType<typeof homeOn>) =>
  run.mock.calls.filter(([, args]) => call(args)).length
const updateCalls = updatesOf((args) => (args.at(-1) ?? '').includes(' update --apply'))

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
      'The update changes how runner-1 stores its data, and Althar couldn’t look at it first. Try again.',
    )
    expect(() => updatedFrom(ran(null), 'runner-1')).toThrow(/took too long/)
  })

  it('runs the home’s own update over the SSH its connection uses, once for each home however often it’s asked', async () => {
    let finish: (value: ReturnType<typeof ran>) => void = () => {}
    const run = homeOn(() => new Promise<ReturnType<typeof ran>>((resolve) => (finish = resolve)))
    const latest = vi.fn(async () => sameData)
    const updates = homeUpdates({ run, program: '/app/bin/althar-host-ssh', latest, signal: new AbortController().signal })
    const first = updates.update(runner)
    const second = updates.update(runner)
    await vi.waitFor(() => expect(updateCalls(run)).toBe(1))
    // The ssh the window's connection runs, as given: here the Flatpak's; first asked what it runs.
    expect(run.mock.calls.map(([program]) => program)).toEqual(['/app/bin/althar-host-ssh', '/app/bin/althar-host-ssh'])
    expect(run.mock.calls[0]?.[1].at(-1)).toContain('release-info --json')
    expect(run.mock.calls[1]?.[1].at(-1)).toContain('update --apply --wait --json')
    expect(latest).toHaveBeenCalledWith('x64', expect.anything())
    finish(ran(0, '{"state":"applied"}'))
    await expect(first).resolves.toEqual({ state: 'applied' })
    await expect(second).resolves.toEqual({ state: 'applied' })
    // Done, the next ask runs again, the newest release's manifest kept from the last.
    void updates.update(runner).catch(() => undefined)
    await vi.waitFor(() => expect(updateCalls(run)).toBe(2))
    expect(latest).toHaveBeenCalledOnce()
  })

  it('asks before 0.1.0 → 0.2.0, which moves the data, and then lets the home’s updater apply it', async () => {
    const [from, to] = [published('0.1.0'), published('0.2.0')]
    // The published pair: one API, two storage formats.
    expect([from.apiVersion, to.apiVersion]).toEqual([1, 1])
    expect(from.storage).not.toBe(to.storage)
    expect(changeOf(from, to, 1)).toEqual({ from: '0.1.0', to: '0.2.0', change: 'data' })

    const run = homeOn(async () => ran(0, '{"state":"applied","version":"0.2.0"}'))
    const updates = homeUpdates({
      run,
      program: '/usr/bin/ssh',
      latest: async () => to,
      signal: new AbortController().signal,
      apiVersion: 1,
    })
    expect(await updates.check(runner)).toEqual({ from: '0.1.0', to: '0.2.0', change: 'data' })
    // Not accepted: nothing runs on the home but the look.
    expect(await updates.update(runner)).toEqual({ state: 'confirm', check: { from: '0.1.0', to: '0.2.0', change: 'data' } })
    // Accepted for another release: asked again.
    expect((await updates.update(runner, '0.1.9')).state).toBe('confirm')
    expect(updateCalls(run)).toBe(0)
    // Accepted: the home's own updater, told the change is approved.
    expect(await updates.update(runner, '0.2.0')).toEqual({ state: 'applied', version: '0.2.0' })
    const applied = run.mock.calls.at(-1)?.[1].at(-1)
    expect(applied).toContain('update --apply --allow-incompatible --wait --json')
  })

  it('never approves a release of an API this app doesn’t speak, and says what to do', async () => {
    const newer = { ...published('0.2.0'), version: '0.3.0', apiVersion: 2 }
    const run = homeOn(async () => ran(0, '{"state":"applied"}'))
    const updates = homeUpdates({
      run,
      program: '/usr/bin/ssh',
      latest: async () => newer,
      signal: new AbortController().signal,
      apiVersion: 1,
    })
    expect((await updates.check(runner)).change).toBe('api')
    await expect(updates.update(runner, '0.3.0')).rejects.toThrow(
      'Althar 0.3.0 for runner-1 needs a newer Althar app. Update this app first, then runner-1.',
    )
    expect(updateCalls(run)).toBe(0)
    // A release no newer than what it runs changes nothing.
    expect(changeOf({ version: '0.3.0', apiVersion: 1, storage: 'a' }, newer, 1).change).toBe('none')
  })

  it('updates as it would where it can’t look first, and the home’s refusal says to try again', async () => {
    const run = homeOn(async () => ran(1, '', 'This release changes the API or stored-data format. Apply it explicitly.\n'))
    const log = vi.fn()
    const updates = homeUpdates({
      run,
      program: '/usr/bin/ssh',
      latest: async () => Promise.reject(new Error('offline')),
      signal: new AbortController().signal,
      log,
    })
    await expect(updates.update(runner)).rejects.toThrow(
      'The update changes how runner-1 stores its data, and Althar couldn’t look at it first. Try again.',
    )
    expect(run.mock.calls.at(-1)?.[1].at(-1)).toContain('update --apply --wait --json')
    expect(log).toHaveBeenCalledWith('What updating runner-1 changes couldn’t be found out: offline')
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
    const answers = vi
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(ran(0, '{"state":"current","version":"0.1.0"}'))
    const run = homeOn(answers)
    const latest = async () => sameData
    const log = vi.fn()
    const updates = homeUpdates({ run, program: '/usr/bin/ssh', latest, signal: new AbortController().signal, log })
    // Through, it says what the home found: nothing newer.
    await expect(updates.update(runner)).rejects.toThrow('There’s no newer Althar for runner-1 yet.')
    expect(answers).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Updating runner-1 stopped (exit 1): The host update could not be downloaded completely.'),
    )

    // Three times at most, then its line.
    const always = vi.fn(async () => failed)
    const again = homeUpdates({ run: homeOn(always), program: '/usr/bin/ssh', latest, signal: new AbortController().signal })
    await expect(again.update(runner)).rejects.toThrow('runner-1 couldn’t download the update.')
    expect(always).toHaveBeenCalledTimes(3)

    // What trying again won't change is said at once.
    const other = vi.fn(async () => ran(1, '', 'An update or recovery transaction owns this installation.'))
    await expect(
      homeUpdates({ run: homeOn(other), program: '/usr/bin/ssh', latest, signal: new AbortController().signal }).update(runner),
    ).rejects.toThrow('An update or recovery transaction owns this installation.')
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
