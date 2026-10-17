import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import {
  childKind,
  type CrashReportsOptions,
  crashReports,
  dumpKind,
  exceptionsOf,
  fingerprintOf,
  goneBadly,
  LONGEST_VALUE,
  MOST_A_LAUNCH,
  newDumps,
  runtimeThrown,
  thrownOf,
  wholePath,
  windowThrown,
} from '../src/main/crashReports'
import { masker } from '../src/logs/mask'
import { crashOf, watchCrashes } from '../src/runtime/crashes'

/* Crash reports (DEV-66): masked $exception events from the main process, behind their own switch, twenty a launch, each once. */

const INSTALL = '6f1d3c3e-2b7a-4c55-9a43-2f9c1d6f7e10'
const HOME = '/Users/ana'
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

/** The person, as a report hides them: their home, their name, this Mac, and a repository called meridian. */
const mask = () => masker({ home: HOME, user: 'ana', device: 'anas-mac.local', names: { repository: ['meridian'], project: ['Checkout'] } })

/** PostHog as the sender reaches it: every request it is asked for, answered as PostHog would. */
const posthog = () => {
  const requests: Array<{ readonly url: string; readonly body: unknown }> = []
  const fetch = vi.fn<CrashReportsOptions['fetch']>(async (url, options) => {
    const raw = options.body
    const bytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw as Uint8Array)
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString() : bytes.toString()
    requests.push({ url, body: JSON.parse(text) })
    return { status: 200, text: async () => '{}', json: async () => ({}), headers: { get: () => null } }
  })
  return { fetch, requests }
}

const sender = (allowed: () => boolean, fetch: CrashReportsOptions['fetch'], more: Partial<CrashReportsOptions> = {}) =>
  crashReports({
    key: 'phc_test',
    host: 'https://us.i.posthog.com',
    installId: INSTALL,
    app: { version: '0.3.0', platform: 'darwin', arch: 'arm64' },
    allowed,
    fetch,
    mask,
    ...more,
  })

interface Sent {
  readonly event: string
  readonly distinct_id: string
  readonly timestamp?: string
  readonly properties: Record<string, unknown> & {
    readonly $exception_list: ReadonlyArray<{
      readonly type: string
      readonly value: string
      readonly mechanism: Record<string, unknown>
      readonly stacktrace?: { readonly frames: ReadonlyArray<Record<string, unknown>> }
    }>
  }
}

/** The events in what reached PostHog, each as it was sent. */
const sent = (requests: ReadonlyArray<{ readonly body: unknown }>): ReadonlyArray<Sent> =>
  requests.flatMap(({ body }) => (body as { batch?: ReadonlyArray<Sent> }).batch ?? [body as Sent])

/** An error thrown in the person's own repository, with a token in its message, as a library might say it. */
const theirs = () => {
  const error = new TypeError(`Couldn’t read ${HOME}/Projects/meridian/.env with ${TOKEN}`)
  error.stack = [
    `TypeError: Couldn’t read ${HOME}/Projects/meridian/.env with ${TOKEN}`,
    `    at readSettings (${HOME}/Projects/meridian/src/settings.js:12:7)`,
    '    at open (/Applications/Althar.app/Contents/Resources/app/dist/main/main.js:420:15)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
  ].join('\n')
  return error
}

describe('the switch', () => {
  it('sends nothing at all, and makes no client, while it is off or DO_NOT_TRACK is set', async () => {
    const { fetch } = posthog()
    const off = sender(() => false, fetch)
    off.thrown(new Error('boom'), 'main', 'uncaught')
    off.fromWindow({ kind: 'error', message: 'x', stack: '' })
    off.fromRuntime({ how: 'uncaught', name: 'Error', message: 'y', stack: '' })
    off.gone('window', { reason: 'crashed', exitCode: 5 })
    off.keepsStopping(4, 1)
    off.native({ process: 'gpu', at: new Date() })
    await off.stop()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends nothing from a build without PostHog’s key', async () => {
    const { fetch } = posthog()
    const keyless = sender(() => true, fetch, { key: '' })
    keyless.thrown(new Error('boom'), 'main', 'uncaught')
    await keyless.stop()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops a report already being made ready once it is turned off', async () => {
    const { fetch } = posthog()
    let on = true
    const turning = sender(() => on, fetch)
    turning.thrown(new Error('boom'), 'main', 'uncaught')
    on = false
    await turning.stop()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never fails into what failed, even when PostHog can’t be reached or masking breaks', async () => {
    const offline = vi.fn<CrashReportsOptions['fetch']>(async () => {
      throw new Error('offline')
    })
    const reports = sender(() => true, offline)
    expect(() => reports.thrown(new Error('boom'), 'main', 'uncaught')).not.toThrow()
    await expect(reports.stop()).resolves.toBeUndefined()

    const { fetch } = posthog()
    const broken = sender(() => true, fetch, {
      mask: () => {
        throw new Error('no store')
      },
    })
    broken.thrown(new Error('boom'), 'main', 'uncaught')
    await broken.stop()
    // Unmasked, it never goes.
    expect(fetch).not.toHaveBeenCalled()
  }, 10_000)
})

