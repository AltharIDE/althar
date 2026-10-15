import { spawn } from 'node:child_process'

import { asNode } from './process'
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

/* Warnings. Percent of the plan left when each fires, highest first. */
export const WARN_AT_REMAINING: ReadonlyArray<number> = [50, 25, 10, 5]

/** What was warned of for one window: kept per account and window, by the caller. */
export interface WarningState {
  /** The reset the warning belongs to; a different one is a new period. */
  readonly resetsAt: string | undefined
  /** The lowest threshold fired in this period. */
  readonly firedAt: number
}

export interface WarningStep {
  /** The threshold to tell the person of now, if any. */
  readonly warn?: number
  readonly state: WarningState
}

/**
 * The warning a reading calls for. Each threshold is told at most once per
 * reset period; a reading that skips several (50 to 8 percent left) tells
 * only the lowest it crossed; and a window is armed again only when its
 * `resetsAt` changes, not because use dipped and rose again.
 */
export const nextWarning = (usedPercent: number, resetsAt: string | undefined, before: WarningState | undefined): WarningStep => {
  const remaining = 100 - usedPercent
  const crossed = WARN_AT_REMAINING.filter((threshold) => remaining <= threshold)
  const lowest = crossed.length === 0 ? undefined : Math.min(...crossed)
  const sameReset = before !== undefined && before.resetsAt === resetsAt
  if (lowest === undefined) return { state: sameReset ? before : { resetsAt, firedAt: 100 } }
  if (sameReset && before.firedAt <= lowest) return { state: before }
  return { warn: lowest, state: { resetsAt, firedAt: lowest } }
}

/* Codex: `account/rateLimits/read` of its app-server (codex-rs/app-server-protocol, v2/account.rs). */

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const iso = (seconds: unknown) =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined

const codexWindow = (raw: unknown, label: string | undefined): UsageWindow | null => {
  const window = record(raw)
  if (window === null || typeof window.usedPercent !== 'number') return null
  const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : undefined
  const resetsAt = iso(window.resetsAt)
  return {
    kind: windowKind(minutes),
    ...(label === undefined ? {} : { label }),
    ...(minutes === undefined ? {} : { minutes }),
    usedPercent: window.usedPercent,
    ...(resetsAt === undefined ? {} : { resetsAt }),
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
  if (spend !== null && typeof spend.remainingPercent === 'number') {
    const resetsAt = iso(spend.resetsAt)
    windows.push({
      kind: 'other',
      label: 'Spend limit',
      usedPercent: 100 - spend.remainingPercent,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }
  return windows
}

/** What `account/rateLimits/read` answered, as the account's usage; null where it carries no window. */
export const codexUsage = (result: unknown, now: Date): AccountUsage | null => {
  const answer = record(result)
  if (answer === null) return null
  const byId = record(answer.rateLimitsByLimitId)
  const buckets = byId === null ? [] : Object.entries(byId).map(([id, bucket]) => [id, record(bucket)] as const)
  const main = record(answer.rateLimits)
  const windows: UsageWindow[] = []
  // The multi-bucket view when there is one ("codex" is the ordinary bucket); else the single historical one.
  if (buckets.length > 0) {
    for (const [id, bucket] of buckets) if (bucket !== null) windows.push(...codexSnapshotWindows(bucket, id !== 'codex'))
  } else if (main !== null) windows.push(...codexSnapshotWindows(main, false))
  if (windows.length === 0) return null
  const plan = typeof main?.planType === 'string' ? main.planType : undefined
  return { windows, source: 'agent', observedAt: now.toISOString(), ...(plan === undefined ? {} : { plan }) }
}

export interface ReadUsageOptions {
  readonly node?: string
  /** The account's home, as the agent's environment points at it; none for its usual folder. */
  readonly home?: Readonly<Record<string, string>>
  /** How long it waits, in ms. */
  readonly timeout?: number
  readonly now?: () => Date
}

export type UsageRead =
  | { readonly kind: 'usage'; readonly usage: AccountUsage }
  /** The agent answered, with no plan window: an API key, or a plan it gives none for. */
  | { readonly kind: 'none' }
  /** The agent couldn't be asked, or turned the question down, in its words. */
  | { readonly kind: 'failed'; readonly message: string }

const FIFTEEN_SECONDS = 15_000

/**
 * Asks an agent's own control channel for an account's windows, in the
 * account's home, and stops it: a short-lived child, started only for this.
 * It reads no credential: the agent answers about its own sign-in. Codex's
 * app-server speaks JSON-RPC lines on stdio.
 */
export const readAgentUsage = (agent: AgentDefinition, options: ReadUsageOptions = {}): Promise<UsageRead> =>
  new Promise((resolve) => {
    const usage = agent.usage
    if (usage === undefined) return resolve({ kind: 'failed', message: `${agent.name} has no usage channel.` })
    const node = options.node ?? process.execPath
    const spec = usage.run(node)
    const env = { ...process.env, ...asNode({ command: spec.command, args: spec.args }), ...options.home }
    const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
    const child = spawn(launched.command, [...launched.args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let over = false
    const end = (read: UsageRead) => {
      if (over) return
      over = true
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      resolve(read)
    }
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
        const read = codexUsage(result, (options.now ?? (() => new Date()))())
        end(read === null ? { kind: 'none' } : { kind: 'usage', usage: read })
      })
    })
  })
