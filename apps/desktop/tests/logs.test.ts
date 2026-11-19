// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { KEPT_FOR, LONGEST_LINE, type LogFileOptions, openLogFile, tail } from '../src/logs/logFile'
import { HIDDEN, masker, scrubSecrets } from '../src/logs/mask'

const folder = () => mkdtempSync(join(tmpdir(), 'althar-logs-'))
const NOW = Date.parse('2026-10-11T12:00:00.000Z')

/** A log whose exit the test makes: `exit()` runs what the process's own exit would. */
const exiting = (options: Omit<LogFileOptions, 'atExit'>) => {
  let flush: (() => void) | undefined
  const log = openLogFile({
    ...options,
    atExit: (given) => {
      flush = given
      return () => {
        flush = undefined
      }
    },
  })
  return { log, exit: () => flush?.(), watched: () => flush !== undefined }
}

describe('a log file', () => {
  it('stamps each line, in logfmt, on one line whatever the message holds', () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'main', now: () => NOW })
    log.line('INFO', 'Runtime started', { pid: 42, version: '0.1.0' })
    log.line('ERROR', 'Window error', { stack: 'Error: x\n    at y (z.js:1:2)', missing: undefined })
    log.close()
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toBe(
      '2026-10-11T12:00:00.000Z level=INFO message="Runtime started" pid=42 version=0.1.0\n' +
        '2026-10-11T12:00:00.000Z level=ERROR message="Window error" stack="Error: x\\n    at y (z.js:1:2)"\n',
    )
  })

  it('writes a stream in whole lines, holding a line until its end comes, and what is left when the stream ends', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'agents', now: () => NOW })
    const stderr = log.stream('claude-code[7]')
    stderr.write('first li')
    stderr.write('ne\nsecond\r\nthi')
    await log.flushed()
    expect(readFileSync(log.path, 'utf8').split('\n').filter(Boolean)).toEqual([
      '2026-10-11T12:00:00.000Z claude-code[7] first line',
      '2026-10-11T12:00:00.000Z claude-code[7] second',
    ])
    stderr.end()
    await log.flushed()
    expect(readFileSync(log.path, 'utf8')).toContain('claude-code[7] thi\n')
    log.close()
  })

  it('cuts a runaway line, so one line can’t fill the file', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'agents', now: () => NOW })
    log.stream('x').write('a'.repeat(LONGEST_LINE * 3))
    await log.flushed()
    const [line] = readFileSync(log.path, 'utf8').split('\n')
    expect(line?.length).toBeLessThan(LONGEST_LINE + 40)
    expect(line?.endsWith('…')).toBe(true)
    log.close()
  })

  it('never waits for the disk where a line is written: the lines of a tick go together after it, in order', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'main', now: () => NOW })
    log.line('INFO', 'first')
    log.line('INFO', 'second')
    // Nothing yet: the thread that wrote them answers the person, and the disk is waited for after.
    expect(readFileSync(log.path, 'utf8')).toBe('')
    const landed = log.flushed()
    // What comes while the first lines are on their way follows them.
    await new Promise((resolve) => setImmediate(resolve))
    log.line('INFO', 'third')
    await landed
    await log.flushed()
    expect(
      readFileSync(log.path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => /message=(\w+)/.exec(line)?.[1]),
    ).toEqual(['first', 'second', 'third'])
    // With nothing to write, it is flushed already.
    await log.flushed()
    log.close()
  })

  it('writes what hasn’t reached the disk as the process exits, so a crash’s last words are kept', () => {
    const dir = folder()
    const { log, exit, watched } = exiting({ dir, name: 'runtime', now: () => NOW })
    expect(watched()).toBe(true)
    log.line('INFO', 'Runtime started')
    log.line('ERROR', 'Last words before the crash')
    exit()
    expect(readFileSync(log.path, 'utf8')).toContain('message="Last words before the crash"')
    // Nothing is written twice by what was already asked for.
    log.close()
    expect(readFileSync(log.path, 'utf8').match(/Last words/g)).toHaveLength(1)
    // Closed, the process's exit is no longer watched, and what comes after is let go.
    expect(watched()).toBe(false)
    log.line('INFO', 'after it closed')
    expect(readFileSync(log.path, 'utf8')).not.toContain('after it closed')
  })

  it('as the process exits with a batch on its way, keeps it once and what came after it, in order', async () => {
    const dir = folder()
    const { log, exit } = exiting({ dir, name: 'runtime', now: () => NOW })
    log.line('INFO', 'on its way')
    // Once the tick is over, the batch is asked of the disk; the exit comes before the answer.
    await new Promise((resolve) => setImmediate(resolve))
    log.line('INFO', 'held')
    exit()
    await log.flushed()
    log.close()
    const text = readFileSync(log.path, 'utf8')
    expect(text.match(/on its way/g)?.length).toBeGreaterThanOrEqual(1)
    expect(text.indexOf('on its way')).toBeLessThan(text.indexOf('held'))
    expect(text.match(/held/g)).toHaveLength(1)
  })

  it('closed with a batch on its way, writes what is held after it and only then lets the file go', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'main', now: () => NOW })
    log.line('INFO', 'on its way')
    await new Promise((resolve) => setImmediate(resolve))
    log.line('INFO', 'held')
    const landed = log.flushed()
    log.close()
    log.close()
    await landed
    expect(
      readFileSync(log.path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => /message="?([\w ]+)/.exec(line)?.[1]),
    ).toEqual(['on its way', 'held'])
  })

  it('watches the process’s own exit until it is closed', () => {
    const dir = folder()
    const before = process.listenerCount('exit')
    const log = openLogFile({ dir, name: 'main', now: () => NOW })
    expect(process.listenerCount('exit')).toBe(before + 1)
    log.close()
    expect(process.listenerCount('exit')).toBe(before)
  })

  it('turns over at its size, keeping a few earlier files and no more', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'runtime', maxBytes: 200, keep: 2, now: () => NOW })
    for (let i = 0; i < 20; i++) log.line('INFO', `line ${i}`)
    await log.flushed()
    log.close()
    expect(readdirSync(dir).toSorted()).toEqual(['runtime.1.log', 'runtime.2.log', 'runtime.log'])
    for (const file of readdirSync(dir)) expect(readFileSync(join(dir, file)).length).toBeLessThanOrEqual(200)
    // The newest line is in the current file, the ones before it in .1, and the oldest are gone.
    expect(readFileSync(join(dir, 'runtime.log'), 'utf8')).toContain('line 19')
    expect(readFileSync(join(dir, 'runtime.1.log'), 'utf8')).not.toContain('line 19')
    expect(
      readdirSync(dir)
        .map((file) => readFileSync(join(dir, file), 'utf8'))
        .join(''),
    ).not.toContain('line 0"')
  })

  it('turning over, goes on where it was and drops what has aged out on the way', async () => {
    const dir = folder()
    const old = (NOW - KEPT_FOR - 60_000) / 1000
    const log = openLogFile({ dir, name: 'agents', maxBytes: 120, keep: 3, now: () => NOW })
    // Written meanwhile, by hand: the oldest kept file has aged out by the time the log turns over.
    log.line('INFO', 'one')
    log.line('INFO', 'two')
    await log.flushed()
    writeFileSync(join(dir, 'agents.3.log'), 'aged\n')
    utimesSync(join(dir, 'agents.3.log'), old, old)
    log.line('INFO', 'three')
    await log.flushed()
    log.close()
    expect(readFileSync(join(dir, 'agents.log'), 'utf8')).toContain('three')
    expect(readFileSync(join(dir, 'agents.1.log'), 'utf8')).toContain('two')
    // agents.3.log was moved on to agents.4.log, beyond what is kept, and went.
    expect(existsSync(join(dir, 'agents.4.log'))).toBe(false)
  })

  it('as the process exits while it turns over, writes what is held to the file by its name', async () => {
    const dir = folder()
    const { log, exit } = exiting({ dir, name: 'main', maxBytes: 80, keep: 2, now: () => NOW })
    log.line('INFO', 'first, filling the file')
    await log.flushed()
    log.line('INFO', 'second, which turns it over')
    // The turn-over is under way once the tick is over; the exit comes before it is done.
    await new Promise((resolve) => setImmediate(resolve))
    exit()
    await log.flushed()
    log.close()
    const all = readdirSync(dir)
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('')
    expect(all.match(/second, which turns it over/g)).toHaveLength(1)
    expect(all).toContain('first, filling the file')
  })

  it('keeps about a week: older files go as it opens, and a current file that old starts afresh', () => {
    const dir = folder()
    const old = (NOW - KEPT_FOR - 60_000) / 1000
    writeFileSync(join(dir, 'main.log'), 'from last month\n')
    writeFileSync(join(dir, 'main.1.log'), 'older\n')
    writeFileSync(join(dir, 'main.2.log'), 'recent\n')
    writeFileSync(join(dir, 'runtime.1.log'), 'another kind\n')
    utimesSync(join(dir, 'main.log'), old, old)
    utimesSync(join(dir, 'main.1.log'), old, old)
    utimesSync(join(dir, 'runtime.1.log'), old, old)
    const log = openLogFile({ dir, name: 'main', now: () => NOW })
    log.line('INFO', 'started')
    log.close()
    // main.log from last month became main.1.log and went with the others that old; runtime's files are runtime's own.
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).not.toContain('from last month')
    expect(existsSync(join(dir, 'main.1.log'))).toBe(false)
    expect(readFileSync(join(dir, 'main.3.log'), 'utf8')).toBe('recent\n')
    expect(existsSync(join(dir, 'runtime.1.log'))).toBe(true)
  })

  it('reads its tail across the turn-over, from a whole line', async () => {
    const dir = folder()
    const log = openLogFile({ dir, name: 'runtime', maxBytes: 300, now: () => NOW })
    for (let i = 0; i < 12; i++) log.line('INFO', `line ${i}`)
    await log.flushed()
    log.close()
    const last = tail(dir, 'runtime', 250)
    expect(last.length).toBeLessThanOrEqual(250)
    expect(last.startsWith('2026-10-11T12:00:00.000Z level=INFO')).toBe(true)
    expect(last.trimEnd().endsWith('message="line 11"')).toBe(true)
    // More than there is: all of it, the first line whole.
    expect(tail(dir, 'runtime', 100_000).startsWith('2026-10-11T12:00:00.000Z level=INFO message="line 0"')).toBe(true)
    expect(tail(dir, 'missing', 1000)).toBe('')
  })
})

