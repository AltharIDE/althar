import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

import { type EventMessage, PostHog, type PostHogOptions } from 'posthog-node'

import { readPreferences, writePreference } from './preferences'

/*
 * Crash reports (Linear DEV-66, ADR-046): what failed in Althar and where in
 * its code, sent to PostHog's error tracking from the main process alone,
 * as `$exception` events, while the person's own switch for them is on. They
 * come from main's own uncaught errors and rejections, the window's (as it
 * already sends them for the log), the runtime's (over its parent port), a
 * process of Althar's that stops abnormally, the runtime stopping too often
 * to start again, and a native crash, said once on the launch after it:
 * Crashpad keeps its minidump on this computer, and only that it happened,
 * when, and in which process, ever leaves. And, as handled, what the runtime
 * kept to what it belonged to and carried on past (ADR-047): a call from the
 * window that failed for no reason of the person's, a part of one, an agent
 * that stopped on its own; each by Althar's name for where it was.
 *
 * Before anything goes, every word of it is masked as a problem report is
 * (logs/mask.ts): paths under the home folder, the projects' and
 * repositories' names, who the person is on this computer, emails, and
 * anything like a key or a token. The lines of source PostHog's client reads
 * round each frame never leave, nor anything else it would add: an event
 * carries only the exceptions, their frames' places, their level, which
 * process and where in it, the app's version (as its release), the system
 * and the processor. At most twenty crashes and ten handled failures go a
 * launch, and the same one in the same place once. Like usage
 * data, it is anonymous (the install's random id, no person profile, no
 * GeoIP), nothing is sent while the switch is off, with DO_NOT_TRACK set, or
 * from a build without PostHog's key, and a report that can't go is dropped.
 */

/** Which of Althar's processes failed, as a report names it. */
export const PROCESSES = ['main', 'window', 'runtime', 'gpu', 'utility', 'unknown'] as const
export type CrashProcess = (typeof PROCESSES)[number]

/**
 * How it came: thrown and not caught, a rejection nobody handled, a defect
 * the runtime stopped on, a process gone, a native crash; or handled, a
 * failure the runtime kept to what it belonged to and carried on past
 * (ADR-047), as a call from the window that failed for no reason of the
 * person's, or an agent that stopped on its own.
 */
export type CrashHow = 'uncaught' | 'rejection' | 'defect' | 'gone' | 'native' | 'handled'

/** The most reports a launch sends. */
export const MOST_A_LAUNCH = 20
/** The most handled failures a launch sends, counted apart, so they never crowd out a crash. */
export const MOST_HANDLED = 10
/** The most reports a launch even makes ready, duplicates included, so a storm of errors costs little. */
const MOST_ASKED = MOST_A_LAUNCH * 5
/** The longest a message goes, in characters. */
export const LONGEST_VALUE = 1_000
/** The longest a name goes: a type, a function, a file. */
const LONGEST_NAME = 300
/** The most frames an exception keeps, nearest where it was thrown. */
const MOST_FRAMES = 50
/** The most exceptions in one report: the error and its causes. */
const MOST_CHAINED = 5

