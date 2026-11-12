import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AT_ONCE, type Command, runnersMade, startApart, startHere } from '../src/spawner'

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

  it("runs a few at a time, the person's before the rest, all on one thread", async () => {
    const before = runnersMade()
    const folder = mkdtempSync(join(tmpdir(), 'althar-spawner-'))
    // Every place taken by one that holds it until its gate opens; then one waiting of the background's, and one of the person's.
    const gates = Array.from({ length: AT_ONCE }, (_, index) => join(folder, `gate-${index}`))
    const holding = gates.map((gate) => startApart(held(gate)))
    const mark = join(folder, 'background-started')
    const background = startApart(node(`require('node:fs').writeFileSync(${JSON.stringify(mark)}, '')`))
    const person = startApart({ ...node("process.stdout.write('first')"), first: true })
    // One place comes free: the person's takes it, and the background's waits on.
    writeFileSync(gates[0] ?? '', '')
    expect((await person.result).stdout).toBe('first')
    expect(existsSync(mark)).toBe(false)
    for (const gate of gates.slice(1)) writeFileSync(gate, '')
    await background.result
    expect(existsSync(mark)).toBe(true)
    await Promise.all(holding.map((one) => one.result))
    expect(runnersMade() - before).toBe(0)
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
