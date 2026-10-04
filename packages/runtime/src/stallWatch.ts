import { createHash } from 'node:crypto'

import type { SessionEvent } from '@althar/provider-adapters'

import type { LiveEvent } from './Live'
import { commandIn } from './rules'

/*
 * Whether a turn that hasn't ended is still working, and what to do when it
 * isn't (Stalls.ts runs it). A turn shows life by what its agent says, and by
 * the CPU its processes use, so a long build or test run is never taken for
 * a stall. A turn that waits on the person isn't stalled, and neither is one
 * across the machine sleeping. When a turn shows no life for long enough, it
 * is stopped and told to carry on; then its agent is started afresh; then the
 * person is asked. An agent that repeats the same call to the same end is told
 * to try another way, then the person is asked. And however it goes, work on
 * a thread is held to a budget of time and turns since the person last said
 * anything there.
 *
 * This is the reckoning alone, with no clock or process of its own: it is
 * told what happens and when, and says what to do.
 */

export interface StallLimits {
  /** How long, in milliseconds, a turn may show no life before it counts as stalled. */
  readonly quiet: number
  /** The same while one of its tools runs, such as a command. */
  readonly quietInTool: number
  /** How long a turn asked to stop has to end, before its agent is started afresh. */
  readonly cancelGrace: number
  /** A look this long after the last one means the machine slept, and the silence doesn't count. */
  readonly asleepAfter: number
  /** How long agents may work on a thread since the person last said anything there. */
  readonly work: number
  /** How many turns they may take in that time. */
  readonly turns: number
  /** The share of one CPU a turn's processes must use between looks to count as working. */
  readonly busyShare: number
}

/** A tool the agent has running, as a stall is put in words. */
export interface RunningTool {
  readonly title: string
  readonly command: string | null
}

/** What Althar has done about a turn before the person is asked. */
export type Tried = 'carried_on' | 'restarted' | 'redirected'

export type StallAction =
  /** Stop the turn, and tell the agent to carry on. */
  | { readonly _tag: 'CarryOn'; readonly threadId: string; readonly quietFor: number; readonly tool: RunningTool | null }
  /** Stop the turn, and tell the agent to stop repeating itself. */
  | { readonly _tag: 'Redirect'; readonly threadId: string; readonly repeated: string; readonly times: number }
  /** Start the agent afresh on the thread: it stalled again, or didn't stop when asked. */
  | { readonly _tag: 'Restart'; readonly threadId: string; readonly why: 'stalled' | 'ignored_stop' }
  /** Ask the person. */
  | {
      readonly _tag: 'GiveUp'
      readonly threadId: string
      readonly why: 'stalled' | 'looping' | 'over_budget'
      readonly detail: string | null
      readonly tried: ReadonlyArray<Tried>
    }

/** A tool call that finished, as a loop is told by. */
export interface Finished {
  readonly key: string
  readonly shown: string
  readonly failed: boolean
  readonly output: string
}

interface Watch {
  turn: string | null
  /** When the turn last showed life. */
  lifeAt: number
  /** The CPU its processes had used at the last look. */
  cpu: number | null
  /** Its tool calls by id, and which still run. */
  readonly calls: Map<string, Call>
  readonly running: Set<string>
  /** Questions to the person it waits on. */
  readonly asking: Set<string>
  /** The calls that finished lately, oldest first. */
  finished: Array<Finished>
  /** How far Althar has gone with a stall: 0, nowhere; 1, told it to carry on; 2, started it afresh; 3, asked the person. */
  rung: 0 | 1 | 2 | 3
  /** When it asked the turn to stop, while it waits for it to. */
  stopAskedAt: number | null
  /** Told to stop repeating itself, since the person last spoke. */
  redirected: boolean
  /** Work and turns since the person last said anything, and whether they've been asked about it. */
  worked: number
  turns: number
  spent: boolean
}

/** How many finished calls are kept to tell a loop by. */
const KEPT = 12

/** A tool call as far as the agent has said: its kind, title, command, and its whole input, as a digest. */
interface Call {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly command: string | null
  readonly input: string | null
}

/**
 * A tool call, as the same one again is known: its kind and its command, or
 * its whole input. Never its title alone: Claude Code titles every edit to a
 * file alike, so distinct edits would read as one. A call with nothing else to
 * tell it by is its own, and never the same as another.
 */
const keyOf = (call: Call) => `${call.kind}:${call.command ?? call.input ?? `#${call.id}`}`

const digestOf = (input: unknown) =>
  input === undefined || input === null ? null : createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)

