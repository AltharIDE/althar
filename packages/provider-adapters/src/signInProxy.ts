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
 * request". Through this proxy the name is asked of the nameservers directly, as `dig` asks them, and of the system only
 * where they fail or are slow; the first answer is the one used, and kept while the sign-in lasts. The agent itself is unchanged: it honours HTTPS_PROXY.
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

/** How long the nameservers are given, each try, before they count as not answering. */
const ASK_TIMEOUT = 2_500

/**
 * How long the nameservers have alone before the system is asked too. Its lookup (getaddrinfo) holds one of Node's few
 * worker threads until it answers, which the stalled resolver this is for makes minutes: it is asked only where the
 * nameservers fail or are slow, once a host at a time.
 */
const SYSTEM_AFTER = 1_000

/** How long an IPv6 answer waits for the IPv4 one beside it, so a Mac with no IPv6 route still has an address to try. */
const FOUR_GRACE = 150

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

export interface RaceOptions {
  /** How long the nameservers have alone before the system is asked too. */
  readonly systemAfter?: number
}

/**
 * A host's addresses from the nameservers, asked directly, and only where they fail or are slow from the system too: the
 * first with an address wins. Each host's answer is kept for as long as this lives (a sign-in's proxy), and the system is
 * never asked for one host twice at once.
 */
export const raceResolve = (ask: Resolve, system: Resolve, options: RaceOptions = {}): Resolve => {
  const systemAfter = options.systemAfter ?? SYSTEM_AFTER
  const known = new Map<string, Promise<ReadonlyArray<LookupAddress>>>()
  const asking = new Map<string, Promise<ReadonlyArray<LookupAddress>>>()
  const askSystemOnce = (host: string) => {
    const already = asking.get(host)
    if (already !== undefined) return already
    const lookup = system(host).finally(() => asking.delete(host))
    asking.set(host, lookup)
    return lookup
  }
  return (host) => {
    const kept = known.get(host)
    if (kept !== undefined) return kept
    const some = (all: ReadonlyArray<LookupAddress>) => (all.length > 0 ? all : Promise.reject(new Error(host)))
    const direct = ask(host).then(some)
    let timer: ReturnType<typeof setTimeout> | undefined
    const fallback = new Promise<void>((resolve) => {
      // A plain Promise's wait, outside any effect: the proxy answers sockets, not fibers.
      // oxlint-disable-next-line althar/one-clock
      timer = setTimeout(resolve, systemAfter)
      direct.catch(() => resolve())
    })
      .then(() => askSystemOnce(host))
      .then(some)
    const answer = Promise.any([direct, fallback]).finally(() => clearTimeout(timer))
    known.set(host, answer)
    // A host not found is asked again next time.
    answer.catch(() => known.delete(host))
    return answer
  }
}

/** The nameservers asked directly, both families: the IPv4 answer at once, an IPv6 one once IPv4's has had a moment. */
export const askNameservers = (four: (host: string) => Promise<string[]>, six: (host: string) => Promise<string[]>): Resolve => {
  const family = (records: Promise<string[]>, version: 4 | 6) =>
    records.then(
      (all) => all.map((address): LookupAddress => ({ address, family: version })),
      () => [],
    )
  return (host) =>
    new Promise((resolve) => {
      const found: Array<LookupAddress> = []
      let left = 2
      let grace: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        clearTimeout(grace)
        resolve([...found].sort((a, b) => a.family - b.family))
      }
      const take = (all: ReadonlyArray<LookupAddress>, version: 4 | 6) => {
        found.push(...all)
        left -= 1
        if (left === 0 || (version === 4 && all.length > 0)) return done()
        // oxlint-disable-next-line althar/one-clock
        if (all.length > 0) grace = setTimeout(done, FOUR_GRACE)
      }
      void family(four(host), 4).then((all) => take(all, 4))
      void family(six(host), 6).then((all) => take(all, 6))
    })
}

const nameservers = (): Resolve => {
  const resolver = new Resolver({ timeout: ASK_TIMEOUT, tries: 2 })
  return askNameservers(
    (host) => new Promise((resolve, reject) => resolver.resolve4(host, (error, all) => (error ? reject(error) : resolve(all)))),
    (host) => new Promise((resolve, reject) => resolver.resolve6(host, (error, all) => (error ? reject(error) : resolve(all)))),
  )
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
  return openResolvingProxy(options.resolve ?? raceResolve(nameservers(), askSystem)).catch(() => null)
}
