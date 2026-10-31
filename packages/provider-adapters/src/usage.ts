import { spawn } from 'node:child_process'

import { childEnvironment } from './process'
import type { AgentDefinition } from './registry'

/*
 * How much of an account's plan is left (docs/plans/plan-usage.md). A plan has
 * windows (five hours, a week, a month) that each fill up and reset. Where the
 * numbers come from differs by agent and moves toward ACP as adapters report
 * them; everything above this file reads `AccountUsage` only, so a source can
 * change without touching it.
 */

/** Where an account's numbers came from, best first. */
export type UsageSource = 'acp' | 'acp_extension' | 'agent' | 'endpoint'

/** The windows plans have, told apart by their length; anything else is `other`. */
export type WindowKind = 'five_hour' | 'weekly' | 'monthly' | 'other'

export interface UsageWindow {
  readonly kind: WindowKind
  /** The agent's own name for it, where it gave one: a model's limit, or a spend limit. */
  readonly label?: string
  /** How long the window is, in minutes, when the source said. */
  readonly minutes?: number
  /** How much of it is used, 0 to 100. */
  readonly usedPercent: number
  /** When it resets, ISO 8601 in UTC. */
  readonly resetsAt?: string
  /** The models it limits, by a word of their ids or names (`opus`); none where it limits every model. */
  readonly model?: string
  /** Money spent past the plan (Claude's extra usage), not room in it: never a plan's tightest limit. */
  readonly spend?: boolean
}

export interface AccountUsage {
  readonly windows: ReadonlyArray<UsageWindow>
  readonly source: UsageSource
  /** When Althar saw these numbers, ISO 8601 in UTC. */
  readonly observedAt: string
  /** The plan, as the agent names it: `plus`, `pro`. */
  readonly plan?: string
}

const near = (minutes: number, of: number) => Math.abs(minutes - of) <= of * 0.1

/** A window's kind from its length: never from whether the agent calls it primary or secondary. */
export const windowKind = (minutes: number | null | undefined): WindowKind => {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'other'
  if (near(minutes, 5 * 60)) return 'five_hour'
  if (near(minutes, 7 * 24 * 60)) return 'weekly'
  if (minutes >= 28 * 24 * 60 && minutes <= 31 * 24 * 60) return 'monthly'
  return 'other'
}

/** How much of the window is left, 0 to 100. */
export const leftOf = (window: UsageWindow) => Math.max(0, Math.min(100, 100 - window.usedPercent))

/**
 * The window with the least left, of those that limit a model (only those
 * that limit every model, where none is named): one whose reset has passed
 * has started again, and money spent past the plan is no room in it, so
 * neither counts. Undefined where none is left to go by.
 */
export const tightestWindow = (windows: ReadonlyArray<UsageWindow>, now: number, model?: string): UsageWindow | undefined => {
  const named = model?.toLowerCase()
  return windows
    .filter((window) => window.spend !== true)
    .filter((window) => window.resetsAt === undefined || Date.parse(window.resetsAt) > now)
    .filter((window) => window.model === undefined || (named !== undefined && named.includes(window.model)))
    .reduce<UsageWindow | undefined>(
      (tightest, window) => (tightest === undefined || leftOf(window) < leftOf(tightest) ? window : tightest),
      undefined,
    )
}

/* Codex: `account/rateLimits/read` of its app-server (codex-rs/app-server-protocol, v2/account.rs). */

export type UsageRead =
  | { readonly kind: 'usage'; readonly usage: AccountUsage }
  /** The agent answered, with no plan window: an API key, or a plan it gives none for. */
  | { readonly kind: 'none' }
  /** The agent couldn't be asked, or its answer wasn't one Althar knows: a fault to show, in words. */
  | { readonly kind: 'failed'; readonly message: string }

export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** An answer that isn't the shape Codex documents: a fault, not "no windows". */
export class Unrecognized extends Error {}

/** A time given in epoch seconds, absent as undefined; one that is no date at all is unrecognized. */
export const isoSeconds = (seconds: unknown) => {
  if (seconds === null || seconds === undefined) return undefined
  const date = typeof seconds === 'number' ? new Date(seconds * 1000) : null
  if (date === null || Number.isNaN(date.getTime())) throw new Unrecognized('a reset time that is no date')
  return date.toISOString()
}

const codexWindow = (raw: unknown, label: string | undefined): UsageWindow | null => {
  if (raw === null || raw === undefined) return null
  const window = record(raw)
  if (window === null || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent))
    throw new Unrecognized('a window without a use')
  const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : undefined
  const resetsAt = isoSeconds(window.resetsAt)
  return {
    kind: windowKind(minutes),
    ...(label === undefined ? {} : { label }),
    ...(minutes === undefined ? {} : { minutes }),
    usedPercent: window.usedPercent,
    ...(resetsAt === undefined ? {} : { resetsAt }),
    // A bucket other than the ordinary one is a model's, named by its limit: it limits that model alone.
    ...(label === undefined ? {} : { model: label.toLowerCase() }),
  }
}

