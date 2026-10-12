import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'

/**
 * Opens a line in a new Terminal window, for the person to run there: an
 * agent's own sign-in for an account (ADR-012), which asks for a browser or
 * a key. Only on macOS; elsewhere it isn't opened, and the window says the
 * line to run.
 */
export const openInTerminal = (line: string): Effect.Effect<boolean> =>
  process.platform !== 'darwin'
    ? Effect.succeed(false)
    : Effect.callback<boolean>((resume) => {
        const script = join(mkdtempSync(join(tmpdir(), 'althar-sign-in-')), 'sign-in.command')
        writeFileSync(script, `#!/bin/sh\n${line}\n`, { mode: 0o700 })
        chmodSync(script, 0o700)
        execFile('open', ['-a', 'Terminal', script], (error) => resume(Effect.succeed(error === null)))
      })

/**
 * Opens a page in the person's browser: an agent's sign-in that doesn't open
 * one itself (Codex's). `open` on macOS; on Windows, the shell's own handler
 * for links, which takes the address as it is, with no command line to quote
 * it for; `xdg-open` elsewhere that has it.
 */
export const openInBrowser = (url: string, platform: NodeJS.Platform = process.platform): Effect.Effect<boolean> =>
  !url.startsWith('https://')
    ? Effect.succeed(false)
    : Effect.callback<boolean>((resume) => {
        const [command, ...args] = browserCommand(url, platform)
        execFile(command ?? 'open', args, (error) => resume(Effect.succeed(error === null)))
      })

/** The command that opens a page on each system. */
export const browserCommand = (url: string, platform: NodeJS.Platform): ReadonlyArray<string> =>
  platform === 'darwin' ? ['open', url] : platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url]
