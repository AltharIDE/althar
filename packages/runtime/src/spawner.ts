import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

import { Context } from 'effect'

/*
 * Where the runtime starts its own short commands, git's above all: on a
 * thread of their own, not the one that answers the window. Starting a
 * process holds the thread that starts it until the child has started
 * (libuv waits for its exec), which on a busy computer takes 5 to 30 ms
 * each, and a board read alone started a dozen: on the runtime's one thread
 * they kept every window waiting. Here the runner thread waits instead.
 *
 * At most a few run at once, as many as half the computer's cores, from 2 to
 * 8: what agents' builds leave of the computer goes to the window's reads
 * rather than to a crowd of git processes. Those the person waits on (a
 * window's call, `Foreground`) have as many again of their own, so none
 * waits behind the background's. A command that reaches a remote, such as a
 * fetch or a push, waits on the network for up to minutes, not on the
 * computer: those run in a lane of their own, the same few and the person's
 * few, so however many are under way, a read of the computer's own still
 * starts at once. What each command printed
 * comes back whole, as text, up to `max` bytes; past that it is stopped and
 * says so (`over`). Stopped, a command started in a session of its own is
 * stopped with its whole group, as git with the ssh it started.
 *
 * The runner's code is plain JavaScript in a string, run as the worker's
 * script, so it needs nothing bundled beside the runtime. Where a worker
 * can't be made, or one stops before it ever answered, commands start on
 * this thread from then on, as they always did; one that stops later is
 * made again, and what it was running says it stopped.
 */

/** Whether what runs now is the person's: a window's call, whose commands go before the background's. */
export const Foreground = Context.Reference<boolean>('@althar/runtime/spawner/Foreground', { defaultValue: () => false })

export interface Started {
  /** Its end: its exit code or signal, or the error it couldn't start with, and what it printed. */
  readonly result: Promise<Ended>
  /** Stops it, with its group where it has one of its own; one still waiting to start never starts. */
  readonly stop: () => void
}

export interface Ended {
  readonly code: number | null
  readonly signal: string | null
  /** Why it couldn't run, as Node said: `ENOENT` for a command not found. */
  readonly error: { readonly message: string; readonly code: string | number | null } | null
  readonly stdout: string
  readonly stderr: string
  /** It printed more than `max` bytes, and was stopped. */
  readonly over: boolean
}

export interface Command {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env: Readonly<Record<string, string | undefined>>
  /** In a session of its own, stopped with its group. */
  readonly detached: boolean
  readonly input?: string
  readonly max: number
  /** The person's: it never waits behind the background's. */
  readonly first?: boolean
  /** It reaches a remote, as a fetch or a push does: it runs in the network's lane, never holding the computer's. */
  readonly network?: boolean
}

/** How many run at once in each lane, the person's and the background's, of the computer's and of the network's: half the cores, from 2 to 8. */
export const AT_ONCE = Math.min(8, Math.max(2, Math.floor(availableParallelism() / 2)))

/**
 * Whether git's arguments reach a remote: a fetch, a push, a clone, `ls-remote`, or a remote's or submodule's update.
 * What comes before the command's name, as `-c name=value` or `-C folder`, is passed over.
 */
export const reachesRemote = (args: ReadonlyArray<string>) => {
  let at = 0
  while (at < args.length && (args[at] ?? '').startsWith('-'))
    at += ['-c', '-C', '--git-dir', '--work-tree', '--namespace'].includes(args[at] ?? '') ? 2 : 1
  const [name, then] = [args[at], args[at + 1]]
  if (name === undefined) return false
  if (['fetch', 'push', 'pull', 'clone', 'ls-remote', 'fetch-pack', 'send-pack'].includes(name)) return true
  return (name === 'remote' && ['update', 'show', 'prune'].includes(then ?? '')) || (name === 'submodule' && then === 'update')
}

/*
 * The runner, in the worker: it takes commands, runs as many at once as it's told in each lane (the person's or the
 * background's, of the computer or of the network), and answers with how each ended.
 */
const RUNNER = `
const { parentPort, workerData } = require('node:worker_threads')
const { spawn } = require('node:child_process')
let cap = workerData.cap
const lanes = new Map()
const laneOf = (job) => {
  const key = (job.network ? 'network' : 'local') + (job.first ? ' first' : ' rest')
  let lane = lanes.get(key)
  if (lane === undefined) lanes.set(key, (lane = { waiting: [], running: 0 }))
  return lane
}
const running = new Map()
const answer = (id, ended) => parentPort.postMessage({ kind: 'ended', id, ended })
const next = () => {
  for (const lane of lanes.values())
    while (lane.running < cap && lane.waiting.length > 0) start(lane.waiting.shift(), lane)
}
const start = (job, lane) => {
  lane.running += 1
  const out = []
  const err = []
  let size = 0
  let over = false
  let done = false
  let child
  const finish = (ended) => {
    if (done) return
    done = true
    running.delete(job.id)
    lane.running -= 1
    answer(job.id, { code: null, signal: null, error: null, ...ended, over, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() })
    next()
  }
  try {
    child = spawn(job.command, job.args, { cwd: job.cwd, env: job.env, detached: job.detached, windowsHide: true })
  } catch (error) {
    running.set(job.id, { stop: () => undefined })
    return finish({ error: { message: String(error && error.message || error), code: error && error.code || null } })
  }
  let stopped = false
  const closePipes = () => {
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
  child.once('exit', () => { if (stopped) closePipes() })
  const stop = () => {
    stopped = true
    try {
      if (job.detached && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
      else child.kill()
    } catch {
      child.kill()
    }
    // A descendant may keep the pipes after this root exits. Wait for Node to record its exit before closing
    // our reads: on Windows, closing them first can emit close with a null code even when the root exited 0.
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) closePipes()
  }
  running.set(job.id, { stop })
  const collect = (into) => (chunk) => {
    size += chunk.length
    if (size > job.max) {
      over = true
      return stop()
    }
    into.push(chunk)
  }
  child.stdout.on('data', collect(out))
  child.stderr.on('data', collect(err))
  child.on('error', (error) => finish({ error: { message: error.message, code: error.code === undefined ? null : error.code } }))
  child.on('close', (code, signal) => finish({ code, signal }))
  child.stdin.on('error', () => undefined)
  child.stdin.end(job.input)
}
parentPort.on('message', (message) => {
  if (message.kind === 'start') {
    laneOf(message.job).waiting.push(message.job)
    return next()
  }
  if (message.kind === 'stop') {
    const one = running.get(message.id)
    if (one !== undefined) return one.stop()
    for (const { waiting: queue } of lanes.values()) {
      const at = queue.findIndex((job) => job.id === message.id)
      if (at >= 0) {
        queue.splice(at, 1)
        answer(message.id, { code: null, signal: 'SIGTERM', error: null, over: false, stdout: '', stderr: '' })
      }
    }
  }
})
`