/** The system, as PostHog's own SDKs name it. */
const SYSTEMS: Readonly<Record<string, string>> = { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')

/** Something thrown, as one process tells another: its name, its message and its stack, each a string of sane length. */
export interface Thrown {
  readonly name: string
  readonly message: string
  readonly stack: string
}

/** What was thrown, as words: an error's own, or what anything else says it is. */
export const thrownOf = (thrown: unknown): Thrown => {
  if (thrown instanceof Error)
    return { name: text(thrown.name, LONGEST_NAME) || 'Error', message: text(thrown.message, 4_000), stack: text(thrown.stack, 16_000) }
  let words: string
  try {
    words = String(thrown)
  } catch {
    words = typeof thrown
  }
  return { name: 'Error', message: words.slice(0, 4_000), stack: '' }
}

/** An error from what another process said, with its own stack; one with none has no frames to send. */
const errorFrom = ({ name, message, stack }: Thrown): Error => {
  const error = new Error(message)
  error.name = name
  error.stack = stack
  return error
}

/** The name a stack says first, `TypeError: …`, as the window's reports carry no name of their own. */
const nameIn = (stack: string) => /^([A-Za-z_$][\w$.]{0,80}):\s/.exec(stack)?.[1] ?? 'Error'

/** What the window sent for the log, as something thrown; null for anything that isn't one. */
export const windowThrown = (report: unknown): { readonly how: CrashHow; readonly thrown: Thrown } | null => {
  if (!isRecord(report) || typeof report.message !== 'string') return null
  const stack = text(report.stack, 16_000)
  const name = nameIn(stack)
  // Chromium says an error event's message as `Uncaught TypeError: …`; the type is said apart.
  const message = text(report.message, 4_000).replace(new RegExp(`^Uncaught (?:${name.replace(/[.$]/g, '\\$&')}: )?`), '')
  return { how: report.kind === 'rejection' ? 'rejection' : 'uncaught', thrown: { name, message, stack } }
}

/** Where in Althar a handled failure was, and whose: Althar's own names for them, kept only as such. */
export interface Place {
  /** A call from the window (`Status`), or a part of one (`Status.account`), or `agent`. */
  readonly where?: string
  /** An agent's id: claude-code, codex. */
  readonly agent?: string
}

/** The place a report names, keeping only words shaped as Althar's own names: never a path, a title or anything written. */
export const placeOf = (report: unknown): Place => {
  if (!isRecord(report)) return {}
  const where = typeof report.where === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}(?:\.[A-Za-z][A-Za-z0-9]{0,31})?$/.test(report.where)
  const agent = typeof report.agent === 'string' && /^[a-z0-9][a-z0-9.-]{0,39}$/.test(report.agent)
  return { ...(where ? { where: report.where as string } : {}), ...(agent ? { agent: report.agent as string } : {}) }
}

/** What the runtime said it couldn't handle (runtime/crashes.ts), or kept and carried on past (Failures), as something thrown; null for anything else. */
export const runtimeThrown = (report: unknown): { readonly how: CrashHow; readonly thrown: Thrown; readonly place: Place } | null => {
  if (!isRecord(report) || typeof report.message !== 'string') return null
  const how: CrashHow =
    report.how === 'rejection' ? 'rejection' : report.how === 'defect' ? 'defect' : report.how === 'handled' ? 'handled' : 'uncaught'
  return {
    how,
    thrown: { name: text(report.name, LONGEST_NAME) || 'Error', message: text(report.message, 4_000), stack: text(report.stack, 16_000) },
    place: placeOf(report),
  }
}

/**
 * Whether a process stopped in a way worth a report, by Electron's reason:
 * it crashed, ran out of memory, exited with an error, or couldn't start.
 * Not a clean exit, nor one killed, as Althar kills its own (the speech
 * process when dictation is idle, the runtime as it quits), nor a page the
 * system evicted for memory.
 */
export const goneBadly = (reason: string): boolean =>
  ['crashed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure'].includes(reason)

/** The process a child of Electron's is, as `child-process-gone` says: the runtime by its name, else its kind. */
export const childKind = (details: { readonly type?: string; readonly name?: string }): CrashProcess =>
  details.name === 'Althar runtime' ? 'runtime' : details.type === 'GPU' ? 'gpu' : details.type === 'Utility' ? 'utility' : 'unknown'

/* ---- what may leave -------------------------------------------------------------- */

type Mask = (text: string) => string

/**
 * A file as it was, absolute: PostHog's client makes a frame's file relative
 * to where the process started, `/` in a packaged app, which would leave a
 * home folder as `Users/ana/…`, past what the masker knows; it is made whole
 * again first. A URL, Node's own (`node:`) and `<anonymous>` stay as they are.
 */
export const wholePath = (file: string, cwd: string): string =>
  /^(?:[a-z][\w+.-]*:|<)/i.test(file) || isAbsolute(file) || !/[\\/]/.test(file) ? file : resolve(cwd, file)