describe('masking', () => {
  const mask = masker({
    home: '/Users/dana',
    user: 'dana',
    device: 'Danas-MacBook.local',
    names: { project: ['Meridian', 'refunds'], repository: ['meridian-api', 'infra', 'api', 'ui'] },
  })

  it('keeps a path’s last part and hides the folders under the home folder on the way', () => {
    expect(mask('could not open /Users/dana/Library/Application/althar.db: busy')).toBe('could not open ~/…/althar.db: busy')
    expect(mask('at run (file:///Users/dana/Code/x/dist/main.js:12:5)')).toBe('at run (file://~/…/main.js:12:5)')
    expect(mask('cwd "/Users/dana"')).toBe('cwd "~"')
    expect(mask('C:\\Users\\dana\\x')).toBe('C:\\Users\\[user]\\x')
    // Another person's home that starts the same isn't this one.
    expect(mask('/Users/danaB/file')).toBe('/Users/danaB/file')
  })

  it('hides project and repository names wherever they stand alone, each by the same stand-in', () => {
    expect(mask('git push failed in /Users/dana/Althar/meridian/fix-login/meridian-api')).toBe('git push failed in ~/…/[repository-1]')
    expect(mask('Meridian: meridian-api and infra; MERIDIAN again')).toBe(
      '[project-1]: [repository-1] and [repository-2]; [project-1] again',
    )
    // Inside another word it stays: it isn't the name there.
    expect(mask('infrastructure')).toBe('infrastructure')
    // Too common to say whose it is: kept, so the log reads.
    expect(mask('the api and the ui')).toBe('the api and the ui')
  })

  it('hides who they are on this computer, its name, and email addresses', () => {
    expect(mask('dana on Danas-MacBook.local, also Danas-MacBook, wrote to dana@example.com')).toBe(
      `${HIDDEN.user} on ${HIDDEN.device}, also ${HIDDEN.device}, wrote to ${HIDDEN.email}`,
    )
  })

  it('hides keys and tokens by their shapes and by where they sit, keeping what says what they were', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['key sk-ant-api03-abcdefghijklmnop', 'key [secret]'],
      ['OPENAI sk-proj-abcdefghijklmnopqrstuvwx', 'OPENAI [secret]'],
      ['ghp_abcdefghijklmnopqrstuvwxyz0123 and github_pat_11ABCDEFG0123456789_abcdef', '[secret] and [secret]'],
      ['glpat-abcdefghijklmnopqrst', '[secret]'],
      ['lin_api_abcdefghijklmnopqrstuvwxyz', '[secret]'],
      ['AKIAABCDEFGHIJKLMNOP', '[secret]'],
      ['Authorization: Bearer abc.def-ghi_jkl.mnopqrstu', 'Authorization: [secret] [secret]'],
      ['https://user:hunter22@github.com/o/r.git', 'https://[secret]@github.com/o/r.git'],
      ['GET /cb?code=abc123&state=x', 'GET /cb?code=[secret]&state=x'],
      ['GITHUB_TOKEN=abcdef123456 next', 'GITHUB_TOKEN=[secret] next'],
      ['{"apiKey": "abcdef123456"}', '{"apiKey": "[secret]"}'],
      ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', '[secret]'],
      ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----', '[secret]'],
    ]
    for (const [text, hidden] of cases) expect(scrubSecrets(text).text).toBe(hidden)
    // Counts are numbers, not secrets.
    expect(scrubSecrets('input_tokens=123456 output_tokens=42').text).toBe('input_tokens=123456 output_tokens=42')
    expect(scrubSecrets('ghp_abcdefghijklmnopqrstuvwxyz0123 lin_api_abcdefghijklmnopqrstuvwxyz').found).toBe(2)
  })
})
