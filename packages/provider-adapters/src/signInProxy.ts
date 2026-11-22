import { execFile } from 'node:child_process'
import { lookup as systemLookup, type LookupAddress, Resolver } from 'node:dns'
import http from 'node:http'
import net from 'node:net'

import type { AgentDefinition } from './registry'

/*
 * A sign-in's own way out, on macOS: a proxy on this computer that an agent's login reaches its provider through,
 * finding each host's address itself.
 *
 * Codex's login finishes by sending the browser's code to OpenAI's token endpoint, and gives that ten seconds. On a Mac
 * whose system resolver (mDNSResponder) stops answering a name for minutes on end, as it does in front of a local DNS
 * filter while the filter itself answers at once, that lookup alone outlasts it: "Token exchange failed: error sending
 * request". Through this proxy the name is asked of the nameservers directly, as `dig` asks them, and of the system at
 * the same time, and the first answer is the one used. The agent itself is unchanged: it honours HTTPS_PROXY.
 *
 * None where the person already goes through a proxy of their own, in the environment or the Mac's network settings:
 * theirs stands.
 */

export interface SignInProxy {
  /** Its address, as HTTPS_PROXY names it. */
  readonly url: string
  /** The variables that send the agent through it. */
  readonly env: Readonly<Record<string, string>>
  readonly close: () => void
}

/** A host's addresses, every family, or why none. */
export type Resolve = (host: string) => Promise<ReadonlyArray<LookupAddress>>

const PROXY_VARIABLES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const

/** How long the nameservers are given, each try, before the system's answer is all there is to wait for. */
const ASK_TIMEOUT = 2_500

/** Whether the environment already sends HTTP through a proxy. */
export const proxiedByEnv = (env: NodeJS.ProcessEnv) => PROXY_VARIABLES.some((name) => (env[name] ?? '').trim() !== '')

/** Whether macOS's network settings send HTTP through a proxy, or a script that picks one, as `scutil --proxy` says. */
export const proxiedBySettings = (said: string) =>
  /\b(HTTPEnable|HTTPSEnable|SOCKSEnable|ProxyAutoConfigEnable|ProxyAutoDiscoveryEnable)\s*:\s*1\b/.test(said)

const macProxied = () =>
  new Promise<boolean>((resolve) =>
    // Unread is taken for a proxy: the person's own way out stands where Althar can't tell.
    execFile('/usr/sbin/scutil', ['--proxy'], { timeout: 5_000 }, (error, stdout) => resolve(error !== null || proxiedBySettings(stdout))),
  )

/** The nameservers asked directly, both families, beside the system's own lookup: the first with an address wins. */
export const raceResolve = (ask: Resolve, system: Resolve): Resolve => {
  return (host) =>
    Promise.any([ask(host), system(host)].map((found) => found.then((all) => (all.length > 0 ? all : Promise.reject(new Error(host))))))
}

const askNameservers = (): Resolve => {
  const resolver = new Resolver({ timeout: ASK_TIMEOUT, tries: 2 })
  const family = (records: Promise<string[]>, version: 4 | 6) =>
    records.then(
      (all) => all.map((address): LookupAddress => ({ address, family: version })),
      () => [],
    )
  return async (host) => {
    const [four, six] = await Promise.all([
      family(new Promise((resolve, reject) => resolver.resolve4(host, (error, all) => (error ? reject(error) : resolve(all)))), 4),
      family(new Promise((resolve, reject) => resolver.resolve6(host, (error, all) => (error ? reject(error) : resolve(all)))), 6),
    ])
    return [...four, ...six]
  }
}

const askSystem: Resolve = (host) =>
  new Promise((resolve, reject) => systemLookup(host, { all: true }, (error, all) => (error ? reject(error) : resolve(all))))

