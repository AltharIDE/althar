import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import { doNotTrack } from '../src/main/appPreferences'
import { installOf, usageData, usageEventOf, type UsageDataOptions } from '../src/main/usageData'

/* Anonymous usage data (DEV-76): only named events and properties leave, from the main process, and nothing while the switch is off. */

const profile = () => mkdtempSync(join(tmpdir(), 'althar-usage-'))

const INSTALL = '6f1d3c3e-2b7a-4c55-9a43-2f9c1d6f7e10'

/** PostHog as the sender reaches it: every request it is asked for, answered as PostHog would. */
const posthog = () => {
  const requests: Array<{ readonly url: string; readonly body: unknown }> = []
  const fetch = vi.fn<UsageDataOptions['fetch']>(async (url, options) => {
    const raw = options.body
    const bytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw as Uint8Array)
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString() : bytes.toString()
    requests.push({ url, body: JSON.parse(text) })
    return { status: 200, text: async () => '{}', json: async () => ({}), headers: { get: () => null } }
  })
  return { fetch, requests }
}

const sender = (allowed: () => boolean, fetch: UsageDataOptions['fetch'], key = 'phc_test', more: Partial<UsageDataOptions> = {}) =>
  usageData({
    key,
    host: 'https://us.i.posthog.com',
    installId: INSTALL,
    app: { version: '0.2.0', platform: 'darwin', arch: 'arm64' },
    allowed,
    fetch,
    ...more,
  })

/** The events in what reached PostHog, each as it was sent. */
const sent = (requests: ReadonlyArray<{ readonly body: unknown }>) =>
  requests.flatMap(({ body }) => {
    const batch = (body as { batch?: ReadonlyArray<Record<string, unknown>> }).batch
    return batch ?? [body as Record<string, unknown>]
  })

describe('what usage data may carry', () => {
  it('keeps the events Althar names, with their own properties, each as one it can hold', () => {
    expect(usageEventOf({ name: 'task_started', properties: { as: 'mini', agent: 'claude-code', family: 'opus' } })).toEqual({
      name: 'task_started',
      properties: { as: 'mini', agent: 'claude-code', family: 'opus' },
    })
    expect(usageEventOf({ name: 'app_opened' })).toEqual({ name: 'app_opened', properties: {} })
  })

  it('drops an event it doesn’t name, and any property that isn’t its own or isn’t a count, a word it knows or an id', () => {
    expect(usageEventOf({ name: '$pageview' })).toBeNull()
    expect(usageEventOf({ name: 'toString' })).toBeNull()
    expect(usageEventOf('app_opened')).toBeNull()
    expect(usageEventOf(null)).toBeNull()
    expect(
      usageEventOf({
        name: 'project_made',
        properties: { repositories: 2, name: 'meridian', path: '/Users/ana/Projects/meridian' },
      }),
    ).toEqual({ name: 'project_made', properties: { repositories: 2 } })
    expect(
      usageEventOf({ name: 'task_started', properties: { as: 'Fix the login', agent: '/usr/local/bin/claude', family: 'Opus 5' } }),
    ).toEqual({ name: 'task_started', properties: {} })
    expect(usageEventOf({ name: 'task_settled', properties: { as: 'abandoned', took: 4_200_000, steps: -1 } })).toEqual({
      name: 'task_settled',
      properties: { as: 'abandoned' },
    })
    expect(usageEventOf({ name: 'update_installed', properties: { from: '0.1.0; rm -rf' } })).toEqual({
      name: 'update_installed',
      properties: {},
    })
  })
})

describe('DO_NOT_TRACK', () => {
  it('is set by 1, true or yes, and by nothing else', () => {
    expect(doNotTrack({ DO_NOT_TRACK: '1' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: ' True ' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: 'yes' })).toBe(true)
    expect(doNotTrack({ DO_NOT_TRACK: '0' })).toBe(false)
    expect(doNotTrack({})).toBe(false)
  })
})

