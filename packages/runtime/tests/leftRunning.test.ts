import { assert, describe, it } from '@effect/vitest'

import { commandOfCall, exitCodeIn, servingAt } from '../src/leftRunning'

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
  })
})
