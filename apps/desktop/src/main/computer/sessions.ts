import { randomUUID } from 'node:crypto'

import type {
  ComputerAnswer,
  ComputerCall,
  ComputerDecision,
  ComputerDone,
  ComputerOwner,
  ComputerState,
} from '@althar/runtime/computerBridge'

import type { NativeApp, NativeWindow } from '../../computer/protocol'
import type { ComputerWorker } from './worker'

const ASK_FOR = 150_000
const IDLE = 5 * 60_000
const MAX_SESSIONS = 12
const sameTurn = (one: ComputerOwner, other: ComputerOwner) => one.sessionId === other.sessionId && one.turnId === other.turnId

interface Pending {
  readonly id: string
  readonly desktop: boolean
  readonly reason: string
  readonly windows: ReadonlyMap<string, NativeWindow>
  readonly apps: ReadonlyMap<string, NativeApp>
  readonly timer: ReturnType<typeof setTimeout>
  readonly settle: (done: ComputerDone) => void
}

interface Session {
  readonly owner: ComputerOwner
  readonly worker: ComputerWorker
  readonly windows: Map<string, NativeWindow>
  readonly apps: Map<string, NativeApp>
  pending?: Pending | undefined
  timer?: ReturnType<typeof setTimeout> | undefined
  preview?: ComputerState['preview']
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
  readonly available: () => boolean
  readonly desktopInputSafe?: () => boolean
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
      : {
          request: {
            id: session.pending.id,
            desktop: session.pending.desktop,
            reason: session.pending.reason,
            windows: publicWindows(session.pending.windows),
            apps: publicApps(session.pending.apps),
          },
        }),
  })
  const changed = (session: Session) => options.changed(stateOf(session))
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
    session.windows.clear()
    session.apps.clear()
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
    const windows = new Map(
      inventory.value.windows
        .filter((one) => ![...session.windows.values()].some((kept) => kept.pid === one.pid && kept.handle === one.handle))
        .map((one) => [randomUUID(), one]),
    )
    const apps = new Map(inventory.value.apps.map((one) => [randomUUID(), one]))
    const access = await new Promise<ComputerDone>((resolve) => {
      const id = randomUUID()
      const timer = setTimeout(() => stop(session.owner.taskId, 'Computer access was not approved in time.'), ASK_FOR)
      session.pending = { id, desktop: call.desktop === true, reason: call.reason, windows, apps, timer, settle: resolve }
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
    if ((decision.desktop || decision.foreground) && !waiting.desktop) return false
    const selected = [...new Set(decision.windows)]
    if (selected.some((id) => !waiting.windows.has(id) && !waiting.apps.has(id))) return false
    if (session.windows.size + session.apps.size + selected.length > 40) return false
    for (const id of selected) {
      const window = waiting.windows.get(id)
      if (
        window !== undefined &&
        [...sessions.values()].some((other) => other !== session && [...other.windows.values()].some((one) => one.pid === window.pid))
      )
        return false
    }
    for (const id of selected) {
      const window = waiting.windows.get(id)
      const app = waiting.apps.get(id)
      if (window !== undefined) session.windows.set(id, window)
      if (app !== undefined) session.apps.set(id, app)
    }
    session.desktop ||= decision.desktop
    session.foreground ||= decision.foreground || decision.desktop
    if (selected.length === 0 && !decision.desktop && !decision.foreground) {
      settle(session, error('The person declined computer access.'))
      if (session.windows.size === 0 && session.apps.size === 0 && !session.desktop) return stop(taskId, 'Computer access declined.')
      session.action = 'Additional computer access declined.'
    } else {
      settle(session, summary(session))
      session.action = 'Computer access approved.'
    }
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
        const launched = await active.worker.run({ op: 'launch', app: approved })
        if (!still() || launched.kind !== 'launched') return error('App launch was interrupted. Check the desktop.')
        for (const window of launched.windows) {
          if ([...sessions.values()].some((other) => other !== active && [...other.windows.values()].some((one) => one.pid === window.pid)))
            continue
          if (active.windows.size >= 40) break
          active.windows.set(randomUUID(), window)
        }
        active.action = `Opened ${approved.name}.`
        changed(active)
        return summary(active)
      }
      const target = command.target === 'desktop' ? (active.desktop ? 'desktop' : undefined) : active.windows.get(command.target)
      if (target === undefined) return error('That window or display has not been approved.')
      const name = target === 'desktop' ? 'the primary display' : target.app
      if (command.op === 'observe' || command.op === 'evidence') {
        const observed = await active.worker.run({
          op: 'observe',
          target,
          screenshot: true,
        })
        if (!still() || observed.kind !== 'observed') return error('Computer use stopped before the observation could be returned.')
        active.action = `Observed ${name}.`
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
      const inForeground = target === 'desktop' || command.foreground === true
      if (target === 'desktop' && options.desktopInputSafe?.() === false)
        return error('Move away from the Althar window before sending input to the display.')
      if (inForeground && !active.foreground) return error('Foreground input needs the person’s approval. Request desktop access.')
      if (
        inForeground &&
        ((foreground !== undefined && foreground !== active) || [...sessions.values()].some((other) => other !== active && other.busy))
      )
        return error('Another task is using computer input. Wait before taking the foreground.')
      if (inForeground) foreground = active
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