type Waiting = (ended: Ended) => void

/** The runner thread, made on first use and again after one that stopped. */
let runner: { readonly worker: Worker; readonly waiting: Map<number, Waiting> } | undefined
let made = 0
let ids = 0
/* A runner that stopped before it ever answered can't run here: commands start on this thread from then on, as they did. */
let here = false

const runnerNow = (cap: number) => {
  if (runner !== undefined) return runner
  const worker = new Worker(RUNNER, { eval: true, workerData: { cap } })
  const waiting = new Map<number, Waiting>()
  const one = { worker, waiting }
  let answered = false
  // It keeps the process open only while a command runs, as a child process of this thread's would.
  worker.unref()
  worker.on('message', (message: { readonly kind: 'ended'; readonly id: number; readonly ended: Ended }) => {
    answered = true
    const resolve = waiting.get(message.id)
    waiting.delete(message.id)
    if (waiting.size === 0) worker.unref()
    resolve?.(message.ended)
  })
  const gone = (why: string) => {
    if (runner === one) runner = undefined
    if (!answered && !here) {
      here = true
      // In the runtime's log: where its commands start, and why.
      console.warn(`Commands start on the runtime's thread from now on: ${why}`)
    }
    for (const resolve of waiting.values())
      resolve({ code: null, signal: null, error: { message: why, code: null }, stdout: '', stderr: '', over: false })
    waiting.clear()
  }
  worker.on('error', (error) => gone(`Althar’s command runner stopped: ${error.message}`))
  worker.on('exit', () => gone('Althar’s command runner stopped.'))
  runner = one
  made += 1
  return one
}

/** How many runner threads were made, for a test that one serves every command. */
export const runnersMade = () => made

/** Starts a command on the runner thread, or here where there can be none. */
export const startApart = (command: Command, cap = AT_ONCE): Started => {
  if (here) return startHere(command)
  let at: ReturnType<typeof runnerNow>
  try {
    at = runnerNow(cap)
  } catch (error) {
    here = true
    console.warn(`Commands start on the runtime's thread: ${error instanceof Error ? error.message : String(error)}`)
    return startHere(command)
  }
  const id = (ids += 1)
  const result = new Promise<Ended>((resolve) => at.waiting.set(id, resolve))
  if (at.waiting.size === 1) at.worker.ref()
  at.worker.postMessage({
    kind: 'start',
    job: {
      id,
      command: command.command,
      args: [...command.args],
      cwd: command.cwd,
      env: command.env,
      detached: command.detached,
      input: command.input,
      max: command.max,
      first: command.first === true,
      network: command.network === true,
    },
  })
  return { result, stop: () => at.worker.postMessage({ kind: 'stop', id }) }
}

/** A command started on this thread, as the runner would start it: where no worker can be made. */
export const startHere = (command: Command): Started => {
  const out: Array<Buffer> = []
  const err: Array<Buffer> = []
  let size = 0
  let over = false
  const child = spawn(command.command, [...command.args], {
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    env: command.env,
    detached: command.detached,
    windowsHide: true,
  })
  let stopped = false
  const closePipes = () => {
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
  child.once('exit', () => {
    if (stopped) closePipes()
  })
  const stop = () => {
    stopped = true
    try {
      if (command.detached && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
      else child.kill()
    } catch {
      child.kill()
    }
    // As on the runner thread, preserve the root's exit code before closing pipes held by descendants.
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) closePipes()
  }
  const collect = (into: Array<Buffer>) => (chunk: Buffer) => {
    size += chunk.length
    if (size > command.max) {
      over = true
      return stop()
    }
    into.push(chunk)
  }
  child.stdout.on('data', collect(out))
  child.stderr.on('data', collect(err))
  const result = new Promise<Ended>((resolve) => {
    let done = false
    const finish = (ended: Pick<Ended, 'code' | 'signal' | 'error'>) => {
      if (done) return
      done = true
      resolve({ ...ended, over, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() })
    }
    child.on('error', (error: Error & { readonly code?: string | number }) =>
      finish({ code: null, signal: null, error: { message: error.message, code: error.code ?? null } }),
    )
    child.on('close', (code, signal) => finish({ code, signal, error: null }))
  })
  child.stdin.on('error', () => undefined)
  child.stdin.end(command.input)
  return { result, stop }
}