/** A frame's place, masked, and nothing else: no lines of source, no variables, no module path. */
const frameOf = (frame: unknown, mask: Mask, cwd: string): Record<string, unknown> | null => {
  if (!isRecord(frame)) return null
  const kept: Record<string, unknown> = {}
  for (const key of ['platform', 'filename', 'abs_path', 'function'] as const) {
    const value = frame[key]
    if (typeof value === 'string')
      kept[key] = mask(key === 'filename' || key === 'abs_path' ? wholePath(value, cwd) : value).slice(0, LONGEST_NAME)
  }
  for (const key of ['lineno', 'colno'] as const) {
    const value = frame[key]
    if (typeof value === 'number' && Number.isFinite(value)) kept[key] = value
  }
  if (typeof frame.in_app === 'boolean') kept.in_app = frame.in_app
  if (typeof frame.chunk_id === 'string' && /^[\w-]{1,64}$/.test(frame.chunk_id)) kept.chunk_id = frame.chunk_id
  return kept
}

/** An exception, masked: its type and message, how it came, and its frames' places, unless its stack was made up where it was caught. */
const exceptionOf = (
  exception: unknown,
  mask: Mask,
  how: CrashHow | undefined,
  first: boolean,
  cwd: string,
): Record<string, unknown> | null => {
  if (!isRecord(exception)) return null
  const given = isRecord(exception.mechanism) ? exception.mechanism : {}
  const synthetic = given.synthetic === true
  const mechanism: Record<string, unknown> = {
    type: first && how !== undefined ? how : text(given.type, 40) || 'generic',
    handled: first && how !== undefined ? how === 'handled' : given.handled !== false,
    synthetic,
  }
  for (const key of ['exception_id', 'parent_id'] as const) if (typeof given[key] === 'number') mechanism[key] = given[key]
  if (typeof given.source === 'string') mechanism.source = text(given.source, 40)
  const kept: Record<string, unknown> = {
    type: mask(text(exception.type, LONGEST_NAME)) || 'Error',
    value: mask(text(exception.value, LONGEST_VALUE * 2)).slice(0, LONGEST_VALUE),
    mechanism,
  }
  const frames = isRecord(exception.stacktrace) && Array.isArray(exception.stacktrace.frames) ? exception.stacktrace.frames : []
  // A stack PostHog made where it was caught says where Althar reported it, not where it failed: none goes.
  if (!synthetic && frames.length > 0)
    kept.stacktrace = {
      type: 'raw',
      // Oldest first, as PostHog orders them: the last are nearest where it was thrown.
      frames: frames.slice(-MOST_FRAMES).flatMap((frame) => frameOf(frame, mask, cwd) ?? []),
    }
  return kept
}

/** The exceptions as they may leave, masked. */
export const exceptionsOf = (list: unknown, mask: Mask, how?: CrashHow, cwd = process.cwd()): ReadonlyArray<Record<string, unknown>> =>
  (Array.isArray(list) ? (list as ReadonlyArray<unknown>) : [])
    .slice(0, MOST_CHAINED)
    .flatMap((exception, at): ReadonlyArray<Record<string, unknown>> => {
      const kept = exceptionOf(exception, mask, how, at === 0, cwd)
      return kept === null ? [] : [kept]
    })

/** What makes two reports the same one: the first exception's type, and where in Althar it was thrown, or what it says where it has no frames. */
export const fingerprintOf = (exceptions: ReadonlyArray<Record<string, unknown>>): string => {
  const [first] = exceptions
  if (first === undefined) return ''
  const stack =
    isRecord(first.stacktrace) && Array.isArray(first.stacktrace.frames)
      ? (first.stacktrace.frames as ReadonlyArray<Record<string, unknown>>)
      : []
  const own = [...stack].reverse().find((frame) => frame.in_app === true) ?? stack.at(-1)
  return own === undefined
    ? `${String(first.type)}|${String(first.value)}`
    : `${String(first.type)}|${String(own.filename)}:${String(own.function)}:${String(own.lineno)}`
}

/** The properties an event may carry; anything PostHog's client or a caller adds besides is dropped. */
const KEPT = ['$exception_level', 'process', 'where', 'agent', '$app_version', '$os', 'arch', 'release', '$process_person_profile'] as const

/** The projects' and repositories' names a report hides. */
export interface HiddenNames {
  readonly projects: ReadonlyArray<string>
  readonly repositories: ReadonlyArray<string>
}