/** A duration in words: 6 hours, 90 minutes. */
export const spanOf = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`
  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

/**
 * The same call to the same end, again and again: three times failing, or
 * four however it went, or two calls taking turns three times each.
 */
export const repeated = (finished: ReadonlyArray<Finished>): { readonly shown: string; readonly times: number } | null => {
  const last = finished.at(-1)
  if (last === undefined) return null
  const same = (a: Finished | undefined, b: Finished) =>
    a !== undefined && a.key === b.key && a.output === b.output && a.failed === b.failed
  let times = 1
  while (same(finished.at(-1 - times), last)) times += 1
  if ((last.failed && times >= 3) || times >= 4) return { shown: last.shown, times }
  const other = finished.at(-2)
  if (finished.length >= 6 && other !== undefined && other.key !== last.key) {
    const alternates = finished.slice(-6).every((call, index) => same(call, index % 2 === 0 ? other : last))
    if (alternates) return { shown: `${other.shown}\` and \`${last.shown}`, times: 3 }
  }
  return null
}

export const makeStallWatch = (limits: StallLimits) => {
  const watches = new Map<string, Watch>()
  let lastLook: number | null = null

  const watchOf = (threadId: string, now: number) => {
    const known = watches.get(threadId)
    if (known !== undefined) return known
    const made: Watch = {
      turn: null,
      lifeAt: now,
      cpu: null,
      calls: new Map(),
      running: new Set(),
      asking: new Set(),
      finished: [],
      rung: 0,
      stopAskedAt: null,
      redirected: false,
      worked: 0,
      turns: 0,
      spent: false,
    }
    watches.set(threadId, made)
    return made
  }

  /** The person said something, or a step began: the budget is whole again, and so is the patience. */
  const fresh = (watch: Watch) => {
    watch.worked = 0
    watch.turns = 0
    watch.spent = false
    watch.redirected = false
    watch.finished = []
    watch.rung = 0
  }

  const giveUp = (threadId: string, why: 'stalled' | 'looping' | 'over_budget', detail: string | null, tried: ReadonlyArray<Tried>) =>
    ({ _tag: 'GiveUp', threadId, why, detail, tried }) satisfies StallAction

  /** A tool call's news: what it is, whether it runs, and, once it's done, whether the agent is going round in circles. */
  const toolNews = (
    threadId: string,
    watch: Watch,
    event: Extract<SessionEvent, { _tag: 'ToolCall' | 'ToolCallUpdate' }>,
  ): ReadonlyArray<StallAction> => {
    const known = watch.calls.get(event.toolCallId)
    // Some agents, Claude Code among them, send a call's input only in a later update: what was said before carries on.
    const call: Call = {
      id: event.toolCallId,
      kind: event._tag === 'ToolCall' ? event.kind : (known?.kind ?? 'other'),
      title: event.title ?? known?.title ?? '',
      command: commandIn(event.rawInput) ?? known?.command ?? null,
      input: digestOf(event.rawInput) ?? known?.input ?? null,
    }
    watch.calls.set(event.toolCallId, call)
    if (event.status !== 'completed' && event.status !== 'failed') {
      if (event._tag === 'ToolCall' || event.status !== undefined) watch.running.add(event.toolCallId)
      return []
    }
    watch.running.delete(event.toolCallId)
    const output = event._tag === 'ToolCallUpdate' ? (JSON.stringify(event.rawOutput ?? null) ?? '').slice(0, 4_000) : ''
    watch.finished = [
      ...watch.finished,
      { key: keyOf(call), shown: call.command ?? call.title, failed: event.status === 'failed', output },
    ].slice(-KEPT)
    const loop = repeated(watch.finished)
    if (loop === null) return []
    watch.finished = []
    if (watch.redirected) return [giveUp(threadId, 'looping', loop.shown, ['redirected'])]
    watch.redirected = true
    return [{ _tag: 'Redirect', threadId, repeated: loop.shown, times: loop.times }]
  }

  /** What happened, at `now`: what to do about it. */
  const observe = (event: LiveEvent, now: number): ReadonlyArray<StallAction> => {
    const watch = watchOf(event.threadId, now)
    switch (event._tag) {
      case 'TurnStarted': {
        if (event.byPerson === true) fresh(watch)
        watch.turn = event.turnId
        watch.lifeAt = now
        watch.cpu = null
        watch.calls.clear()
        watch.running.clear()
        watch.stopAskedAt = null
        watch.turns += 1
        if (watch.spent || watch.turns <= limits.turns) return []
        watch.spent = true
        return [giveUp(event.threadId, 'over_budget', limits.turns === 1 ? 'a turn' : `${limits.turns} turns`, [])]
      }
      case 'TurnEnded':
        watch.turn = null
        watch.running.clear()
        watch.stopAskedAt = null
        // A turn that ended as turns do got somewhere: a stall after it starts from the beginning again.
        if (event.state === 'completed' && watch.rung < 3) watch.rung = 0
        return []
      case 'SessionStarted':
        watch.cpu = null
        return []
      case 'SessionEnded':
        watch.turn = null
        watch.running.clear()
        watch.stopAskedAt = null
        return []
      case 'AttentionNeeded':
        watch.asking.add(event.attentionId)
        watch.lifeAt = now
        return []
      case 'AttentionClosed':
        watch.asking.delete(event.attentionId)
        watch.lifeAt = now
        return []
      case 'Streaming':
        if (watch.turn !== null) watch.lifeAt = now
        return []
      case 'Agent': {
        if (watch.turn === null) return []
        watch.lifeAt = now
        const said = event.event
        return said._tag === 'ToolCall' || said._tag === 'ToolCallUpdate' ? toolNews(event.threadId, watch, said) : []
      }
    }
  }

  /** What a stall comes to, by how far Althar has gone with it already. */
  const stalled = (threadId: string, watch: Watch, now: number): ReadonlyArray<StallAction> => {
    const quietFor = now - watch.lifeAt
    watch.lifeAt = now
    switch (watch.rung) {
      case 0: {
        watch.rung = 1
        watch.stopAskedAt = now
        const tool = [...watch.running].map((id) => watch.calls.get(id)).find((call) => call !== undefined)
        return [{ _tag: 'CarryOn', threadId, quietFor, tool: tool === undefined ? null : { title: tool.title, command: tool.command } }]
      }
      case 1:
        watch.rung = 2
        watch.turn = null
        return [{ _tag: 'Restart', threadId, why: 'stalled' }]
      case 2:
        watch.rung = 3
        watch.turn = null
        return [giveUp(threadId, 'stalled', null, ['carried_on', 'restarted'])]
      case 3:
        return []
    }
  }

  /**
   * A look at every turn running, at `now`, with the CPU each one's processes
   * have used so far where that can be told: what to do about them.
   */
  const look = (now: number, cpuOf: (threadId: string) => number | null): ReadonlyArray<StallAction> => {
    const since = lastLook === null ? 0 : now - lastLook
    // Woken from sleep: nothing worked while the machine slept, and nothing stalled either.
    const slept = lastLook !== null && since > limits.asleepAfter
    lastLook = now
    const actions: Array<StallAction> = []
    for (const [threadId, watch] of watches) {
      if (watch.turn === null) continue
      const cpu = cpuOf(threadId)
      const busy = cpu !== null && watch.cpu !== null && cpu - watch.cpu >= limits.busyShare * since
      watch.cpu = cpu
      if (slept) {
        watch.lifeAt = now
        if (watch.stopAskedAt !== null) watch.stopAskedAt = now
        continue
      }
      // CPU tells only while a tool runs: otherwise the agent waits on its model, which says so as it goes,
      // and what it left running in the background, such as a dev server, isn't the turn at work.
      if (busy && watch.running.size > 0) watch.lifeAt = now
      // Waiting on the person is neither work nor a stall.
      if (watch.asking.size > 0) {
        watch.lifeAt = now
        continue
      }
      watch.worked += since
      if (!watch.spent && watch.worked >= limits.work) {
        watch.spent = true
        actions.push(giveUp(threadId, 'over_budget', spanOf(limits.work), []))
        continue
      }
      if (watch.stopAskedAt !== null) {
        if (now - watch.stopAskedAt < limits.cancelGrace) continue
        // Asked to stop, it went on as it was: it starts afresh, or, started afresh already, the person is asked.
        watch.stopAskedAt = null
        watch.turn = null
        if (watch.rung >= 2) {
          watch.rung = 3
          actions.push(giveUp(threadId, 'stalled', null, ['carried_on', 'restarted']))
        } else {
          watch.rung = 2
          actions.push({ _tag: 'Restart', threadId, why: 'ignored_stop' })
        }
        continue
      }
      const limit = watch.running.size > 0 ? limits.quietInTool : limits.quiet
      if (now - watch.lifeAt >= limit) actions.push(...stalled(threadId, watch, now))
    }
    return actions
  }

  return {
    observe,
    look,
    /** Work on the thread starts afresh, as a step does: its budget is whole again. */
    fresh: (threadId: string, now: number) => fresh(watchOf(threadId, now)),
    /** The threads with a turn running, as far as it has been told. */
    turning: () => [...watches].flatMap(([threadId, watch]) => (watch.turn === null ? [] : [threadId])),
  }
}

export type StallWatch = ReturnType<typeof makeStallWatch>
