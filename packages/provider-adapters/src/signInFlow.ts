import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'

import { Effect } from 'effect'

import { adapterNode, asNode, privateTemp, removeTemp } from './process'
import type { AgentDefinition, LaunchSpec } from './registry'
import type { SignInProxy } from './signInProxy'

/*
 * An agent's own sign-in, run by Althar rather than in a terminal (ADR-012:
 * the agent keeps its sign-in; Althar never reads its credential store). The
 * agent's login runs as a child in the account's home and says where it
 * stands: the page to approve in the browser, a one-time code to type on
 * another, a code pasted back, done and who as, or why it stopped.
 *
 * Four kinds, as the agents offer them:
 * Native Copilot's device flow runs in the runtime, without a child process.
 * - Claude Code's `claude auth login` opens the browser itself and comes back
 *   to its own callback; it also prints a page that ends in a code, which it
 *   reads from stdin, for a browser that can't reach back.
 * - Codex's app-server speaks JSON-RPC on stdio: `account/login/start` gives
 *   the page to open, or a device code, and `account/login/completed` says
 *   how it ended. It opens no browser, so Althar does.
 * - An ACP agent that signs in only through ACP's own `authenticate`
 *   (Antigravity's server): started as for a session, it prints the page to
 *   open, and `authenticate` answers once the browser has come back to it.
 *   Its own way to a browser is turned off, so Althar opens the page.
 */

/** A way in that Althar can run itself. */
export type SignInWay = 'browser' | 'device'

