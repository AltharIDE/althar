import type { WatchEvent } from '@althar/contracts'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { connectRelay, newCommandId } from '../src/client/relay/RelayClient'
import { decode, encode, jsonPort } from '../src/client/relay/jsonPort'
import { onlineLink, selfTest, serveDemo, textChannels, type Received } from '../src/client/relay/selfTest'

/*
 * The relay client against the runtime's own contract: a server answering
 * a few of the API's calls, over a channel that carries only text, as the
 * relay's will. What crosses is checked by the contract's schemas on both
 * sides, so the demo's records are shown to be ones the runtime could send.
 */

const NOW = Date.parse('2026-10-21T15:00:00.000Z')

let scope: Scope.Closeable | undefined
afterEach(async () => {
  if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.void))
})

const connected = async () => {
  const [phone, mac] = textChannels()
  const received: Array<Received> = []
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Scope.provide(serveDemo(mac, received, NOW), scope))
  const client = await connectRelay(jsonPort(phone), onlineLink)
  return { client, received, sent: phone.sent }
}

describe('the relay client', () => {
  it('reads the home through the contract, as text', async () => {
    const { client, sent } = await connected()
    const home = await client.home()
    expect(home.cursor).toBe(7)
    expect(home.calls.map((call) => call.id)).toEqual(['att_migrate', 'att_breakpoint', 'att_rounds'])
    expect(sent.length).toBeGreaterThan(0)
    expect(() => sent.forEach((text) => JSON.parse(text))).not.toThrow()
    await client.close()
  })

  it('answers with a command id the contract takes', async () => {
    const { client, received } = await connected()
    await client.answer({ attentionId: 'att_migrate', decision: 'reject', reason: 'Not on staging today' })
    expect(received).toEqual([
      {
        tag: 'Answer',
        payload: {
          commandId: expect.stringMatching(/^cmd_[0-9a-f]{32}$/),
          attentionId: 'att_migrate',
          decision: 'reject',
          reason: 'Not on staging today',
        },
      },
    ])
    await client.close()
  })

  it('says the runtime’s refusal in its own words, and doesn’t retry it', async () => {
    const { client, received } = await connected()
    await expect(client.merge({ taskId: 'task_stripe', head: 'deadbee' })).rejects.toThrow('It changed since you looked')
    await client.merge({ taskId: 'task_stripe', head: '9f3c2ab' })
    expect(received.map((one) => one.tag)).toEqual(['Merge'])
    await client.close()
  })

  it('reads a thread and a diff the demo holds', async () => {
    const { client } = await connected()
    const thread = await client.thread('thr_task_stripe')
    expect(thread.task.title).toBe('Upgrade the Stripe SDK to v19')
    const diff = await client.fileDiff('task_stripe', 'src/webhooks/handle.ts')
    expect(diff.lines.some((line) => line.kind === 'added')).toBe(true)
    await client.close()
  })

  it('hears what changes', async () => {
    const { client } = await connected()
    const heard = await new Promise<Array<WatchEvent>>((resolve) => {
      const events: Array<WatchEvent> = []
      const stop = client.watch((event) => {
        events.push(event)
        if (events.length === 2) {
          stop()
          resolve(events)
        }
      })
    })
    expect(heard.map((event) => event._tag)).toEqual(['Changed', 'Streaming'])
    await client.close()
  })
})

describe('the self-test the app runs', () => {
  it('passes every check', async () => {
    const checks = await selfTest()
    expect(checks.filter((check) => !check.ok)).toEqual([])
    expect(checks.map((check) => check.name)).toContain('Watch, as a stream')
  })
})

describe('the relay’s text', () => {
  it('carries bigints whole', () => {
    expect(decode(encode({ id: 12345678901234567890n, list: [1n] }))).toEqual({ id: 12345678901234567890n, list: [1n] })
  })

  it('makes command ids as the contract has them', () => {
    expect(newCommandId()).toMatch(/^cmd_[0-9a-f]{32}$/)
    expect(newCommandId((bytes) => bytes.fill(171))).toBe(`cmd_${'ab'.repeat(16)}`)
  })
})