/** As `net.connect` asks for a host's addresses: all of them where it tries each family in turn, one where it doesn't. */
const lookupWith =
  (resolve: Resolve): net.LookupFunction =>
  (host, options, callback) => {
    resolve(host).then(
      (all) => {
        if (options.all === true) return callback(null, [...all])
        const first = all.find((one) => options.family === undefined || options.family === 0 || one.family === options.family) ?? all[0]
        callback(null, first?.address ?? '', first?.family ?? 4)
      },
      (error: unknown) => callback(Object.assign(new Error(`No address for ${host}`), { code: 'ENOTFOUND', cause: error }), ''),
    )
  }

/** Opens the proxy, on this computer only, its addresses found by `resolve`. */
export const openResolvingProxy = (resolve: Resolve): Promise<SignInProxy> => {
  const lookup = lookupWith(resolve)
  const sockets = new Set<net.Socket>()
  const server = http.createServer((request, response) => {
    // Plain HTTP, by its whole address, as a proxy is sent it.
    let target: URL
    try {
      target = new URL(request.url ?? '')
    } catch {
      return void response.writeHead(400).end()
    }
    const host = target.hostname.replace(/^\[|\]$/g, '')
    const port = target.port === '' ? 80 : Number(target.port)
    const onward = http.request(
      {
        host,
        port,
        path: `${target.pathname}${target.search}`,
        method: request.method ?? 'GET',
        headers: request.headers,
        createConnection: () => net.connect({ host, port, lookup, autoSelectFamily: true }),
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      },
    )
    onward.on('error', () => (response.headersSent ? response.destroy() : response.writeHead(502).end()))
    request.pipe(onward)
  })
  server.on('connect', (request: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    sockets.add(client)
    client.on('close', () => sockets.delete(client))
    const at = (request.url ?? '').lastIndexOf(':')
    const host = (request.url ?? '').slice(0, at).replace(/^\[|\]$/g, '')
    const port = Number((request.url ?? '').slice(at + 1))
    if (at <= 0 || !Number.isInteger(port) || port <= 0 || port > 65_535) return void client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    const onward = net.connect({ host, port, lookup, autoSelectFamily: true })
    sockets.add(onward)
    onward.on('close', () => sockets.delete(onward))
    let open = false
    onward.once('connect', () => {
      open = true
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) onward.write(head)
      onward.pipe(client)
      client.pipe(onward)
    })
    onward.on('error', () => (open ? client.destroy() : client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')))
    client.on('error', () => onward.destroy())
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') return reject(new Error('The sign-in proxy has no port.'))
      const url = `http://127.0.0.1:${address.port}`
      resolve({
        url,
        env: {
          HTTPS_PROXY: url,
          https_proxy: url,
          HTTP_PROXY: url,
          http_proxy: url,
          // The agent's own listener for the browser's return, and anything else on this computer, stays direct.
          NO_PROXY: 'localhost,127.0.0.1,::1',
          no_proxy: 'localhost,127.0.0.1,::1',
        },
        close: () => {
          server.close()
          for (const socket of sockets) socket.destroy()
        },
      })
    })
  })
}

export interface SignInProxyOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  /** Whether the system's network settings name a proxy; macOS's, read with `scutil`, by default. */
  readonly settingsProxied?: () => Promise<boolean>
  readonly resolve?: Resolve
}

/**
 * The proxy an agent's sign-in goes out through, where it needs one: Codex's login on macOS, with no proxy of the
 * person's own. None elsewhere, or where it couldn't be opened: the login then goes out as it always did.
 */
export const openSignInProxy = async (agent: AgentDefinition, options: SignInProxyOptions = {}): Promise<SignInProxy | null> => {
  if (agent.signIn.inApp?.kind !== 'codex-app-server') return null
  if ((options.platform ?? process.platform) !== 'darwin') return null
  if (proxiedByEnv(options.env ?? process.env)) return null
  if (await (options.settingsProxied ?? macProxied)()) return null
  return openResolvingProxy(options.resolve ?? raceResolve(askNameservers(), askSystem)).catch(() => null)
}