/**
 * The names a launch hides, once more are read: every name it has learned,
 * and the new ones after them. None is ever forgotten, so a project renamed
 * or removed while Althar runs is hidden still in what is said of it later;
 * a read that failed (null) leaves them as they were.
 */
export const namesLearned = (known: HiddenNames, read: HiddenNames | null): HiddenNames =>
  read === null
    ? known
    : {
        projects: [...new Set([...known.projects, ...read.projects])],
        repositories: [...new Set([...known.repositories, ...read.repositories])],
      }

/* ---- the sender ---------------------------------------------------------------- */

export interface CrashReportsOptions {
  /** PostHog's project key, as the build gave it; empty, and nothing is ever sent. Usage data's own. */
  readonly key: string
  /** Where PostHog takes events: https://us.i.posthog.com. */
  readonly host: string
  /** The random id made for this install (usageData.ts's `installOf`). */
  readonly installId: string
  readonly app: { readonly version: string; readonly platform: string; readonly arch: string }
  /** Whether the person's switch is on and DO_NOT_TRACK isn't set, asked as each report comes and again before each request goes. */
  readonly allowed: () => boolean
  /** How a request goes: the app's own network; in tests, one that records it. */
  readonly fetch: NonNullable<PostHogOptions['fetch']>
  /** What hides the person's paths, names and secrets (logs/mask.ts), made as each report goes, with the names as they stand. */
  readonly mask: () => Mask | Promise<Mask>
  /** How long PostHog's client waits before trying a request again; quicker in tests. */
  readonly retryDelay?: number
  /** Where the process started, which PostHog's client makes frames' files relative to; the process's own, but in tests. */
  readonly cwd?: string
}

export interface CrashReports {
  /** Something a process threw and nobody caught, or a rejection nobody handled. Never fails. */
  readonly thrown: (thrown: unknown, process: CrashProcess, how: CrashHow) => void
  /** What the window sent for the log (`althar:window-error`). */
  readonly fromWindow: (report: unknown) => void
  /** What the runtime said it couldn't handle, or kept and carried on past (a `crash` message over its parent port). */
  readonly fromRuntime: (report: unknown) => void
  /** A process of Althar's that stopped other than cleanly: why, as Electron says, and its exit code. */
  readonly gone: (process: CrashProcess, details: { readonly reason: string; readonly exitCode: number }) => void
  /** The runtime stopped too often to start again, and Althar quit. */
  readonly keepsStopping: (restarts: number, exitCode: number | null) => void
  /** A native crash a minidump says happened, in a process, at a time. */
  readonly native: (crash: { readonly process: CrashProcess; readonly at: Date }) => void
  /** Lets what is on its way finish, briefly, as Althar quits. */
  readonly stop: () => Promise<void>
}

/** Something that happened, as a report's own error: a name of Althar's, what it says, and no stack. */
const said = (name: string, message: string): Error => errorFrom({ name, message, stack: '' })

/**
 * The sender. As usage data's, its client is made only once there is a
 * report to send, so with the switch off nothing is made and nothing is
 * asked of the network; every request asks the switch again as it goes.
 */