describe('what a report carries', () => {
  it('sends main’s own as an $exception from the install, anonymous, tagged with the version as its release, and nothing else', async () => {
    const { fetch, requests } = posthog()
    const reports = sender(() => true, fetch)
    reports.thrown(theirs(), 'main', 'uncaught')
    await reports.stop()
    const [event, ...more] = sent(requests)
    expect(more).toEqual([])
    expect(event).toMatchObject({ event: '$exception', distinct_id: INSTALL })
    expect(Object.keys(event?.properties ?? {}).sort()).toEqual(
      [
        '$app_version',
        '$exception_level',
        '$exception_list',
        '$geoip_disable',
        '$is_server',
        '$lib',
        '$lib_version',
        '$os',
        '$process_person_profile',
        'arch',
        'process',
        'release',
      ].sort(),
    )
    expect(event?.properties).toMatchObject({
      process: 'main',
      release: '0.3.0',
      $app_version: '0.3.0',
      $os: 'Mac OS X',
      arch: 'arm64',
      $exception_level: 'error',
      $process_person_profile: false,
      $geoip_disable: true,
    })
    const [exception] = event?.properties.$exception_list ?? []
    expect(exception).toMatchObject({ type: 'TypeError', mechanism: { type: 'uncaught', handled: false, synthetic: false } })
    expect(exception?.stacktrace?.frames.map((frame) => frame.function)).toEqual([
      'process.processTicksAndRejections',
      'open',
      'readSettings',
    ])
  })

  it('hides home paths, repository names and tokens in the message and every frame, and sends no lines of source', async () => {
    const { fetch, requests } = posthog()
    const reports = sender(() => true, fetch)
    reports.thrown(theirs(), 'main', 'uncaught')
    // Thrown here, where PostHog could read this file's lines round it, with a cause.
    reports.thrown(
      new RangeError(`Out of range in ${HOME}/code/meridian`, { cause: new Error(`Can't open ${HOME}/x`) }),
      'main',
      'uncaught',
    )
    reports.thrown('words alone', 'main', 'rejection')
    await reports.stop()
    const events = sent(requests)
    expect(events).toHaveLength(3)
    const chained = events.find((event) => event.properties.$exception_list[0]?.type === 'RangeError')
    expect(chained?.properties.$exception_list.map((exception) => exception.value)).toEqual([
      'Out of range in ~/…/[repository-1]',
      "Can't open ~/x",
    ])
    expect(
      events.find((event) => event.properties.$exception_list[0]?.value === 'words alone')?.properties.$exception_list[0]?.stacktrace,
    ).toBeUndefined()
    const words = JSON.stringify(events)
    for (const hidden of [HOME, 'meridian', TOKEN, 'ana']) expect(words).not.toContain(hidden)
    expect(events.find((event) => event.properties.$exception_list[0]?.type === 'TypeError')?.properties.$exception_list[0]?.value).toBe(
      'Couldn’t read ~/…/.env with [secret]',
    )
    const frames = events.flatMap((event) => event.properties.$exception_list.flatMap((exception) => exception.stacktrace?.frames ?? []))
    expect(frames.find((frame) => frame.function === 'readSettings')).toMatchObject({ filename: '~/…/settings.js', lineno: 12, colno: 7 })
    expect(frames.find((frame) => frame.function === 'open')?.filename).toBe(
      '/Applications/Althar.app/Contents/Resources/app/dist/main/main.js',
    )
    expect(frames.length).toBeGreaterThan(3)
    for (const frame of frames) {
      expect(
        Object.keys(frame).filter((key) => !['platform', 'filename', 'abs_path', 'function', 'lineno', 'colno', 'in_app'].includes(key)),
      ).toEqual([])
    }
    expect(words).not.toMatch(/context_line|pre_context|post_context|"vars"/)
  })

  it('sends the window’s as it sent them for the log, named from its stack, a rejection as one', async () => {
    const { fetch, requests } = posthog()
    const reports = sender(() => true, fetch)
    reports.fromWindow({
      kind: 'rejection',
      message: 'Cannot read properties of undefined',
      stack:
        'TypeError: Cannot read properties of undefined\n    at render (file:///Applications/Althar.app/Contents/Resources/app/dist/renderer/assets/index-3f9c.js:1:2345)',
    })
    reports.fromWindow({ kind: 'error', message: 'Script error.', stack: '', source: ':0:0' })
    reports.fromWindow('not a report')
    await reports.stop()
    // Each request goes as it is ready: the rejection's is the one with a stack.
    const events = [...sent(requests)].sort((a, b) =>
      b.properties.$exception_list[0]!.type.localeCompare(a.properties.$exception_list[0]!.type),
    )
    expect(events.map((event) => event.properties.process)).toEqual(['window', 'window'])
    expect(events[0]?.properties.$exception_list[0]).toMatchObject({ type: 'TypeError', mechanism: { type: 'rejection', handled: false } })
    expect(events[0]?.properties.$exception_list[0]?.stacktrace?.frames[0]).toMatchObject({ function: 'render', lineno: 1, colno: 2345 })
    // With no stack of its own, PostHog's made-up one, from where it was caught, never goes.
    expect(events[1]?.properties.$exception_list[0]).toMatchObject({
      type: 'Error',
      value: 'Script error.',
      mechanism: { synthetic: true },
    })
    expect(events[1]?.properties.$exception_list[0]?.stacktrace).toBeUndefined()
  })

  it('sends the runtime’s, as its parent port says them, masked with the names as the runtime says them', async () => {
    const { fetch, requests } = posthog()
    // The names come from the runtime, which holds the store: the mask is made once they are asked.
    const reports = sender(() => true, fetch, { mask: async () => mask() })
    const told: Array<unknown> = []
    const listeners: Record<string, (thrown: unknown) => void> = {}
    const watching = watchCrashes(
      (message) => told.push(message),
      { on: (event: string, listener: (thrown: unknown) => void) => void (listeners[event] = listener) } as never,
      () => undefined,
    )
    listeners.uncaughtExceptionMonitor?.(new SyntaxError('Unexpected token'))
    listeners.unhandledRejection?.('the store went away')
    watching.defect(new Error('SessionFailed in meridian'))
    for (const message of told) reports.fromRuntime((message as { crash: unknown }).crash)
    reports.fromRuntime(null)
    await reports.stop()
    const events = sent(requests)
    expect(events).toHaveLength(3)
    expect(
      events.map((event) => [
        event.properties.process,
        event.properties.$exception_list[0]?.type,
        event.properties.$exception_list[0]?.mechanism.type,
        event.properties.$exception_level,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['runtime', 'SyntaxError', 'uncaught', 'error'],
        ['runtime', 'Error', 'rejection', 'error'],
        ['runtime', 'Error', 'defect', 'fatal'],
      ]),
    )
    expect(JSON.stringify(events)).toContain('SessionFailed in [repository-1]')
  })

  it('sends a process gone, the runtime that keeps stopping and a native crash as exceptions of their own, with no stack', async () => {
    const { fetch, requests } = posthog()
    const reports = sender(() => true, fetch)
    const at = new Date('2026-10-16T09:30:00.000Z')
    reports.gone('window', { reason: 'crashed', exitCode: 5 })
    reports.gone(childKind({ type: 'Utility', name: 'Althar runtime' }), { reason: 'abnormal-exit', exitCode: 256 })
    reports.keepsStopping(4, 1)
    reports.native({ process: 'gpu', at })
    await reports.stop()
    const events = sent(requests)
    expect(
      events.map((event) => [
        event.properties.process,
        event.properties.$exception_list[0]?.type,
        event.properties.$exception_list[0]?.value,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['window', 'Process gone', 'The window process stopped: crashed, exit code 5.'],
        ['runtime', 'Process gone', 'The runtime process stopped: abnormal-exit, exit code 256.'],
        ['runtime', 'Runtime keeps stopping', 'The runtime stopped 4 times in a minute, the last with exit code 1; Althar quit.'],
        ['gpu', 'Native crash', 'The gpu process crashed; its minidump stays on this computer.'],
      ]),
    )
    expect(events).toHaveLength(4)
    for (const event of events) expect(event.properties.$exception_list[0]?.stacktrace).toBeUndefined()
    expect(events.every((event) => event.properties.$exception_level === 'fatal')).toBe(true)
    // When it crashed, not when it was said.
    expect(events.find((event) => event.properties.process === 'gpu')?.timestamp).toBe(at.toISOString())
  })

  it('makes a frame’s file whole again before masking it, where PostHog made it relative to where Althar started', () => {
    expect(wholePath('Users/ana/Projects/meridian/a.js', '/')).toBe('/Users/ana/Projects/meridian/a.js')
    expect(wholePath('../../Users/ana/a.js', '/Applications/Althar.app')).toBe('/Users/ana/a.js')
    expect(mask()(wholePath('Users/ana/Projects/meridian/a.js', '/'))).toBe('~/…/a.js')
    for (const kept of [
      'node:internal/timers',
      '<anonymous>',
      'file:///Users/ana/a.js',
      '/opt/Althar/main.js',
      'C:\\Users\\ana\\a.js',
      'main.js',
    ])
      expect(wholePath(kept, '/')).toBe(kept)
  })

  it('reports a process that crashed or failed, not one that exited cleanly or that Althar stopped', () => {
    for (const reason of ['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure']) expect(goneBadly(reason)).toBe(true)
    for (const reason of ['clean-exit', 'killed', 'memory-eviction']) expect(goneBadly(reason)).toBe(false)
  })

  it('names a child process by what it is', () => {
    expect(childKind({ type: 'Utility', name: 'Althar runtime' })).toBe('runtime')
    expect(childKind({ type: 'Utility', name: 'Althar speech' })).toBe('utility')
    expect(childKind({ type: 'GPU' })).toBe('gpu')
    expect(childKind({ type: 'Zygote' })).toBe('unknown')
  })
})

