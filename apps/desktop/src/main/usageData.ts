import { randomUUID } from 'node:crypto'

import type { UsageEvent as Said, Settled, Took } from '@althar/runtime'
import { PostHog, type PostHogOptions } from 'posthog-node'

import { readPreferences, writePreference } from './preferences'

/*
 * Anonymous usage data (Linear DEV-76): how many who open Althar sign an
 * agent in, make a project, start a task and see it settle, and whether they
 * come back. Only the events named here leave, each with only the properties
 * named for it, and each property only as a count, a word from a fixed list
 * or an agent's or model family's id: never a path, a repository's or
 * project's name, a prompt, a message, what an agent wrote, a file or an
 * account. Anything else is dropped here, wherever it came from.
 *
 * They go from the main process to PostHog with posthog-node, one request
 * each, over the app's own network; the window never sends them, so it needs
 * no browser SDK and captures nothing on its own. Each carries the app's
 * version, the system and the processor, and a random id made for this
 * install; person profiles stay off and GeoIP is never looked up. Nothing is
 * sent while the person's switch is off, with DO_NOT_TRACK set, or from a
 * build made without PostHog's key, as every build but a release is.
 */

/** A property's check: whether a value is one it may carry. */
type Holds = (value: unknown) => boolean

/** How many of something: repositories, steps. */
const count: Holds = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000

/** One of a few words. */
const oneOf =
  (...words: ReadonlyArray<string>): Holds =>
  (value) =>
    typeof value === 'string' && words.includes(value)

/** An agent's or a model family's id, as Althar names them: claude-code, codex, opus. Never anything the person wrote. */
const id: Holds = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,39}$/.test(value)

/** A version of Althar: 0.1.0, 0.2.0-beta.1. */
const version: Holds = (value) => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/.test(value)

/** How long a task took, as a bucket: never its own times. */
export const TOOK = ['under_10m', '10m_to_1h', '1h_to_1d', 'over_1d'] as const satisfies ReadonlyArray<Took>

/** Each event the runtime says, with a check for each of its properties: one the runtime adds must be named here before it can go. */
type FromRuntime = { readonly [E in Said as E['name']]: { readonly [P in keyof E['properties']]: Holds } }

/** How a task settled. */
export const SETTLED = ['merged_here', 'pull_request', 'abandoned', 'reviewed', 'seen'] as const satisfies ReadonlyArray<Settled>

/** What may be sent: each event Althar names, and the properties each may carry. */
export const USAGE_EVENTS = {
  /** Althar opened. */
  app_opened: {},
  /** The first project was made on the first screen, of this many repositories. */
  first_screen_done: { repositories: count },
  /** An agent was found signed in, the first time this launch, or was signed in. */
  agent_signed_in: { agent: id, how: oneOf('found', 'signed_in') },
  /** A project was made, of this many repositories. */
  project_made: { repositories: count },
  /** A task started: as planned, as a mini task the coordinator started at once, by writing to a lead, or as a review; its lead's agent and model family. */
  task_started: { as: oneOf('planned', 'mini', 'direct', 'review'), agent: id, family: id },
  /** A task settled: merged here, as a pull request, abandoned, its review posted, or done on sight; how long it took, and in how many steps. */
  task_settled: { as: oneOf(...SETTLED), took: oneOf(...TOOK), steps: count },
  /** An ask was answered: a permission, a question or a stuck step, by the person or by the coordinator. */
  ask_answered: { ask: oneOf('permission', 'question', 'stuck'), by: oneOf('person', 'coordinator') },
  /** An agent's account reached its usage limit. */
  usage_limit_hit: { agent: id },
  /** Althar opened on another version than last time, from this one. */
  update_installed: { from: version },
} as const satisfies FromRuntime & Readonly<Record<string, Readonly<Record<string, Holds>>>>

export type UsageEventName = keyof typeof USAGE_EVENTS

/** An event as it is sent: one Althar names, with the properties it may carry. */
export interface UsageEvent {
  readonly name: UsageEventName
  readonly properties: Readonly<Record<string, string | number>>
}

const isEventName = (name: unknown): name is UsageEventName => typeof name === 'string' && Object.hasOwn(USAGE_EVENTS, name)

/**
 * An event as it may be sent, from what was said: one Althar names, keeping
 * each property it may carry where the value is one it can hold, and
 * nothing else; null for an event it doesn't send.
 */