/** How an agent's sign-in runs inside Althar, where it can. */
export type InAppSignIn =
  | {
      readonly kind: 'copilot-device'
      readonly ways: ReadonlyArray<SignInWay>
    }
  | {
      readonly kind: 'claude-login'
      readonly ways: ReadonlyArray<SignInWay>
      readonly run: (node: string) => LaunchSpec
    }
  | {
      readonly kind: 'codex-app-server'
      readonly ways: ReadonlyArray<SignInWay>
      readonly run: (node: string) => LaunchSpec
    }
  | {
      readonly kind: 'acp-authenticate'
      readonly ways: ReadonlyArray<SignInWay>
      /** The agent as a session starts it. */
      readonly run: (node: string) => LaunchSpec
      /** The `authenticate` method it signs in with. */
      readonly method: string
      /** Where it prints the page to open: the page is what follows. */
      readonly link: RegExp
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
  /** Why it stopped: `message` in one short line (`signInSaid`), `detail` in the agent's own words, for the log only. */
  | { readonly kind: 'failed'; readonly message: string; readonly detail?: string }

export interface SignInFlowHandle {
  /** A code the browser's page showed, for the agent. */
  readonly paste: (code: string) => void
  /** Stops it; nothing more is said. */
  readonly cancel: () => void
}

export interface SignInFlowOptions {
  readonly way: SignInWay
  readonly host?: string
  readonly node?: string
  /** The account's home, as the agent's environment points at it; none for its usual folder. */
  readonly home?: Readonly<Record<string, string>>
  /** Opens a page in the person's browser, for an agent that doesn't itself. */
  readonly openUrl?: (url: string) => void
  /** How long it waits before it gives up, in ms. */
  readonly timeout?: number
  /** A way out of its own (`openSignInProxy`), closed once the sign-in has stopped. */
  readonly proxy?: SignInProxy | null
}

/**
 * What a sign-in that failed says beside its Try again: one short line, in fixed words. Never the agent's own words, an
 * address or an error's text: those go to the log only (the failed event's `detail`).
 */
export const signInSaid = {
  noReply: 'No reply. Check the connection.',
  timedOut: 'Not finished in time.',
  notApproved: 'Not approved.',
  /** Codex's login listens on one port for the browser: another login there (Codex's own app, a terminal) holds it. */
  busy: 'Another sign-in is open. Close it first.',
  stopped: (agent: string) => `${agent} stopped before signing in.`,
  notStarted: (agent: string) => `${agent} didn’t start.`,
  subscription: (agent: string) => `${agent} needs an eligible subscription on this account.`,
  ineligible: (agent: string) => `This account can't use ${agent}. Sign in with another.`,
  unknown: 'Couldn’t sign in.',
} as const

/** A sign-in's failure in the agent's own words, as the person is told it. */
export const signInFailureOf = (agent: string, raw: string): string =>
  /SUBSCRIPTION_REQUIRED/.test(raw)
    ? signInSaid.subscription(agent)
    : /ineligible|onboarding failed/i.test(raw)
      ? signInSaid.ineligible(agent)
      : /access_denied|denied access|cancell?ed|not approved/i.test(raw)
        ? signInSaid.notApproved
        : /EADDRINUSE|already in use/i.test(raw)
          ? signInSaid.busy
          : /stopped (signing in|listening)/i.test(raw)
            ? signInSaid.stopped(agent)
            : /error sending request|couldn.t (be )?reach|could not (be )?reach|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|network|dns|timed? ?out|connection (error|failed|refused|reset|closed)/i.test(
                  raw,
                )
              ? signInSaid.noReply
              : /in time|expired/i.test(raw)
                ? signInSaid.timedOut
                : signInSaid.unknown

/** A failure in the agent's own words: the short line, and its words for the log. */
const failure = (agent: string, raw: string): SignInFlowEvent => ({ kind: 'failed', message: signInFailureOf(agent, raw), detail: raw })

const FIFTEEN_MINUTES = 15 * 60_000
/** How long a sign-in told to stop has to read that, before it is killed. */
const CANCEL_GRACE = 2_000

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
  if (inApp === undefined || inApp.kind === 'copilot-device' || !inApp.ways.includes(options.way)) {
    options.proxy?.close()
    return null
  }
  const node = options.node ?? adapterNode()
  const spec = inApp.run(node)
  // Its own environment too, for an agent started as a session is (ACP's `authenticate`), and a temporary folder of its own where it asks.
  const temp = privateTemp(spec)
  const env = {
    ...process.env,
    ...asNode({ command: spec.command, args: spec.args }),
    ...spec.env,
    ...temp?.env,
    ...options.home,
    ...options.proxy?.env,
  }
  // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled.
  const launched = spec.onDevice === undefined ? spec : spec.onDevice({ env })
  const child = spawn(launched.command, [...launched.args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  // Its temporary folder and its way out go once it has stopped, or where it never started.
  const gone = () => {
    options.proxy?.close()
    Effect.runFork(removeTemp(temp?.folder))
  }
  child.on('exit', gone)
  child.on('error', gone)
  let over = false
  const end = (event?: SignInFlowEvent, grace = 0) => {
    if (over) return
    over = true
    clearTimeout(timer)
    if (event !== undefined) say(event)
    if (child.exitCode !== null) return
    if (grace === 0) child.kill()
    // Node's own timers, outside any effect: the child's time to finish, which only the process it runs in can keep.
    // oxlint-disable-next-line althar/one-clock
    else setTimeout(() => child.exitCode === null && child.kill(), grace).unref()
  }
  // oxlint-disable-next-line althar/one-clock
  const timer = setTimeout(
    () => end({ kind: 'failed', message: signInSaid.timedOut, detail: 'The sign-in wasn’t finished in time.' }),
    options.timeout ?? FIFTEEN_MINUTES,
  )
  child.on('error', (error) => end({ kind: 'failed', message: signInSaid.notStarted(agent.name), detail: error.message }))
  // Its input closed under a write (EPIPE) ends the sign-in, rather than the process Althar runs in.
  child.stdin.on('error', () =>
    end({ kind: 'failed', message: signInSaid.stopped(agent.name), detail: 'It stopped listening while signing in.' }),
  )
  // Once over, one still running out its grace says nothing more and opens no page; its input closed, it is sent nothing.
  const saying = (event: SignInFlowEvent) => {
    if (!over) say(event)
  }
  const opening = {
    ...options,
    openUrl: (url: string) => {
      if (!over) options.openUrl?.(url)
    },
  }
  const driven =
    inApp.kind === 'claude-login'
      ? claude(agent, child, saying, end, env)
      : inApp.kind === 'codex-app-server'
        ? codex(agent, child, saying, end, opening)
        : acpAuthenticate(agent, inApp, child, saying, end, opening)
  return {
    paste: (code) => {
      if (!over) driven.paste(code)
    },
    cancel: () => {
      if (over) return
      driven.cancel()
      // Told to stop, with its input closed after, it has a moment to read that before it is killed: a kill ends it at
      // once on Windows, where no process can hold on through one.
      child.stdin.end()
      end(undefined, CANCEL_GRACE)
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
    if (code !== 0) return end(failure(agent.name, lastLine(stderr) ?? lastLine(said) ?? 'Claude Code stopped signing in.'))
    // Signed in: its status says who as.
    const status = agent.signIn.status?.(adapterNode())
    if (status === undefined) return end({ kind: 'done', who: null, plan: null })
    const ran = status.onDevice === undefined ? status : status.onDevice({ env })
    execFile(ran.command, [...ran.args], { env, timeout: 15_000, windowsHide: true }, (_error, stdout) =>
      end({ kind: 'done', ...claudeWho(stdout) }),
    )
  })
  return {
    paste: (code: string) => void child.stdin.write(`${code.trim()}\n`),
    cancel: () => undefined,
  }
}

/* Codex's app-server: JSON-RPC lines on stdio. */
const codex = (
  agent: AgentDefinition,
  child: ChildProcessWithoutNullStreams,
  say: (event: SignInFlowEvent) => void,
  end: End,
  options: SignInFlowOptions,
) => {
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
      return end(failure(agent.name, typeof params.error === 'string' ? params.error : 'Codex didn’t finish signing in.'))
    // Signed in: the account says who as.
    send('account/read', {}, (result) => {
      const account = (result?.account ?? null) as Record<string, unknown> | null
      end({ kind: 'done', who: typeof account?.email === 'string' ? account.email : null, plan: chatGptPlan(account?.planType) })
    })
  }
  child.on('exit', () => end(failure(agent.name, 'Codex stopped signing in.')))
  send('initialize', { clientInfo: { name: 'althar', title: 'Althar', version: '0' } }, (_result, error) => {
    if (error !== null) return end(failure(agent.name, error))
    notify('initialized', {})
    send('account/login/start', { type: options.way === 'device' ? 'chatgptDeviceCode' : 'chatgpt' }, (result, failed) => {
      if (failed !== null || result === null) return end(failure(agent.name, failed ?? 'Codex didn’t start signing in.'))
      loginId = typeof result.loginId === 'string' ? result.loginId : null
      if (typeof result.authUrl === 'string') {
        options.openUrl?.(result.authUrl)
        say({ kind: 'browser', link: result.authUrl, paste: false })
      } else if (typeof result.userCode === 'string' && typeof result.verificationUrl === 'string')
        say({ kind: 'device', code: result.userCode, page: result.verificationUrl, minutes: 15 })
      else end(failure(agent.name, 'Codex didn’t say how to sign in.'))
    })
  })
  return {
    paste: () => undefined,
    cancel: () => {
      if (loginId !== null) send('account/login/cancel', { loginId })
    },
  }
}

/*
 * An ACP agent's own `authenticate` (Antigravity's server): initialized as a
 * client would, it prints the page to open, on either stream, and answers
 * once the browser has come back to its own listener on this computer.
 */
const acpAuthenticate = (
  agent: AgentDefinition,
  inApp: Extract<InAppSignIn, { readonly kind: 'acp-authenticate' }>,
  child: ChildProcessWithoutNullStreams,
  say: (event: SignInFlowEvent) => void,
  end: End,
  options: SignInFlowOptions,
) => {
  let next = 0
  let shown = false
  const waiting = new Map<number, (error: string | null) => void>()
  const send = (method: string, params: unknown, then: (error: string | null) => void) => {
    const id = ++next
    waiting.set(id, then)
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  }
  // The page, once: only an https address, as the agent printed it.
  const look = (text: string) => {
    const page = inApp.link.exec(text)?.[1]
    if (shown || page === undefined || !page.startsWith('https://')) return
    shown = true
    options.openUrl?.(page)
    say({ kind: 'browser', link: page, paste: false })
  }
  const heard = (line: string) => {
    let message: { readonly id?: unknown; readonly error?: { readonly message?: unknown } }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      return look(line)
    }
    if (typeof message.id !== 'number') return
    const then = waiting.get(message.id)
    waiting.delete(message.id)
    then?.(message.error === undefined ? null : typeof message.error.message === 'string' ? message.error.message : 'It refused.')
  }
  // Each stream a whole line at a time, as a pipe keeps no writes' bounds: the page is never read from half its line.
  // A last line left unended counts once the stream ends.
  const byLine = (stream: NodeJS.ReadableStream, each: (line: string) => void) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      buffer += chunk
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 1)
        each(line)
      }
    })
    stream.on('end', () => {
      if (buffer !== '') each(buffer)
      buffer = ''
    })
  }
  byLine(child.stdout, heard)
  byLine(child.stderr, look)
  child.on('exit', () => end(failure(agent.name, `${agent.name} stopped signing in.`)))
  send('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'althar', version: '0' } }, (error) => {
    if (error !== null) return end(failure(agent.name, error))
    send('authenticate', { methodId: inApp.method }, (failed) =>
      end(failed === null ? { kind: 'done', who: null, plan: null } : failure(agent.name, failed)),
    )
  })
  return { paste: () => undefined, cancel: () => undefined }
}