describe('sending', () => {
  it('sends nothing at all, not even at start, while the switch is off', async () => {
    const { fetch } = posthog()
    const usage = sender(() => false, fetch)
    usage.record({ name: 'app_opened' })
    usage.record({ name: 'project_made', properties: { repositories: 1 } })
    await usage.stop()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends nothing from a build without PostHog’s key, switch on or not', async () => {
    const { fetch } = posthog()
    const usage = sender(() => true, fetch, '')
    usage.record({ name: 'app_opened' })
    await usage.stop()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks the switch as each event comes: one turned off stops the next', async () => {
    const { fetch, requests } = posthog()
    let on = true
    const usage = sender(() => on, fetch)
    usage.record({ name: 'app_opened' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    on = false
    usage.record({ name: 'project_made', properties: { repositories: 1 } })
    await usage.stop()
    expect(sent(requests).map((event) => event.event)).toEqual(['app_opened'])
  })

  it('sends an event as the install’s id, anonymous, with the app’s version, system and processor and nothing it wasn’t given', async () => {
    const { fetch, requests } = posthog()
    const usage = sender(() => true, fetch)
    usage.record({ name: 'agent_signed_in', properties: { agent: 'codex', email: 'ana@example.com' } })
    usage.record({ name: 'not_an_event' })
    await usage.stop()
    expect(requests.every((request) => request.url.startsWith('https://us.i.posthog.com/'))).toBe(true)
    const [event, ...more] = sent(requests)
    expect(more).toEqual([])
    expect(event).toMatchObject({ event: 'agent_signed_in', distinct_id: INSTALL })
    expect(event?.properties).toMatchObject({
      agent: 'codex',
      $app_version: '0.2.0',
      $os: 'Mac OS X',
      arch: 'arm64',
      $process_person_profile: false,
      $geoip_disable: true,
    })
    expect(JSON.stringify(requests)).not.toContain('ana@example.com')
  })

  it('sends nothing once the switch is off, not a request already being made ready, nor one tried again', async () => {
    const { fetch } = posthog()
    let on = true
    const usage = sender(() => on, fetch)
    usage.record({ name: 'app_opened' })
    // Turned off as the request is made ready.
    on = false
    await usage.stop()
    expect(fetch).not.toHaveBeenCalled()

    // PostHog didn't take the first try; turned off before the next, it never goes.
    on = true
    const failing = vi.fn<UsageDataOptions['fetch']>(async () => {
      on = false
      return { status: 503, text: async () => '', json: async () => ({}), headers: { get: () => null } }
    })
    const retrying = sender(() => on, failing, 'phc_test', { retryDelay: 10 })
    retrying.record({ name: 'app_opened' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await retrying.stop()
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('never fails, even when PostHog can’t be reached', async () => {
    const fetch = vi.fn<UsageDataOptions['fetch']>(async () => {
      throw new Error('offline')
    })
    const usage = sender(() => true, fetch)
    expect(() => usage.record({ name: 'app_opened' })).not.toThrow()
    // Quitting waits for it at most a few seconds.
    await expect(usage.stop()).resolves.toBeUndefined()
  }, 10_000)
})

describe('the install', () => {
  it('gets a random id once and keeps it, beside whatever else the profile’s file holds', async () => {
    const at = profile()
    const first = await installOf(at, '0.1.0')
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.updatedFrom).toBeNull()
    expect(await installOf(at, '0.1.0')).toEqual({ id: first.id, updatedFrom: null })
    await expect(installOf(profile(), '0.1.0')).resolves.not.toMatchObject({ id: first.id })
    expect(JSON.parse(readFileSync(join(at, 'desktop.json'), 'utf8'))).toEqual({ usage: { id: first.id, version: '0.1.0' } })
  })

  it('says an update was installed once, the first time it opens on another version', async () => {
    const at = profile()
    await installOf(at, '0.1.0')
    expect((await installOf(at, '0.2.0')).updatedFrom).toBe('0.1.0')
    expect((await installOf(at, '0.2.0')).updatedFrom).toBeNull()
  })
})