export const usageEventOf = (said: unknown): UsageEvent | null => {
  if (typeof said !== 'object' || said === null) return null
  const { name, properties } = said as { readonly name?: unknown; readonly properties?: unknown }
  if (!isEventName(name)) return null
  const given = typeof properties === 'object' && properties !== null ? (properties as Readonly<Record<string, unknown>>) : {}
  const kept = Object.entries(USAGE_EVENTS[name] as Readonly<Record<string, Holds>>).flatMap(([key, holds]) => {
    const value = given[key]
    return holds(value) ? [[key, value as string | number] as const] : []
  })
  return { name, properties: Object.fromEntries(kept) }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Whether a value is an install id: a random UUID v4, lowercase, as `randomUUID` makes and the reports Worker takes. */
export const isInstallId = (value: unknown): value is string => typeof value === 'string' && UUID_V4.test(value)

/**
 * This install, kept in the profile's desktop.json: a random id, made the
 * first time, and the version Althar last opened on, kept whether or not
 * anything is sent, so turning the switch on later never reports an update
 * from long ago. `updatedFrom` is that version when this one differs: an
 * update was installed. The id is the install's one id: usage data's, and
 * what ties a problem report to the install it came from (report/reports.ts,
 * DEV-61), whatever usage data's switch says. It names no machine, account
 * or person.
 */
export const installOf = async (
  profile: string,
  version: string,
): Promise<{ readonly id: string; readonly updatedFrom: string | null }> => {
  const kept = (await readPreferences(profile)).usage
  const was = typeof kept === 'object' && kept !== null ? (kept as { readonly id?: unknown; readonly version?: unknown }) : {}
  const id = isInstallId(was.id) ? was.id : randomUUID()
  const last = typeof was.version === 'string' ? was.version : null
  // One that can't be kept is made again next time: usage data is never worth a failure.
  if (id !== was.id || last !== version) await writePreference(profile, 'usage', { id, version }).catch(() => undefined)
  return { id, updatedFrom: last !== null && last !== version ? last : null }
}

/** The system, as PostHog's own SDKs name it. */
const SYSTEMS: Readonly<Record<string, string>> = { darwin: 'Mac OS X', win32: 'Windows', linux: 'Linux' }

export interface UsageDataOptions {
  /** PostHog's project key, as the build gave it; empty, and nothing is ever sent. */
  readonly key: string
  /** Where PostHog takes events: https://us.i.posthog.com. */
  readonly host: string
  /** The random id made for this install. */
  readonly installId: string
  readonly app: { readonly version: string; readonly platform: string; readonly arch: string }
  /** Whether the person's switch is on and DO_NOT_TRACK isn't set, asked as each event comes and again before each request goes. */
  readonly allowed: () => boolean
  /** How a request goes: the app's own network; in tests, one that records it. */
  readonly fetch: NonNullable<PostHogOptions['fetch']>
  /** How long PostHog's client waits before trying a request again; quicker in tests. */
  readonly retryDelay?: number
}

export interface UsageData {
  /** Sends an event, if it is one Althar names and the person allows it; anything else is dropped. Never fails. */
  readonly record: (said: unknown) => void
  /** Lets what is on its way finish, briefly, as Althar quits. */
  readonly stop: () => Promise<void>
}

/**
 * The sender. PostHog's client is made only once there is an event to send,
 * so with no key or the switch off nothing is made and nothing is asked of
 * the network, not even at start. Every request it makes asks the switch
 * again as it goes, so one prepared or tried again after it was turned off
 * never leaves.
 */
export const usageData = (options: UsageDataOptions): UsageData => {
  let client: PostHog | undefined
  const sending = new Set<Promise<void>>()
  const base = {
    $app_version: options.app.version,
    $os: SYSTEMS[options.app.platform] ?? options.app.platform,
    arch: options.app.arch,
    // Anonymous: no person profile is made or updated.
    $process_person_profile: false,
  }
  const sender = () =>
    (client ??= new PostHog(options.key, {
      host: options.host,
      disableGeoip: true,
      // No flags, no surveys, nothing kept on disk: events alone.
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      persistence: 'memory',
      fetchRetryCount: 2,
      ...(options.retryDelay === undefined ? {} : { fetchRetryDelay: options.retryDelay }),
      fetch: (url, init) => (options.allowed() ? options.fetch(url, init) : Promise.reject(new Error('Usage data is off.'))),
    }))
  // Each goes as when it happened, not when its request did, so a funnel reads them in the order they came.
  const send = (said: unknown, at: Date) => {
    if (options.key === '' || options.host === '' || !options.allowed()) return
    const event = usageEventOf(said)
    if (event === null) return
    const sent = sender()
      .captureImmediate({
        distinctId: options.installId,
        event: event.name,
        properties: { ...event.properties, ...base },
        timestamp: at,
      })
      // Usage data is never worth a failure: one that couldn't go is gone.
      .catch(() => undefined)
      .finally(() => sending.delete(sent))
    sending.add(sent)
  }
  return {
    record: (said) => send(said, new Date()),
    stop: async () => {
      await Promise.race([Promise.all(sending), new Promise((resolve) => setTimeout(resolve, 2_000).unref?.())])
      await client?.shutdown(1_000).catch(() => undefined)
    },
  }
}