describe('how many', () => {
  it('sends the same one once a launch, and twenty at most', async () => {
    const { fetch, requests } = posthog()
    const reports = sender(() => true, fetch)
    for (let i = 0; i < 3; i += 1) reports.thrown(theirs(), 'main', 'uncaught')
    for (let i = 0; i < 40; i += 1) reports.gone('window', { reason: 'crashed', exitCode: i })
    await reports.stop()
    const events = sent(requests)
    expect(events).toHaveLength(MOST_A_LAUNCH)
    expect(events.filter((event) => event.properties.$exception_list[0]?.type === 'TypeError')).toHaveLength(1)
  })

  it('tells two apart by type and where they were thrown, or by what they say where they have no frames', () => {
    const one = exceptionsOf(
      [
        {
          type: 'TypeError',
          value: 'a',
          stacktrace: {
            frames: [
              { function: 'x', filename: 'main.js', lineno: 1, in_app: true },
              { function: 'node', in_app: false },
            ],
          },
        },
      ],
      (t) => t,
    )
    const other = exceptionsOf(
      [{ type: 'TypeError', value: 'b', stacktrace: { frames: [{ function: 'x', filename: 'main.js', lineno: 1, in_app: true }] } }],
      (t) => t,
    )
    expect(fingerprintOf(one)).toBe(fingerprintOf(other))
    expect(fingerprintOf(exceptionsOf([{ type: 'E', value: 'v' }], (t) => t))).toBe('E|v')
    expect(fingerprintOf([])).toBe('')
  })

  it('cuts a long message, and keeps a chain to five', () => {
    const [long] = exceptionsOf([{ type: 'Error', value: 'x'.repeat(5_000) }], (t) => t)
    expect(String(long?.value)).toHaveLength(LONGEST_VALUE)
    expect(
      exceptionsOf(
        Array.from({ length: 9 }, () => ({ type: 'E', value: 'v' })),
        (t) => t,
      ),
    ).toHaveLength(5)
    expect(exceptionsOf('not a list', (t) => t)).toEqual([])
  })
})

