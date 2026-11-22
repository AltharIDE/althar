import { randomUUID } from 'node:crypto'

import type {
  ComputerAnswer,
  ComputerCall,
  ComputerDecision,
  ComputerDone,
  ComputerOwner,
  ComputerState,
} from '@althar/runtime/computerBridge'

import type { NativeAction, NativeApp, NativeFrame, NativeWindow } from '../../computer/protocol'
import type { ComputerWorker } from './worker'

const ASK_FOR = 150_000
const IDLE = 5 * 60_000
const MAX_SESSIONS = 12
const sameTurn = (one: ComputerOwner, other: ComputerOwner) => one.sessionId === other.sessionId && one.turnId === other.turnId

interface Found {
  readonly windows: ReadonlyArray<NativeWindow>
  readonly apps: ReadonlyArray<NativeApp>
}

/** One ask, whether the task may use this computer for its turn, and what was open when it asked. */
interface Pending {
  readonly id: string
  readonly reason: string
  readonly found: Found
  readonly timer: ReturnType<typeof setTimeout>
  readonly settle: (done: ComputerDone) => void
}

interface Session {
  readonly owner: ComputerOwner
  readonly worker: ComputerWorker
  readonly windows: Map<string, NativeWindow>
  readonly apps: Map<string, NativeApp>
  /** The apps it has used, their names by process: another task's turn leaves them to it until its own ends. */
  readonly held: Map<number, string>
  /** It has sent input to the whole display, which can reach any app: another task's turn leaves them all to it until its own ends. */
  display: boolean
  pending?: Pending | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
  /** The person let it use this computer for its turn: a later request only finds what opened since. */
  allowed: boolean
  preview?: ComputerState['preview']
  frame?: NativeFrame | undefined
  desktop: boolean
  foreground: boolean
  paused: boolean
  busy: boolean
  generation: number
  action: string
}

const error = (message: string): ComputerDone => ({ error: message })
const done = (text: string): ComputerDone => ({ value: { text } })
const publicWindows = (windows: ReadonlyMap<string, NativeWindow>) =>
  [...windows].map(([id, one]) => ({ id, app: one.app, title: one.title }))
const publicApps = (apps: ReadonlyMap<string, NativeApp>) => [...apps].map(([id, one]) => ({ id, app: one.name }))