/**
 * The windows in a Codex rate-limit snapshot. `primary` and `secondary` are
 * slots, not durations: a weekly window can arrive as primary, so each is
 * classified by its length. A spend limit (`individualLimit`, a team plan's
 * cap) has no stated length and is `other`.
 */
const codexSnapshotWindows = (snapshot: Record<string, unknown>, extra: boolean): UsageWindow[] => {
  const name =
    typeof snapshot.limitName === 'string' ? snapshot.limitName : typeof snapshot.limitId === 'string' ? snapshot.limitId : undefined
  // The ordinary limit has no label; another bucket (a model's) is named by it.
  const label = extra ? name : undefined
  const windows = [codexWindow(snapshot.primary, label), codexWindow(snapshot.secondary, label)].filter((w): w is UsageWindow => w !== null)
  const spend = record(snapshot.individualLimit)
  if (snapshot.individualLimit !== null && snapshot.individualLimit !== undefined && spend === null)
    throw new Unrecognized('a spend limit that is no object')
  if (spend !== null) {
    if (typeof spend.remainingPercent !== 'number') throw new Unrecognized('a spend limit without a remaining share')
    const resetsAt = isoSeconds(spend.resetsAt)
    windows.push({
      kind: 'other',
      label: 'Spend limit',
      usedPercent: 100 - spend.remainingPercent,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }
  return windows
}

/**
 * What `account/rateLimits/read` answered, as the account's usage. No window
 * is `none` (a key, or a plan Codex gives no limits for); an answer that is
 * not the documented shape, or has a window that does not read, is a fault
 * that says so, so a change on Codex's side shows rather than looking like a
 * plan with no limits.
 */
export const codexUsage = (result: unknown, now: Date): UsageRead => {
  try {
    const answer = record(result)
    const main = record(answer?.rateLimits)
    if (answer === null || main === null) throw new Unrecognized('no rate limits')
    const raw = answer.rateLimitsByLimitId
    if (raw !== null && raw !== undefined && record(raw) === null) throw new Unrecognized('buckets that are no object')
    const buckets = Object.entries(record(raw) ?? {})
    const windows: UsageWindow[] = []
    // The multi-bucket view when there is one ("codex" is the ordinary bucket); else the single historical one.
    if (buckets.length > 0) {
      for (const [id, bucket] of buckets) {
        const snapshot = record(bucket)
        if (snapshot === null) throw new Unrecognized('a bucket that is no object')
        windows.push(...codexSnapshotWindows(snapshot, id !== 'codex'))
      }
    } else windows.push(...codexSnapshotWindows(main, false))
    if (windows.length === 0) return { kind: 'none' }
    const plan = typeof main.planType === 'string' ? main.planType : undefined
    return {
      kind: 'usage',
      usage: { windows, source: 'agent', observedAt: now.toISOString(), ...(plan === undefined ? {} : { plan }) },
    }
  } catch (error) {
    if (error instanceof Unrecognized)
      return { kind: 'failed', message: `Codex answered with something Althar does not know (${error.message}).` }
    throw error
  }
}

export interface ReadUsageOptions {
  readonly node?: string
  /** The account's home, as the agent's environment points at it; none for its usual folder. */
  readonly home?: Readonly<Record<string, string>>
  /** How long it waits, in ms. */
  readonly timeout?: number
  /** The time it is, which the windows' resets are read from: the caller's clock (Effect's, in the runtime). */
  readonly now: () => Date
}

const FIFTEEN_SECONDS = 15_000

/**
 * Asks an agent's own control channel for an account's windows, in the
 * account's home, and stops it: a short-lived child, started only for this.
 * It reads no credential: the agent answers about its own sign-in. Codex's
 * app-server speaks JSON-RPC lines on stdio.
 */
export const readAgentUsage = (agent: AgentDefinition, options: ReadUsageOptions): Promise<UsageRead> =>
  new Promise((resolve) => {
    const usage = agent.usage
    if (usage === undefined) return resolve({ kind: 'failed', message: `${agent.name} has no usage channel.` })
    const node = options.node ?? process.execPath
    const spec = usage.run(node)
    // Only what an agent may inherit (process.ts), and the account's home: never the whole environment.
    const inherited = { ...childEnvironment(spec), ...options.home }
    // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled; the wrapper
    // may inherit more of Althar's environment, as reaching the device needs (`spawnOwned` does the same).
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env: inherited })
    const env = launched === spec ? inherited : { ...childEnvironment(launched), ...options.home }
    const child = spawn(launched.command, [...launched.args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let over = false
    const end = (read: UsageRead) => {
      if (over) return
      over = true
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      resolve(read)
    }
    // Node's own timer, outside any effect: the child's time to answer, which only the process it runs in can keep.
    // oxlint-disable-next-line althar/one-clock
    const timer = setTimeout(
      () => end({ kind: 'failed', message: `${agent.name} didn’t answer in time.` }),
      options.timeout ?? FIFTEEN_SECONDS,
    )
    child.on('error', (error) => end({ kind: 'failed', message: error.message }))
    child.on('exit', () => end({ kind: 'failed', message: `${agent.name} stopped before it answered.` }))
    child.stdin.on('error', () => end({ kind: 'failed', message: `${agent.name} stopped listening.` }))

    let next = 0
    const waiting = new Map<number, (result: unknown, error: string | null) => void>()
    const write = (message: unknown) => {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const send = (method: string, params: unknown, then: (result: unknown, error: string | null) => void) => {
      const id = ++next
      waiting.set(id, then)
      write({ jsonrpc: '2.0', id, method, params })
    }
    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += String(chunk)
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        let message: Record<string, unknown> | null = null
        try {
          message = record(JSON.parse(line))
        } catch {
          continue
        }
        if (message === null || typeof message.id !== 'number') continue
        const then = waiting.get(message.id)
        if (then === undefined) continue
        waiting.delete(message.id)
        const error = record(message.error)
        then(message.result, error === null ? null : typeof error.message === 'string' ? error.message : 'The agent refused.')
      }
    })
    send('initialize', { clientInfo: { name: 'althar', title: 'Althar', version: '0' } }, (_result, error) => {
      if (error !== null) return end({ kind: 'failed', message: error })
      write({ jsonrpc: '2.0', method: 'initialized', params: {} })
      send('account/rateLimits/read', undefined, (result, failed) => {
        if (failed !== null) return end({ kind: 'failed', message: failed })
        end(codexUsage(result, options.now()))
      })
    })
  })