describe('what crosses between processes', () => {
  it('reads the window’s and the runtime’s reports, and nothing else', () => {
    expect(windowThrown({ kind: 'error', message: 'm', stack: 'RangeError: m\n    at f (a.js:1:1)' })).toMatchObject({
      how: 'uncaught',
      thrown: { name: 'RangeError' },
    })
    expect(windowThrown({ kind: 'error', message: 'm', stack: '' })?.thrown.name).toBe('Error')
    expect(
      windowThrown({ kind: 'error', message: 'Uncaught TypeError: x is null', stack: 'TypeError: x is null\n    at f (a.js:1:1)' })?.thrown,
    ).toMatchObject({
      name: 'TypeError',
      message: 'x is null',
    })
    expect(windowThrown({ kind: 'error', message: 'Uncaught nope', stack: '' })?.thrown.message).toBe('nope')
    expect(windowThrown({ message: 3 })).toBeNull()
    expect(runtimeThrown({ how: 'defect', name: '', message: 'm' })).toEqual({
      how: 'defect',
      thrown: { name: 'Error', message: 'm', stack: '' },
    })
    expect(runtimeThrown({ how: 'other', message: 'm' })?.how).toBe('uncaught')
    expect(runtimeThrown([])).toBeNull()
  })

  it('says what was thrown, an error or not, without throwing itself', () => {
    expect(thrownOf('just words')).toEqual({ name: 'Error', message: 'just words', stack: '' })
    const odd = {
      toString: () => {
        throw new Error('no')
      },
    }
    expect(thrownOf(odd).message).toBe('object')
    expect(crashOf('rejection', odd)).toMatchObject({ how: 'rejection', message: 'object' })
    expect(crashOf('uncaught', new Error('e'))).toMatchObject({ name: 'Error', message: 'e', stack: expect.stringContaining('Error: e') })
  })

  it('warns of a rejection on stderr as Node would have, and a port gone never throws', () => {
    const listeners: Record<string, (thrown: unknown) => void> = {}
    const warned: Array<string> = []
    watchCrashes(
      () => {
        throw new Error('port closed')
      },
      { on: (event: string, listener: (thrown: unknown) => void) => void (listeners[event] = listener) } as never,
      (line) => warned.push(line),
    )
    expect(() => listeners.unhandledRejection?.(new Error('lost'))).not.toThrow()
    expect(() => listeners.unhandledRejection?.('words')).not.toThrow()
    expect(warned[0]).toMatch(/^Unhandled rejection: Error: lost\n {4}at /)
    expect(warned[1]).toBe('Unhandled rejection: Error: words\n')
  })
})

