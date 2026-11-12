import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AT_ONCE, type Command, reachesRemote, runnersMade, startApart, startHere } from '../src/spawner'

/*
 * The runtime's own commands start on a thread of their own (spawner.ts), so
 * the thread that answers the window never waits for one to start: each
 * comes back as it would have from this thread, its output, exit code and
 * error, a few at a time, the person's first.
 */

const node = (code: string, more: Partial<Command> = {}): Command => ({
  command: process.execPath,
  args: ['-e', code],
  env: process.env,
  detached: process.platform !== 'win32',
  max: 1024 * 1024,
  ...more,
})

/** A command that prints without end, as fast as what reads it takes it. */
const FLOOD =
  "const chunk = 'x'.repeat(65536); const go = () => { while (process.stdout.write(chunk)); process.stdout.once('drain', go) }; go()"

/** A command that runs until its gate, a file, is there. */
const held = (gate: string) =>
  node(`const fs = require('node:fs'); const look = setInterval(() => fs.existsSync(${JSON.stringify(gate)}) && clearInterval(look), 5)`)

describe('a command started apart', () => {
  it('comes back with what it printed, what it read and how it ended', async () => {
    const ended = await startApart(
      node("process.stdin.pipe(process.stdout); process.stderr.write('said'); process.stdin.on('end', () => process.exit(3))", {
        input: 'read',
      }),
    ).result
    expect(ended).toEqual({ code: 3, signal: null, error: null, stdout: 'read', stderr: 'said', over: false })
  })

  it('says what stopped a command that is not there', async () => {
    const ended = await startApart({ ...node(''), command: 'no-such-command-althar' }).result
    expect(ended.error?.code).toBe('ENOENT')
    expect(ended.code).toBeNull()
  })

  it('is stopped once it prints more than it may, and says so', async () => {
    const ended = await startApart(node(FLOOD, { max: 200_000 })).result
    expect(ended.over).toBe(true)
    expect(ended.stdout.length).toBeLessThanOrEqual(200_000)
  })

  it('is stopped when asked, with the group it started', async () => {
    const started = startApart(node('setInterval(() => {}, 1000)'))
    started.stop()
    const ended = await started.result
    expect(ended.signal).toBe('SIGTERM')
  })

  it("runs a few at a time, and the person's never waits behind the background's, all on one thread", async () => {
    const before = runnersMade()
    const folder = mkdtempSync(join(tmpdir(), 'althar-spawner-'))
    // Every place of the background's taken by one that holds it until its gate opens; then one more of the background's.
    const gates = Array.from({ length: AT_ONCE }, (_, index) => join(folder, `gate-${index}`))
    const holding = gates.map((gate) => startApart(held(gate)))
    const mark = join(folder, 'background-started')
    const background = startApart(node(`require('node:fs').writeFileSync(${JSON.stringify(mark)}, '')`))
    // The person's starts at once, in places of its own, while the background's waits for one of its own to come free.
    const person = startApart({ ...node("process.stdout.write('first')"), first: true })
    expect((await person.result).stdout).toBe('first')
    expect(existsSync(mark)).toBe(false)
    writeFileSync(gates[0] ?? '', '')
    await background.result
    expect(existsSync(mark)).toBe(true)
    for (const gate of gates.slice(1)) writeFileSync(gate, '')
    await Promise.all(holding.map((one) => one.result))
    expect(runnersMade() - before).toBe(0)
  })

  it("starts a read at once while fetches and pushes fill the network's places, the person's and the background's", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-spawner-'))
    const gate = join(folder, 'network-answers')
    // As many slow network commands as the network's lane takes, of the person's and of the background's, and more waiting.
    const network = Array.from({ length: AT_ONCE * 2 + 2 }, (_, index) =>
      startApart({ ...held(gate), network: true, first: index % 2 === 0 }),
    )
    const person = startApart({ ...node("process.stdout.write('read')"), first: true })
    const background = startApart(node("process.stdout.write('also')"))
    // Both reads come back while every network command still waits on its remote.
    expect((await person.result).stdout).toBe('read')
    expect((await background.result).stdout).toBe('also')
    expect(existsSync(gate)).toBe(false)
    writeFileSync(gate, '')
    await Promise.all(network.map((one) => one.result))
  })

  it('never starts once stopped while it waits', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-spawner-'))
    const gates = Array.from({ length: AT_ONCE }, (_, index) => join(folder, `gate-${index}`))
    const holding = gates.map((gate) => startApart(held(gate)))
    const mark = join(folder, 'started')
    const waiting = startApart(node(`require('node:fs').writeFileSync(${JSON.stringify(mark)}, '')`))
    waiting.stop()
    expect(await waiting.result).toMatchObject({ signal: 'SIGTERM', stdout: '' })
    for (const gate of gates) writeFileSync(gate, '')
    await Promise.all(holding.map((one) => one.result))
    expect(existsSync(mark)).toBe(false)
  })
})

describe('a command started here', () => {
  it('comes back as one started apart does', async () => {
    const ended = await startHere(node("process.stdout.write('here'); process.exit(2)")).result
    expect(ended).toEqual({ code: 2, signal: null, error: null, stdout: 'here', stderr: '', over: false })
    const missing = await startHere({ ...node(''), command: 'no-such-command-althar' }).result
    expect(missing.error?.code).toBe('ENOENT')
    const over = await startHere(node(FLOOD, { max: 100_000 })).result
    expect(over.over).toBe(true)
    const stopped = startHere(node('setInterval(() => {}, 1000)'))
    stopped.stop()
    expect((await stopped.result).signal).toBe('SIGTERM')
  })
})

describe('a git command', () => {
  it('reaches a remote as a fetch, a push, a clone or an update of a remote does, past the options before its name', () => {
    for (const args of [
      ['fetch', '--quiet', 'origin'],
      ['-c', 'credential.helper=', 'push', 'origin', 'HEAD'],
      ['-C', '/somewhere', 'ls-remote', '--heads', 'origin'],
      ['clone', 'https://example.test/one.git'],
      ['remote', 'update'],
      ['submodule', 'update', '--init'],
    ])
      expect(reachesRemote(args)).toBe(true)
    for (const args of [
      ['status'],
      ['-c', 'core.quotePath=false', 'diff', '--name-only'],
      ['remote', '-v'],
      ['cat-file', '--batch-check'],
      [],
    ])
      expect(reachesRemote(args)).toBe(false)
  })
})
