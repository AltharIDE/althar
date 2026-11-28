import { join } from 'node:path'

import { newKey } from '@althar/transport-node'
import { afterEach, describe, expect, it } from 'vitest'

import { workerAuthority } from '../src/workerHome/authority'
import { workerCodeOf, workerCodes, type WorkerGrant } from '../src/workerHome/codes'
import { workerTestDirectory } from './workerTestFiles'

/*
 * The home's one-time codes (workerHome/codes.ts), as the enrollment port answers them: what isn't an enrollment, a
 * code it never made or that ended, a worker the home couldn't take, and too many tries from one address.
 */

const homeId = `home_${'1'.repeat(32)}`
const grant: WorkerGrant = {
  homeId,
  workerId: 'worker',
  authority: 'authority',
  certificate: 'certificate',
  serverName: 'home',
  port: 1,
  addresses: [],
}
const encoded = (value: unknown) => `althar-worker1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`

const open: Array<{ close: () => void }> = []
afterEach(() => {
  for (const codes of open.splice(0)) codes.close()
})

const codesAt = async (clock: { at: number }) => {
  const named: string[] = []
  const codes = workerCodes({
    homeId,
    authority: await workerAuthority(join(workerTestDirectory(), 'profile'), clock.at),
    port: 0,
    now: () => clock.at,
    enroll: (_key, name) => {
      if (name === 'refused') throw new Error('No project takes this worker.')
      named.push(name)
      return grant
    },
  })
  open.push(codes)
  const ask = (code: string, name?: string, from = '127.0.0.1') =>
    codes.answer(from, JSON.stringify({ token: workerCodeOf(code)?.token, publicKey: newKey().publicKey.toString('base64url'), name }))
  return { codes, named, ask }
}

describe('a one-time code', () => {
  it('is read only where it is one', () => {
    expect(workerCodeOf('althar-worker1.%%%')).toBeUndefined()
    expect(workerCodeOf(encoded(7))).toBeUndefined()
    expect(workerCodeOf(encoded(null))).toBeUndefined()
    expect(workerCodeOf(encoded({ homeId, addresses: [1], port: 1, authority: 'a', token: 't', expiresAt: 1 }))).toBeUndefined()
    expect(workerCodeOf(` ${encoded({ homeId, addresses: ['a:1'], port: 1, authority: 'a', token: 't', expiresAt: 1 })} `)).toEqual({
      homeId,
      addresses: ['a:1'],
      port: 1,
      authority: 'a',
      token: 't',
      expiresAt: 1,
    })
  })

  it('refuses what isn’t an enrollment, or a code it never made', async () => {
    const { codes } = await codesAt({ at: 1_000 })
    expect(codes.answer('127.0.0.1', 'not json').status).toBe(400)
    expect(codes.answer('127.0.0.1', JSON.stringify({ token: 1, publicKey: 'key' })).status).toBe(400)
    expect(codes.answer('127.0.0.1', JSON.stringify({ token: 'never', publicKey: 'key' })).status).toBe(403)
  })

  it('names a worker as the code does where it says no name, and says why the home couldn’t take one', async () => {
    const { codes, named, ask } = await codesAt({ at: 1_000 })
    // A second code enrolls on the port the first opened.
    const first = await codes.make('   ')
    const refused = await codes.make('refused')
    expect(workerCodeOf(refused.code)?.port).toBe(workerCodeOf(first.code)?.port)
    expect(ask(first.code, ' ').status).toBe(200)
    expect(named).toEqual(['Worker'])
    expect(ask(refused.code)).toEqual({ status: 400, body: { message: 'No project takes this worker.' } })
  })

  it('ends with its time, and the port closes once none waits', async () => {
    const clock = { at: 1_000 }
    const { codes, ask } = await codesAt(clock)
    const { code, expiresAt } = await codes.make('laptop')
    clock.at = expiresAt
    expect(ask(code).status).toBe(403)
    // A new code opens the port again.
    const again = await codes.make('laptop')
    expect(ask(again.code).status).toBe(200)
  })

  it('takes so many at once, and so many tries a minute from one address', async () => {
    const clock = { at: 1_000 }
    const { codes, ask } = await codesAt(clock)
    const made = []
    for (let one = 0; one < 16; one += 1) made.push(await codes.make('laptop'))
    await expect(codes.make('laptop')).rejects.toThrow(/Too many codes/)
    for (let tries = 0; tries < 30; tries += 1) codes.answer('10.0.0.9', 'not json')
    expect(ask(made[0]?.code ?? '', 'laptop', '10.0.0.9').status).toBe(429)
    expect(ask(made[0]?.code ?? '', 'laptop').status).toBe(200)
    clock.at += 61_000
    expect(codes.answer('10.0.0.9', 'not json').status).toBe(400)
  })
})