/** A minidump as Crashpad writes one, as far as its process goes: the `ptype` annotation among other bytes. */
const dump = (kind: string | null) => {
  const string = (words: string) => {
    const bytes = Buffer.from(`${words}\0`)
    const padded = Buffer.alloc(4 + Math.ceil(bytes.length / 4) * 4)
    padded.writeUInt32LE(words.length, 0)
    bytes.copy(padded, 4)
    return padded
  }
  return Buffer.concat([
    Buffer.from('MDMP'),
    Buffer.alloc(64, 7),
    ...(kind === null ? [] : [string('ptype'), string(kind)]),
    string('platform'),
    string('darwin'),
  ])
}

describe('native crashes', () => {
  it('reads which process a minidump is from', () => {
    expect(dumpKind(dump('renderer'))).toBe('window')
    expect(dumpKind(dump('browser'))).toBe('main')
    expect(dumpKind(dump('gpu-process'))).toBe('gpu')
    expect(dumpKind(dump('utility'))).toBe('utility')
    expect(dumpKind(dump('zygote'))).toBe('unknown')
    expect(dumpKind(dump(null))).toBe('unknown')
  })

  it('says each new minidump once, oldest first, whatever the switch, and leaves the dumps where they are', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-dumps-'))
    const profile = mkdtempSync(join(tmpdir(), 'althar-profile-'))
    mkdirSync(join(folder, 'pending'))
    mkdirSync(join(folder, 'completed'))
    writeFileSync(join(folder, 'pending', 'a1.dmp'), dump('renderer'))
    writeFileSync(join(folder, 'completed', 'b2.dmp'), dump('gpu-process'))
    writeFileSync(join(folder, 'pending', 'a1.meta'), 'not a dump')
    utimesSync(join(folder, 'pending', 'a1.dmp'), new Date('2026-10-16T10:00:00Z'), new Date('2026-10-16T10:00:00Z'))
    utimesSync(join(folder, 'completed', 'b2.dmp'), new Date('2026-10-15T10:00:00Z'), new Date('2026-10-15T10:00:00Z'))
    const first = await newDumps(folder, profile)
    expect(first).toEqual([
      { id: 'b2', process: 'gpu', at: new Date('2026-10-15T10:00:00Z') },
      { id: 'a1', process: 'window', at: new Date('2026-10-16T10:00:00Z') },
    ])
    expect(await newDumps(folder, profile)).toEqual([])
    writeFileSync(join(folder, 'completed', 'c3.dmp'), dump('browser'))
    expect((await newDumps(folder, profile)).map((one) => [one.id, one.process])).toEqual([['c3', 'main']])
    expect(
      readFileSync(join(folder, 'pending', 'a1.dmp'))
        .subarray(0, 4)
        .toString(),
    ).toBe('MDMP')
    expect(JSON.parse(readFileSync(join(profile, 'desktop.json'), 'utf8')).crashDumps.seen.sort()).toEqual(['a1', 'b2', 'c3'])
    // No folder at all: nothing, and no failure.
    expect(await newDumps(join(folder, 'none'), profile)).toEqual([])
  })
})