/* Claude Code: the Agent SDK's `rate_limit_event`, which claude-agent-acp puts in `usage_update` `_meta["_claude/rateLimit"]`. */

const CLAUDE_WINDOWS: Readonly<
  Record<string, { readonly kind: WindowKind; readonly label?: string; readonly model?: string; readonly spend?: boolean }>
> = {
  five_hour: { kind: 'five_hour' },
  seven_day: { kind: 'weekly' },
  seven_day_opus: { kind: 'weekly', label: 'Opus', model: 'opus' },
  seven_day_sonnet: { kind: 'weekly', label: 'Sonnet', model: 'sonnet' },
  seven_day_overage_included: { kind: 'weekly', label: 'With extra usage' },
  overage: { kind: 'other', label: 'Extra usage', spend: true },
}

/** One of Claude's windows as an event gives it: its use a fraction of 1, its reset in epoch seconds; null where it isn't one Althar knows. */
const claudeEventWindow = (type: string, utilization: unknown, resetsAt: unknown): UsageWindow | null => {
  const named = CLAUDE_WINDOWS[type]
  if (named === undefined || typeof utilization !== 'number' || !Number.isFinite(utilization)) return null
  let reset: string | undefined
  try {
    reset = isoSeconds(resetsAt)
  } catch {
    return null
  }
  return {
    kind: named.kind,
    ...(named.label === undefined ? {} : { label: named.label }),
    usedPercent: Math.min(100, Math.max(0, Math.round(utilization * 1000) / 10)),
    ...(reset === undefined ? {} : { resetsAt: reset }),
    ...(named.model === undefined ? {} : { model: named.model }),
    ...(named.spend === true ? { spend: true } : {}),
  }
}

/**
 * The windows one `rate_limit_event` describes (SDK 0.3.312, `SDKRateLimitInfo`).
 * Its own `rateLimitType` names the window nearest its limit, with a
 * `utilization` only once that is past a warning threshold: an event on a plan
 * with room, as most are, has none. The CLI also sends each window it tracks in
 * `unifiedWindows`, an internal field read from every response's
 * `anthropic-ratelimit-unified-*` headers, whenever one's rounded percentage,
 * reset or status moves: those are the windows, and the event's own adds one
 * they don't carry, such as a model's week. `utilization` is a fraction of 1,
 * past 1 where use runs over, and `resetsAt` epoch seconds. A Max plan's, seen
 * on 30 October 2026: `{status: 'allowed', rateLimitType: 'five_hour', resetsAt,
 * unifiedWindows: {five_hour: {utilization: 0.3, resetsAt, status},
 * seven_day: {utilization: 0.62, resetsAt, status}}}`. None where it names none.
 */
export const claudeRateLimitWindows = (info: unknown): ReadonlyArray<UsageWindow> => {
  const event = record(info)
  if (event === null) return []
  const windows: UsageWindow[] = []
  for (const [type, raw] of Object.entries(record(event.unifiedWindows) ?? {})) {
    const window = record(raw)
    const found = window === null ? null : claudeEventWindow(type, window.utilization, window.resetsAt)
    if (found !== null) windows.push(found)
  }
  const own = typeof event.rateLimitType === 'string' ? claudeEventWindow(event.rateLimitType, event.utilization, event.resetsAt) : null
  if (own !== null && !windows.some((window) => window.kind === own.kind && window.label === own.label)) windows.push(own)
  return windows
}