export const crashReports = (options: CrashReportsOptions): CrashReports => {
  let client: PostHog | undefined
  const sending = new Set<Promise<void>>()
  const seen = new Set<string>()
  let asked = 0
  let sent = 0
  let sentHandled = 0
  /** Whether a report of this kind still fits in the launch's budget for it. */
  const room = (how: CrashHow | undefined) => (how === 'handled' ? sentHandled < MOST_HANDLED : sent < MOST_A_LAUNCH)
  /* The mask made for the latest report, with the names as they stood: names are only ever added (namesLearned), so it hides the earlier ones' too. */
  let masking: Mask | undefined
  const base = {
    $app_version: options.app.version,
    release: options.app.version,
    $os: SYSTEMS[options.app.platform] ?? options.app.platform,
    arch: options.app.arch,
    // Anonymous: no person profile is made or updated.
    $process_person_profile: false,
  }

  /* Everything leaves through here: masked, cut down to what may go, once each, and twenty at most. */
  const scrub = (event: EventMessage | null): EventMessage | null => {
    if (event === null || event.event !== '$exception') return null
    const given = event.properties ?? {}
    const how = typeof given.how === 'string' ? (given.how as CrashHow) : undefined
    if (!room(how)) return null
    const mask = masking
    if (mask === undefined) return null
    const exceptions = exceptionsOf(given.$exception_list, mask, how, options.cwd ?? process.cwd())
    // The same failure in two calls is two reports: each call is its own place to look.
    const fingerprint = `${typeof given.where === 'string' ? given.where : ''}|${fingerprintOf(exceptions)}`
    if (exceptions.length === 0 || seen.has(fingerprint)) return null
    seen.add(fingerprint)
    if (how === 'handled') sentHandled += 1
    else sent += 1
    const properties: Record<string, unknown> = { $exception_list: exceptions }
    for (const key of KEPT) if (key in given) properties[key] = given[key]
    const at = typeof given.at === 'string' ? new Date(given.at) : undefined
    return {
      distinctId: options.installId,
      event: '$exception',
      properties,
      ...(at === undefined || Number.isNaN(at.getTime()) ? {} : { timestamp: at }),
    }
  }

  const sender = () =>
    (client ??= new PostHog(options.key, {
      host: options.host,
      disableGeoip: true,
      // No flags, no surveys, no catching on its own, nothing kept on disk: the reports Althar gives it alone.
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      enableExceptionAutocapture: false,
      persistence: 'memory',
      fetchRetryCount: 2,
      ...(options.retryDelay === undefined ? {} : { fetchRetryDelay: options.retryDelay }),
      before_send: (event) => {
        try {
          return scrub(event)
        } catch {
          // A report that can't be masked never goes.
          return null
        }
      },
      fetch: (url, init) => (options.allowed() ? options.fetch(url, init) : Promise.reject(new Error('Crash reports are off.'))),
    }))

  const send = (error: Error, process: CrashProcess, how: CrashHow, at?: Date, place: Place = {}) => {
    try {
      if (options.key === '' || options.host === '' || !options.allowed() || !room(how) || asked >= MOST_ASKED) return
      asked += 1
      const going = Promise.resolve()
        .then(() => options.mask())
        .then((mask) => {
          masking = mask
          if (!options.allowed()) return
          return sender().captureExceptionImmediate(error, options.installId, {
            ...base,
            // What ended a process is fatal; what one carried on after is an error.
            $exception_level: how === 'defect' || how === 'gone' || how === 'native' ? 'fatal' : 'error',
            process: PROCESSES.includes(process) ? process : 'unknown',
            how,
            ...placeOf(place),
            ...(at === undefined ? {} : { at: at.toISOString() }),
          })
        })
        // A report is never worth a failure, nor one that can't be masked: one that couldn't go is gone.
        .catch(() => undefined)
        .finally(() => sending.delete(going))
      sending.add(going)
    } catch {
      // Reporting never fails into what it reports on.
    }
  }

  return {
    // An error goes as it is, with its causes; anything else thrown, as words.
    thrown: (thrown, process, how) => send(thrown instanceof Error ? thrown : errorFrom(thrownOf(thrown)), process, how),
    fromWindow: (report) => {
      const read = windowThrown(report)
      if (read !== null) send(errorFrom(read.thrown), 'window', read.how)
    },
    fromRuntime: (report) => {
      const read = runtimeThrown(report)
      if (read !== null) send(errorFrom(read.thrown), 'runtime', read.how, undefined, read.place)
    },
    gone: (process, { reason, exitCode }) =>
      send(said('Process gone', `The ${process} process stopped: ${text(reason, 40)}, exit code ${exitCode}.`), process, 'gone'),
    keepsStopping: (restarts, exitCode) =>
      send(
        said(
          'Runtime keeps stopping',
          `The runtime stopped ${restarts} times in a minute, the last with exit code ${String(exitCode)}; Althar quit.`,
        ),
        'runtime',
        'gone',
      ),
    native: ({ process, at }) =>
      send(said('Native crash', `The ${process} process crashed; its minidump stays on this computer.`), process, 'native', at),
    stop: async () => {
      await Promise.race([Promise.all(sending), new Promise((resolve) => setTimeout(resolve, 2_000).unref?.())])
      await client?.shutdown(1_000).catch(() => undefined)
    },
  }
}

