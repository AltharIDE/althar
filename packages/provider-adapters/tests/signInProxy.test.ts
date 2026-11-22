import http from 'node:http'
import net from 'node:net'

import { describe, expect, it } from 'vitest'

import { type AgentDefinition, agents } from '../src/registry'
import { signInFailureOf, signInSaid, type SignInFlowEvent, startSignInFlow } from '../src/signInFlow'
import {
  askNameservers,
  openResolvingProxy,
  openSignInProxy,
  proxiedBySettings,
  raceResolve,
  type Resolve,
  type SignInProxy,
} from '../src/signInProxy'

/*
 * Codex's sign-in, on a Mac whose system resolver stalls on a name: its login
 * goes out through a proxy of its own that finds addresses itself, and a
 * failure reads as one short line, its own words kept for the log.
 */

const never: Resolve = () => new Promise(() => {})
const at =
  (address: string): Resolve =>
  async () => [{ address, family: 4 }]

/** A server on this computer that answers each connection with `hello`, then its first line back. */
const echo = () =>
  new Promise<{ readonly port: number; readonly close: () => void }>((resolve) => {
    const server = net.createServer((socket) => {
      socket.write('hello\n')
      socket.once('data', (data) => socket.end(`heard ${String(data)}`))
    })
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }))
  })

