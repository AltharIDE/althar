import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'

import { commandOfCall, exitCodeIn, type InHand, servingAt, stillBusy, tailOf } from '../src/leftRunning'

/*
 * What is read from a command left running: where it answers, as servers
 * print it, and how it ended, as Claude Code writes it.
 */

describe('what a command left running says', () => {
  it('says where it answers as servers print it, as a browser opens it, and nothing for an address elsewhere', () => {
    // Vite, coloured, with its port in bold.
    assert.strictEqual(
      servingAt('  \u001b[32mVITE\u001b[39m ready\n  ➜  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n'),
      'http://localhost:5173/',
    )
    assert.strictEqual(servingAt('Serving HTTP on :: port 8000 (http://[::]:8000/) ...'), 'http://localhost:8000/')
    assert.strictEqual(servingAt('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...'), 'http://localhost:8000/')
    assert.strictEqual(servingAt('* Listening on http://127.0.0.1:3000'), 'http://127.0.0.1:3000')
    assert.strictEqual(servingAt('Ready on https://app.localhost:4443/admin.'), 'https://app.localhost:4443/admin')
    assert.isNull(servingAt('  ➜  Network: http://192.168.1.20:5173/\nfetching https://registry.npmjs.org/'))
    assert.isNull(servingAt(''))
  })

  it('opens a prototype workbench at its page, which is its address, past a port another was using', () => {
    // As `bun run prototype <folder>` prints it, in this repository's workbench.
    const printed = [
      '$ vp dev --config packages/prototype-workbench/vite.config.ts .althar/scratch/board-card',
      'Port 5400 is in use, trying another one...',
      '',
      '  VITE+ v1.0.0-rc.0  ',
      '',
      '  ➜  Local:   http://localhost:5401/',
      '  ➜  Network: use --host to expose',
    ].join('\n')
    assert.strictEqual(servingAt(printed), 'http://localhost:5401/')
  })

  it('reads its exit code where Claude Code wrote it at the end, and nothing where it didn’t', () => {
    assert.strictEqual(exitCodeIn('error: Port 5173 is in use\n[exited with code 1]\n'), 1)
    assert.isNull(exitCodeIn('[exited with code 1]\nand then more'))
    assert.isNull(exitCodeIn('ready'))
  })

  it('names it by its tool call’s command line, else by what the agent calls it', () => {
    assert.strictEqual(
      commandOfCall({ rawInput: { command: 'bun dev', description: 'Start the dev server' } }, 'Start the dev server'),
      'bun dev',
    )
    // Codex's command as words, and its name the command.
    assert.strictEqual(commandOfCall({ rawInput: { command: ['/bin/zsh', '-lc', 'bun dev'] } }, 'bun dev'), 'bun dev')
    assert.strictEqual(commandOfCall(undefined, 'bun dev'), 'bun dev')
    assert.strictEqual(commandOfCall({ rawInput: { command: ['make', 'serve'] }, title: 'Serve' }, ''), 'make serve')
    // With no line and no name, what the call says it does; else nothing.
    assert.strictEqual(commandOfCall({ rawInput: {}, title: 'Serve the docs' }, ''), 'Serve the docs')
    assert.strictEqual(commandOfCall({ rawInput: {} }, ''), '')
  })

  it.effect('reads nothing of a file that isn’t there', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* tailOf('/nonexistent/althar/output'), '')
    }),
  )
})

describe('whether an agent that ended its turn is still at work', () => {
  const quiet = Duration.seconds(30)
  const idle: InHand = { turnRunning: false, background: [], callsOpen: 0, workedAt: null }
  const running = { ended: null, url: null }
  const ended = { ended: { at: '2026-10-12T10:00:00.000Z', code: 0 }, url: null }

  it('is done when it has nothing in hand', () => {
    assert.isFalse(stillBusy(idle, 1_000, quiet))
    // What it left running ended by itself, and long enough ago for it to have been woken and be done.
    assert.isFalse(stillBusy({ ...idle, background: [ended], workedAt: 1_000 }, 40_000, quiet))
  })

  it('is at work in a turn, with a command it left running going, or in a call it has not finished', () => {
    assert.isTrue(stillBusy({ ...idle, turnRunning: true }, 1_000, quiet))
    assert.isTrue(stillBusy({ ...idle, background: [ended, running] }, 1_000, quiet))
    assert.isTrue(stillBusy({ ...idle, callsOpen: 1 }, 1_000, quiet))
  })

  it('is not done until it has been quiet for a while since it spoke outside a turn or something it left running ended', () => {
    assert.isTrue(stillBusy({ ...idle, background: [ended], workedAt: 10_000 }, 20_000, quiet))
    assert.isTrue(stillBusy({ ...idle, background: [ended], workedAt: 10_000 }, 39_999, quiet))
    assert.isFalse(stillBusy({ ...idle, background: [ended], workedAt: 10_000 }, 40_000, quiet))
  })

  it('does not wait for a server, which says where it answers and runs on as long as the agent wants it', () => {
    assert.isFalse(stillBusy({ ...idle, background: [{ ended: null, url: 'http://localhost:5173/' }] }, 1_000, quiet))
    assert.isTrue(stillBusy({ ...idle, background: [{ ended: null, url: 'http://localhost:5173/' }, running] }, 1_000, quiet))
  })

  it('waits for a test run or a build that prints an address, which ends by itself, but not a dev server', () => {
    const url = 'http://localhost:4173/'
    assert.isTrue(stillBusy({ ...idle, background: [{ ended: null, url, command: 'bun run test:browser' }] }, 1_000, quiet))
    assert.isFalse(stillBusy({ ...idle, background: [{ ended: null, url, command: 'bun dev' }] }, 1_000, quiet))
  })

  it('waits for an agent to wake once what it left running ended, however slow, up to the wake time, then for it to be quiet', () => {
    const wake = Duration.minutes(5)
    const slow = { ...idle, background: [ended], workedAt: 10_000, wakeAt: 10_000 }
    assert.isTrue(stillBusy(slow, 200_000, quiet, wake))
    assert.isFalse(stillBusy(slow, 311_000, quiet, wake))
    // Once it has spoken, the quiet applies.
    assert.isFalse(stillBusy({ ...slow, wakeAt: null }, 200_000, quiet, wake))
  })
})