/* ---- native crashes ------------------------------------------------------------- */

/** Where Crashpad keeps its minidumps, under the folder Electron names (`crashDumps`): as they are written, and once written. */
const DUMP_FOLDERS = ['', 'pending', 'completed', 'reports']

/** The largest minidump read for its process; a larger one is said all the same, from a process unknown. */
const LARGEST_READ = 32_000_000

/** Crashpad's own name for each process kind (its `ptype` annotation), as a report names it. */
const KINDS: Readonly<Record<string, CrashProcess>> = {
  browser: 'main',
  renderer: 'window',
  'gpu-process': 'gpu',
  utility: 'utility',
}

/**
 * The process a minidump came from, by Crashpad's `ptype` annotation: a
 * length-prefixed `ptype`, then, aligned to four bytes, the length-prefixed
 * kind. Anything else, or none, is unknown.
 */
export const dumpKind = (bytes: Uint8Array): CrashProcess => {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const key = Buffer.from([5, 0, 0, 0, ...Buffer.from('ptype'), 0])
  for (let at = buffer.indexOf(key); at !== -1; at = buffer.indexOf(key, at + 1)) {
    // The value's length right after the key, at the next multiple of four, or a little further on.
    for (let value = at + key.length; value <= at + key.length + 8 && value + 4 <= buffer.length; value += 1) {
      const length = buffer.readUInt32LE(value)
      if (length < 1 || length > 32 || value + 4 + length > buffer.length) continue
      const kind = KINDS[buffer.toString('latin1', value + 4, value + 4 + length)]
      if (kind !== undefined) return kind
    }
  }
  return 'unknown'
}

/** How many minidumps' ids are remembered as said. */
const MOST_REMEMBERED = 200

/**
 * The minidumps written since the last launch: each one in Electron's
 * crash dumps folder not seen before, with its process and when it was
 * written. Each one there is remembered as seen, in the profile's
 * desktop.json, whether or not crash reports are on, so turning them on
 * never reports a crash from while they were off; the dumps themselves stay
 * where Crashpad put them. Nothing here ever fails: a folder or a file that
 * can't be read is passed over.
 */
export const newDumps = async (
  folder: string,
  profile: string,
): Promise<ReadonlyArray<{ readonly id: string; readonly process: CrashProcess; readonly at: Date }>> => {
  const kept = (await readPreferences(profile).catch(() => ({}) as Record<string, unknown>)).crashDumps
  const before = new Set(isRecord(kept) && Array.isArray(kept.seen) ? kept.seen.filter((id) => typeof id === 'string') : [])
  const found = (
    await Promise.all(
      DUMP_FOLDERS.map(async (under) => {
        const here = join(folder, under)
        const names = await readdir(here).catch(() => [] as Array<string>)
        return names.filter((name) => name.endsWith('.dmp')).map((name) => join(here, name))
      }),
    )
  ).flat()
  // One a launch moved from pending to completed as it read them is one dump.
  const byId = new Map(found.map((path) => [basename(path, '.dmp'), path]))
  const dumps = await Promise.all(
    [...byId].map(async ([id, path]) => {
      if (before.has(id)) return { id, fresh: null }
      const facts = await stat(path).catch(() => undefined)
      if (facts === undefined) return null
      const bytes = facts.size <= LARGEST_READ ? await readFile(path).catch(() => undefined) : undefined
      return { id, fresh: { id, process: bytes === undefined ? ('unknown' as const) : dumpKind(bytes), at: facts.mtime } }
    }),
  )
  const here = dumps.flatMap((dump) => (dump === null ? [] : [dump]))
  const fresh = here.flatMap((dump) => (dump.fresh === null ? [] : [dump.fresh])).sort((a, b) => a.at.getTime() - b.at.getTime())
  // Only the ones still there are remembered, so the list never grows past what Crashpad keeps.
  const seen = here.map((dump) => dump.id).slice(-MOST_REMEMBERED)
  if (fresh.length > 0 || seen.length !== before.size) await writePreference(profile, 'crashDumps', { seen }).catch(() => undefined)
  return fresh
}
