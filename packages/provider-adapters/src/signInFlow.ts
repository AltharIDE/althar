import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'

import { asNode } from './process'
import type { AgentDefinition } from './registry'

/*
 * An agent's own sign-in, run by Althar rather than in a terminal (ADR-012:
 * the agent keeps its sign-in; Althar never reads its credential store). The
 * agent's login runs as a child in the account's home and says where it
 * stands: the page to approve in the browser, a one-time code to type on
 * another, a code pasted back, done and who as, or why it stopped.
 *
 * Two kinds, as the agents offer them:
 * - Claude Code's `claude auth login` opens the browser itself and comes back
 *   to its own callback; it also prints a page that ends in a code, which it
 *   reads from stdin, for a browser that can't reach back.
 * - Codex's app-server speaks JSON-RPC on stdio: `account/login/start` gives
 *   the page to open, or a device code, and `account/login/completed` says
 *   how it ended. It opens no browser, so Althar does.
 */

/** A way in that Althar can run itself. */
export type SignInWay = 'browser' | 'device'

/** How an agent's sign-in runs inside Althar, where it can. */
export type InAppSignIn =
  | {
      readonly kind: 'claude-login'
      readonly ways: ReadonlyArray<SignInWay>
      readonly run: (node: string) => { command: string; args: ReadonlyArray<string> }
    }
  | {
      readonly kind: 'codex-app-server'
      readonly ways: ReadonlyArray<SignInWay>
      readonly run: (node: string) => { command: string; args: ReadonlyArray<string> }
    }

/** What a sign-in under way says. */
export type SignInFlowEvent =
  /** Waiting on the browser. `link` opens it elsewhere; `paste`: a code the page shows can be pasted back. */
  | { readonly kind: 'browser'; readonly link: string | null; readonly paste: boolean }
  /** A one-time code to type on `page`, good for `minutes`. */
  | { readonly kind: 'device'; readonly code: string; readonly page: string; readonly minutes: number }
  /** A pasted code the agent turned down, in its words. */
  | { readonly kind: 'refused'; readonly message: string }
  /** Signed in, as `who` on `plan` where the agent says. */
  | { readonly kind: 'done'; readonly who: string | null; readonly plan: string | null }
  | { readonly kind: 'failed'; readonly message: string }

export interface SignInFlowHandle {
  /** A code the browser's page showed, for the agent. */
  readonly paste: (code: string) => void
  /** Stops it; nothing more is said. */
  readonly cancel: () => void
}

export interface SignInFlowOptions {
  readonly way: SignInWay
  readonly node?: string
  /** The account's home, as the agent's environment points at it; none for its usual folder. */
  readonly home?: Readonly<Record<string, string>>
  /** Opens a page in the person's browser, for an agent that doesn't itself. */
  readonly openUrl?: (url: string) => void
  /** How long it waits before it gives up, in ms. */
  readonly timeout?: number
}

const FIFTEEN_MINUTES = 15 * 60_000

/** The text at the end of what an agent printed: its last line that says something. */
const lastLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? null

/** Who Claude Code is signed in as, and on what plan, from its JSON status. */
export const claudeWho = (output: string): { readonly who: string | null; readonly plan: string | null } => {
  try {
    const status: unknown = JSON.parse(output)
    if (typeof status !== 'object' || status === null) return { who: null, plan: null }
    const field = (name: string) => {
      const value: unknown = (status as Record<string, unknown>)[name]
      return typeof value === 'string' && value !== '' ? value : null
    }
    const plan = field('subscriptionType')
    return { who: field('email'), plan: plan === null ? null : `Claude ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` }
  } catch {
    return { who: null, plan: null }
  }
}

/** ChatGPT's plan names, as the agent gives them. */
const chatGptPlan = (plan: unknown) =>
  typeof plan === 'string' && plan !== '' ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : null

/**
 * Starts an agent's sign-in inside Althar, saying each step to `say`; null
 * where the agent has no such sign-in, or not this way.
 */