export const computerSessions = (options: {
  readonly worker: () => ComputerWorker
  readonly changed: (state: ComputerState) => void
  readonly canAsk: () => boolean
  readonly canShareDisplay: () => boolean
  readonly available: () => boolean
  readonly desktopInputSafe?: (action: NativeAction, frame: NativeFrame | undefined) => boolean
}) => {
  const sessions = new Map<string, Session>()
  let foreground: Session | undefined
  const closing = new Set<Promise<void>>()
  const stopWorker = (session: Session) => {
    const stopped = session.worker.stop()
    closing.add(stopped)
    void stopped.then(
      () => closing.delete(stopped),
      () => closing.delete(stopped),
    )
  }

  const stateOf = (session: Session, stopped = false): ComputerState => ({
    taskId: session.owner.taskId,
    threadId: session.owner.threadId,
    title: session.owner.title,
    phase: stopped ? 'stopped' : session.paused ? 'paused' : session.pending !== undefined ? 'asking' : 'active',
    windows: publicWindows(session.windows),
    desktop: session.desktop,
    foreground: session.foreground,
    action: session.action,
    ...(session.preview === undefined ? {} : { preview: session.preview }),
    ...(session.pending === undefined
      ? {}
      : { request: { id: session.pending.id, primaryDisplay: options.canShareDisplay(), reason: session.pending.reason } }),
  })
  const changed = (session: Session) => options.changed(stateOf(session))
  const others = (session: Session) => [...sessions.values()].filter((other) => other !== session)
  /** The app of this process, where another task holds it. */
  const appElsewhere = (session: Session, pid: number) =>
    others(session)
      .find((other) => other.held.has(pid))
      ?.held.get(pid)
  const displayElsewhere = (session: Session) => others(session).some((other) => other.display)
  /** What another task holds that input to the whole display could reach, by name. */
  const anyElsewhere = (session: Session) =>
    displayElsewhere(session) ? 'the primary display' : others(session).flatMap((other) => [...other.held.values()])[0]
  const using = (what: string) => error(`Another task is using ${what}. Wait for its turn to end.`)
  // What is open now, each window and app keeping the id the task already has for it, and what closed since gone.
  const take = (session: Session, found: Found) => {
    const windows = [...session.windows]
    const apps = [...session.apps]
    const idOf = <T>(kept: ReadonlyArray<readonly [string, T]>, same: (one: T) => boolean) =>
      kept.find(([, one]) => same(one))?.[0] ?? randomUUID()
    const nextWindows = found.windows.map(
      (one) => [idOf(windows, (kept) => kept.pid === one.pid && kept.handle === one.handle), one] as const,
    )
    const nextApps = found.apps.map((one) => [idOf(apps, (kept) => kept.path === one.path), one] as const)
    session.windows.clear()
    session.apps.clear()
    for (const [id, one] of nextWindows) session.windows.set(id, one)
    for (const [id, one] of nextApps) session.apps.set(id, one)
    session.desktop = options.canShareDisplay()
    session.foreground = true
  }
  const settle = (session: Session, outcome: ComputerDone) => {
    const waiting = session.pending
    if (waiting === undefined) return
    session.pending = undefined
    clearTimeout(waiting.timer)
    waiting.settle(outcome)
  }
  const stop = (taskId: string, reason = 'Computer use stopped.') => {
    const session = sessions.get(taskId)
    if (session === undefined) return false
    sessions.delete(taskId)
    if (foreground === session) foreground = undefined
    clearTimeout(session.timer)
    session.generation++
    settle(session, error(reason))
    stopWorker(session)
    session.preview = undefined
    session.frame = undefined
    session.windows.clear()
    session.apps.clear()
    session.held.clear()
    session.display = false
    session.desktop = false
    session.foreground = false
    session.action = reason
    options.changed(stateOf(session, true))
    return true
  }
  const stopAll = (reason: string) => {
    for (const taskId of sessions.keys()) stop(taskId, reason)
  }
  const ended = (owner: ComputerOwner) => {
    const active = sessions.get(owner.taskId)
    if (active !== undefined && sameTurn(owner, active.owner)) stop(owner.taskId, 'The task’s turn ended.')
  }
  const renew = (session: Session, ms = IDLE) => {
    clearTimeout(session.timer)
    session.timer = setTimeout(() => stop(session.owner.taskId, 'Computer access expired.'), ms)
  }
  const pause = (taskId: string) => {
    const session = sessions.get(taskId)
    if (session === undefined) return false
    session.paused = true
    session.generation++
    if (foreground === session) foreground = undefined
    settle(session, error('The person took over. Wait for them to resume computer use.'))
    stopWorker(session)
    session.preview = undefined
    session.frame = undefined
    session.action = 'You have control.'
    renew(session)
    changed(session)
    return true
  }
  const resume = (taskId: string) => {
    const session = sessions.get(taskId)
    if (session === undefined || !session.paused || session.busy || closing.size > 0) return false
    session.paused = false
    session.action = 'Computer use resumed. The task will observe again.'
    renew(session)
    changed(session)
    return true
  }

  const summary = (session: Session): ComputerDone =>
    done(
      JSON.stringify({
        paused: session.paused,
        windows: publicWindows(session.windows),
        apps: publicApps(session.apps),
        desktop: session.desktop ? 'desktop' : null,
        foreground: session.foreground,
      }),
    )

  const request = async (session: Session, call: Extract<ComputerCall, { op: 'request' }>, still: () => boolean): Promise<ComputerDone> => {
    session.action = 'Finding apps and windows…'
    changed(session)
    const inventory = await session.worker.run({ op: 'inventory' })
    if (!still()) return error('Computer use stopped before the request could be shown.')
    if (inventory.kind !== 'inventory') return error('The native helper did not return an app list.')
    // Asked once a turn: allowed, it only finds what opened since.
    if (session.allowed) {
      take(session, inventory.value)
      session.action = 'Waiting for the task’s next action.'
      changed(session)
      return summary(session)
    }
    const access = await new Promise<ComputerDone>((resolve) => {
      const id = randomUUID()
      const timer = setTimeout(() => stop(session.owner.taskId, 'Computer access was not approved in time.'), ASK_FOR)
      session.pending = { id, reason: call.reason, found: inventory.value, timer, settle: resolve }
      session.action = 'Waiting for you to approve computer use.'
      changed(session)
    })
    return access
  }

  const allow = (taskId: string, decision: ComputerDecision) => {
    if (foreground !== undefined || closing.size > 0) return false
    const session = sessions.get(taskId)
    const waiting = session?.pending
    if (session === undefined || waiting === undefined || waiting.id !== decision.requestId) return false
    if (!decision.allow) {
      settle(session, error('The person declined computer access.'))
      return stop(taskId, 'Computer access declined.')
    }
    // Yes takes in the whole computer for the turn: every app and window, foreground input, and the display where it may be shared.
    session.allowed = true
    take(session, waiting.found)
    settle(session, summary(session))
    session.action = 'Computer access approved.'
    changed(session)
    return true
  }

  const call = async (owner: ComputerOwner, command: ComputerCall, signal: AbortSignal): Promise<ComputerDone> => {
    if (!options.available()) return error('Computer use needs a supported graphical session on this computer.')
    let session = sessions.get(owner.taskId)
    if (session !== undefined && !sameTurn(owner, session.owner))
      return error('A different task turn owns this computer session. Wait for its access to end.')
    if (command.op === 'status')
      return session === undefined ? done('Computer use is available. Request access for this turn.') : summary(session)
    if (command.op === 'release') {
      stop(owner.taskId)
      return done('Computer access released.')
    }
    if (signal.aborted) return error('The computer call was cancelled.')
    if (session === undefined) {
      if (command.op !== 'request') return error('Ask for computer access first.')
      if (!options.canAsk()) return error('Open the task in Althar to approve computer use.')
      if (sessions.size >= MAX_SESSIONS) return error('There are too many computer sessions. Release one first.')
      session = {
        owner,
        worker: options.worker(),
        windows: new Map(),
        apps: new Map(),
        held: new Map(),
        display: false,
        allowed: false,
        action: '',
        desktop: false,
        foreground: false,
        paused: false,
        busy: false,
        generation: 0,
      }
      sessions.set(owner.taskId, session)
    }
    const active = session
    if (active.paused) return error('The person has control. Wait for them to resume computer use.')
    if (closing.size > 0) return error('A former computer session is still stopping. Wait before sending more input.')
    if (active.busy) return error('A computer call is already in progress for this task.')
    if (foreground !== undefined && foreground !== active && command.op !== 'request')
      return error('Another task has the foreground desktop. Ask it to release control or wait.')
    active.busy = true
    const generation = active.generation
    const still = () => !signal.aborted && sessions.get(owner.taskId) === active && active.generation === generation
    const cancel = () => {
      if (still() || sessions.get(owner.taskId) === active) stop(owner.taskId, 'The agent cancelled computer use.')
    }
    signal.addEventListener('abort', cancel, { once: true })
    renew(active)
    try {
      if (command.op === 'request') return await request(active, command, still)
      if (command.op === 'launch') {
        const approved = active.apps.get(command.app)
        if (approved === undefined) return error('That app has not been approved.')
        if (displayElsewhere(active)) return using('the primary display')
        const launched = await active.worker.run({ op: 'launch', app: approved })
        if (!still() || launched.kind !== 'launched') return error('App launch was interrupted. Check the desktop.')
        for (const window of launched.windows) {
          if (appElsewhere(active, window.pid) !== undefined) continue
          active.held.set(window.pid, window.app)
          active.windows.set(randomUUID(), window)
        }
        active.action = `Opened ${approved.name}.`
        changed(active)
        return summary(active)
      }
      const target = command.target === 'desktop' ? (active.desktop ? 'desktop' : undefined) : active.windows.get(command.target)
      if (target === undefined) return error('That window or display has not been approved.')
      if (target === 'desktop' && !options.canShareDisplay()) return error('The display layout no longer permits primary-display control.')
      if (target !== 'desktop') {
        if (appElsewhere(active, target.pid) !== undefined) return using(target.app)
        if (displayElsewhere(active)) return using('the primary display')
        active.held.set(target.pid, target.app)
      }
      const name = target === 'desktop' ? 'the primary display' : target.app
      if (command.op === 'observe' || command.op === 'evidence') {
        const observed = await active.worker.run({
          op: 'observe',
          target,
          screenshot: true,
        })
        if (!still() || observed.kind !== 'observed') return error('Computer use stopped before the observation could be returned.')
        active.action = `Observed ${name}.`
        if (target === 'desktop') active.frame = observed.frame
        active.preview = observed.picture === undefined ? undefined : { target: command.target, picture: observed.picture }
        changed(active)
        if (command.op === 'evidence' && observed.picture === undefined) return error('That window did not return a usable picture.')
        const givePicture = command.op === 'evidence' || command.screenshot === true || target === 'desktop'
        const value: ComputerAnswer = {
          ...observed.answer,
          ...(!givePicture || observed.picture === undefined ? {} : { picture: observed.picture }),
        }
        return { value }
      }
      // Input to the whole display could reach any app: it waits while another task holds one, then holds them all for the turn.
      const theirs = target === 'desktop' ? anyElsewhere(active) : undefined
      if (theirs !== undefined) return using(theirs)
      const inForeground = target === 'desktop' || command.foreground === true
      if (target === 'desktop' && options.desktopInputSafe?.(command, active.frame) === false)
        return error('Move away from the Althar window and take a fresh observation before sending input to the display.')
      if (inForeground && !active.foreground) return error('Foreground input needs the person’s approval. Request desktop access.')
      if (
        inForeground &&
        ((foreground !== undefined && foreground !== active) || [...sessions.values()].some((other) => other !== active && other.busy))
      )
        return error('Another task is using computer input. Wait before taking the foreground.')
      if (inForeground) foreground = active
      if (target === 'desktop') active.display = true
      active.action = `Using ${name}${inForeground ? ' in the foreground' : ''}.`
      changed(active)
      const acted = await active.worker.run({ op: 'act', target, action: command, foreground: inForeground })
      if (!still() || acted.kind !== 'acted') return error('Computer use was interrupted. Observe the app before retrying.')
      return { value: acted.answer }
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : 'Computer use failed. Check the app before retrying.')
    } finally {
      if (foreground === active) foreground = undefined
      active.busy = false
      signal.removeEventListener('abort', cancel)
      if (still() && active.action.startsWith('Using ')) {
        active.action = 'Waiting for the task’s next action.'
        changed(active)
      }
    }
  }

  return { call, allow, pause, resume, stop, stopAll, ended, states: () => [...sessions.values()].map((session) => stateOf(session)) }
}

export type ComputerSessions = ReturnType<typeof computerSessions>