/** A tunnel through `proxy` to `target`, as an agent opens one: what it was answered, then what came through. */
const tunnel = (proxy: SignInProxy, target: string) =>
  new Promise<string>((resolve, reject) => {
    const { port } = new URL(proxy.url)
    const socket = net.connect(Number(port), '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`))
    let heard = ''
    socket.on('data', (data) => {
      heard += String(data)
      if (heard.includes('hello\n') && !heard.includes('heard')) socket.write('ping\n')
    })
    socket.on('end', () => resolve(heard))
    socket.on('error', reject)
  })

describe('a failed sign-in, as the person reads it', () => {
  it('is one short line, never the address or the error Codex said', () => {
    const said = 'Login server error: Token exchange failed: error sending request for url (https://auth.openai.com/oauth/token)'
    expect(signInFailureOf('Codex', said)).toBe(signInSaid.noReply)
    expect(signInFailureOf('Codex', 'Login server error: Port 127.0.0.1:1455 is already in use')).toBe(signInSaid.busy)
    expect(signInFailureOf('Codex', 'OAuth error: access_denied')).toBe(signInSaid.notApproved)
    expect(signInFailureOf('Codex', 'Codex stopped signing in.')).toBe('Codex stopped before signing in.')
    expect(signInFailureOf('Codex', 'Token exchange failed: token endpoint returned status 401 Unauthorized')).toBe(signInSaid.unknown)
    // A sign-in the person didn't finish isn't the connection's fault; a connection that timed out is.
    expect(signInFailureOf('Claude Code', 'login timed out after 300s')).toBe(signInSaid.timedOut)
    expect(signInFailureOf('Codex', 'Device code login timed out')).toBe(signInSaid.timedOut)
    expect(signInFailureOf('Codex', 'Token exchange failed: error trying to connect: operation timed out')).toBe(signInSaid.noReply)
    expect(signInFailureOf('Codex', 'connect ETIMEDOUT 104.18.41.241:443')).toBe(signInSaid.noReply)
    for (const line of Object.values(signInSaid).map((one) => (typeof one === 'string' ? one : one('Codex'))))
      expect(line).not.toMatch(/https?:|\(|\{|\b\d{3,}\b/)
  })
})

describe('the way out a Codex sign-in takes on a Mac', () => {
  const quiet = async () => false

  it('is only for Codex’s login on macOS, and never in place of a proxy the person set', async () => {
    const opened = await openSignInProxy(agents.codex, { platform: 'darwin', env: {}, settingsProxied: quiet, resolve: never })
    expect(opened?.env).toMatchObject({ HTTPS_PROXY: opened?.url, NO_PROXY: expect.stringContaining('127.0.0.1') })
    opened?.close()
    expect(await openSignInProxy(agents['claude-code'], { platform: 'darwin', env: {}, settingsProxied: quiet })).toBeNull()
    expect(await openSignInProxy(agents.codex, { platform: 'linux', env: {}, settingsProxied: quiet })).toBeNull()
    expect(
      await openSignInProxy(agents.codex, { platform: 'darwin', env: { https_proxy: 'http://corp:3128' }, settingsProxied: quiet }),
    ).toBeNull()
    expect(await openSignInProxy(agents.codex, { platform: 'darwin', env: {}, settingsProxied: async () => true })).toBeNull()
  })

  it('reads a proxy in macOS’s network settings from scutil', () => {
    expect(proxiedBySettings('<dictionary> {\n  ExceptionsList : <array> {\n  }\n  FTPPassive : 1\n}')).toBe(false)
    expect(proxiedBySettings('<dictionary> {\n  HTTPSEnable : 1\n  HTTPSProxy : corp\n}')).toBe(true)
    expect(proxiedBySettings('<dictionary> {\n  HTTPSEnable : 0\n  ProxyAutoConfigEnable : 1\n}')).toBe(true)
  })

  it('asks the system only where the nameservers fail or are slow, once a host, and keeps what it found', async () => {
    let asked = 0
    const counted =
      (resolve: Resolve): Resolve =>
      (host) => {
        asked += 1
        return resolve(host)
      }
    // The nameservers answer: the system, stalled or not, is never asked.
    const answered = raceResolve(at('104.18.41.241'), counted(never))
    expect(await answered('auth.openai.com')).toEqual([{ address: '104.18.41.241', family: 4 }])
    expect(asked).toBe(0)
    // They have none: the system at once.
    expect(await raceResolve(async () => [], counted(at('172.64.146.15')))('auth.openai.com')).toEqual([
      { address: '172.64.146.15', family: 4 },
    ])
    expect(asked).toBe(1)
    // They don't answer: the system once they've had their moment, and only once for all who ask.
    asked = 0
    const slow = raceResolve(never, counted(at('172.64.146.15')), { systemAfter: 20 })
    const all = await Promise.all([slow('auth.openai.com'), slow('auth.openai.com'), slow('auth.openai.com')])
    expect(all[2]).toEqual([{ address: '172.64.146.15', family: 4 }])
    expect(asked).toBe(1)
    // Found once, kept.
    expect(await slow('auth.openai.com')).toEqual([{ address: '172.64.146.15', family: 4 }])
    expect(asked).toBe(1)
    // Nobody has it: refused, and asked again next time.
    const nowhere = raceResolve(
      async () => [],
      counted(() => Promise.reject(new Error('ENOTFOUND'))),
    )
    await expect(nowhere('nowhere.invalid')).rejects.toThrow()
    await expect(nowhere('nowhere.invalid')).rejects.toThrow()
    expect(asked).toBe(3)
  })

  it('takes the nameservers’ IPv4 answer at once, and gives an IPv6 one a moment for IPv4’s', async () => {
    const wait = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))
    const hang = () => new Promise<string[]>(() => {})
    expect(await askNameservers(async () => ['104.18.41.241'], hang)('auth.openai.com')).toEqual([{ address: '104.18.41.241', family: 4 }])
    expect(
      await askNameservers(
        () => wait(30, ['104.18.41.241']),
        async () => ['2606:4700::1'],
      )('auth.openai.com'),
    ).toEqual([
      { address: '104.18.41.241', family: 4 },
      { address: '2606:4700::1', family: 6 },
    ])
    expect(await askNameservers(hang, async () => ['2606:4700::1'])('auth.openai.com')).toEqual([{ address: '2606:4700::1', family: 6 }])
    expect(
      await askNameservers(
        () => Promise.reject(new Error('ENODATA')),
        async () => [],
      )('nowhere.invalid'),
    ).toEqual([])
  })

  it('tunnels to the address it found, and answers a host it can’t find with a refusal', async () => {
    const server = await echo()
    const proxy = await openResolvingProxy(raceResolve(at('127.0.0.1'), never))
    try {
      const heard = await tunnel(proxy, `auth.openai.com:${server.port}`)
      expect(heard).toMatch(/^HTTP\/1\.1 200 Connection Established\r\n\r\nhello\nheard ping\n$/)
      const nowhere = await openResolvingProxy(() => Promise.reject(new Error('ENOTFOUND')))
      expect(await tunnel(nowhere, 'nowhere.invalid:443')).toMatch(/^HTTP\/1\.1 502/)
      nowhere.close()
    } finally {
      proxy.close()
      server.close()
    }
  })

  it('forwards plain HTTP, sent by its whole address', async () => {
    const server = http.createServer((request, response) => response.end(`got ${request.url}`))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const proxy = await openResolvingProxy(at('127.0.0.1'))
    try {
      const { port } = server.address() as net.AddressInfo
      const answer = await new Promise<string>((resolve, reject) => {
        const { port: through } = new URL(proxy.url)
        http
          .get({ host: '127.0.0.1', port: Number(through), path: `http://example.test:${port}/a?b=1` }, (response) => {
            let body = ''
            response.on('data', (chunk) => (body += String(chunk)))
            response.on('end', () => resolve(body))
          })
          .on('error', reject)
      })
      expect(answer).toBe('got /a?b=1')
    } finally {
      proxy.close()
      server.close()
    }
  })

  it('is given to Codex’s login, and closed once it has stopped', async () => {
    // A stand-in app-server that refuses to start signing in, in words that name the proxy it was given.
    const SERVER = `
let buffer = ''
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n')
    if (message.method === 'account/login/start') {
      process.stdout.write(JSON.stringify({ id: message.id, error: { message: 'via ' + process.env.HTTPS_PROXY + ' ' + process.env.NO_PROXY } }) + '\\n')
      setTimeout(() => process.exit(0), 50)
    }
  }
})`
    const codex: AgentDefinition = {
      ...agents.codex,
      signIn: {
        ...agents.codex.signIn,
        inApp: { kind: 'codex-app-server', ways: ['browser'], run: () => ({ command: 'node', args: ['-e', SERVER] }) },
      },
    }
    let closed = 0
    const proxy: SignInProxy = {
      url: 'http://127.0.0.1:9',
      env: { HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost' },
      close: () => void (closed += 1),
    }
    const said = await new Promise<SignInFlowEvent>((resolve) => {
      startSignInFlow(codex, (event) => event.kind === 'failed' && resolve(event), { way: 'browser', proxy })
    })
    expect(said).toEqual({ kind: 'failed', message: signInSaid.unknown, detail: 'via http://127.0.0.1:9 localhost' })
    await expect.poll(() => closed).toBeGreaterThan(0)
    // Where it never starts, its way out closes at once.
    const unused: SignInProxy = { ...proxy, close: () => void (closed = -1) }
    expect(startSignInFlow(codex, () => {}, { way: 'device', proxy: unused })).toBeNull()
    expect(closed).toBe(-1)
  })
})