export const startSignInFlow = (
  agent: AgentDefinition,
  say: (event: SignInFlowEvent) => void,
  options: SignInFlowOptions,
): SignInFlowHandle | null => {
  const inApp = agent.signIn.inApp
  if (inApp === undefined || !inApp.ways.includes(options.way)) return null
  const node = options.node ?? process.execPath
  const spec = inApp.run(node)
  const env = { ...process.env, ...asNode({ command: spec.command, args: spec.args }), ...options.home }
  const child = spawn(spec.command, [...spec.args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let over = false
  const end = (event?: SignInFlowEvent) => {
    if (over) return
    over = true
    clearTimeout(timer)
    if (event !== undefined) say(event)
    if (child.exitCode === null) child.kill()
  }
  const timer = setTimeout(
    () => end({ kind: 'failed', message: 'The sign-in wasn’t finished in time.' }),
    options.timeout ?? FIFTEEN_MINUTES,
  )
  child.on('error', (error) => end({ kind: 'failed', message: error.message }))
  // Its input closed under a write (EPIPE) ends the sign-in, rather than the process Althar runs in.
  child.stdin.on('error', () => end({ kind: 'failed', message: 'The agent stopped listening while signing in.' }))
  const driven = inApp.kind === 'claude-login' ? claude(agent, child, say, end, env) : codex(child, say, end, options)
  return {
    paste: (code) => {
      if (!over) driven.paste(code)
    },
    cancel: () => {
      if (over) return
      driven.cancel()
      end()
    },
  }
}

type End = (event?: SignInFlowEvent) => void

/* Claude Code's own login: the browser opens by itself; its fallback page and a pasted code come over stdio. */
const claude = (
  agent: AgentDefinition,
  child: ChildProcessWithoutNullStreams,
  say: (event: SignInFlowEvent) => void,
  end: End,
  env: NodeJS.ProcessEnv,
) => {
  let said = ''
  let stderr = ''
  let link: string | null = null
  // Said once the caller has the handle.
  queueMicrotask(() => say({ kind: 'browser', link: null, paste: false }))
  child.stdout.on('data', (chunk: Buffer) => {
    said += String(chunk)
    const found = /visit:\s*(https:\/\/\S+)/.exec(said)?.[1] ?? null
    if (found !== null && found !== link) {
      link = found
      say({ kind: 'browser', link, paste: true })
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = String(chunk)
    stderr += text
    if (/invalid code/i.test(text)) say({ kind: 'refused', message: lastLine(text) ?? text.trim() })
  })
  child.on('exit', (code) => {
    if (code !== 0) return end({ kind: 'failed', message: lastLine(stderr) ?? lastLine(said) ?? 'Claude Code stopped signing in.' })
    // Signed in: its status says who as.
    const status = agent.signIn.status(process.execPath)
    execFile(status.command, [...status.args], { env, timeout: 15_000 }, (_error, stdout) => end({ kind: 'done', ...claudeWho(stdout) }))
  })
  return {
    paste: (code: string) => void child.stdin.write(`${code.trim()}\n`),
    cancel: () => undefined,
  }
}

/* Codex's app-server: JSON-RPC lines on stdio. */
const codex = (child: ChildProcessWithoutNullStreams, say: (event: SignInFlowEvent) => void, end: End, options: SignInFlowOptions) => {
  let next = 0
  let loginId: string | null = null
  const waiting = new Map<number, (result: Record<string, unknown> | null, error: string | null) => void>()
  const send = (method: string, params: unknown, then?: (result: Record<string, unknown> | null, error: string | null) => void) => {
    const id = ++next
    if (then !== undefined) waiting.set(id, then)
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  }
  const notify = (method: string, params: unknown) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += String(chunk)
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      heard(line)
    }
  })
  const heard = (line: string) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof message.id === 'number' && waiting.has(message.id)) {
      const then = waiting.get(message.id)
      waiting.delete(message.id)
      const error = message.error as { message?: unknown } | undefined
      then?.(
        (message.result as Record<string, unknown> | undefined) ?? null,
        error === undefined ? null : typeof error.message === 'string' ? error.message : 'Codex refused.',
      )
      return
    }
    if (message.method !== 'account/login/completed') return
    const params = (message.params ?? {}) as Record<string, unknown>
    if (params.loginId !== loginId) return
    if (params.success !== true)
      return end({ kind: 'failed', message: typeof params.error === 'string' ? params.error : 'Codex didn’t finish signing in.' })
    // Signed in: the account says who as.
    send('account/read', {}, (result) => {
      const account = (result?.account ?? null) as Record<string, unknown> | null
      end({ kind: 'done', who: typeof account?.email === 'string' ? account.email : null, plan: chatGptPlan(account?.planType) })
    })
  }
  child.on('exit', () => end({ kind: 'failed', message: 'Codex stopped signing in.' }))
  send('initialize', { clientInfo: { name: 'althar', title: 'Althar', version: '0' } }, (_result, error) => {
    if (error !== null) return end({ kind: 'failed', message: error })
    notify('initialized', {})
    send('account/login/start', { type: options.way === 'device' ? 'chatgptDeviceCode' : 'chatgpt' }, (result, failed) => {
      if (failed !== null || result === null) return end({ kind: 'failed', message: failed ?? 'Codex didn’t start signing in.' })
      loginId = typeof result.loginId === 'string' ? result.loginId : null
      if (typeof result.authUrl === 'string') {
        options.openUrl?.(result.authUrl)
        say({ kind: 'browser', link: result.authUrl, paste: false })
      } else if (typeof result.userCode === 'string' && typeof result.verificationUrl === 'string')
        say({ kind: 'device', code: result.userCode, page: result.verificationUrl, minutes: 15 })
      else end({ kind: 'failed', message: 'Codex didn’t say how to sign in.' })
    })
  })
  return {
    paste: () => undefined,
    cancel: () => {
      if (loginId !== null) send('account/login/cancel', { loginId })
    },
  }
}
