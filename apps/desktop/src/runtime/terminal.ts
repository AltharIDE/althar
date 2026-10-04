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
        const script = join(mkdtempSync(join(tmpdir(), 'charrette-sign-in-')), 'sign-in.command')
        writeFileSync(script, `#!/bin/sh\n${line}\n`, { mode: 0o700 })
        chmodSync(script, 0o700)
        execFile('open', ['-a', 'Terminal', script], (error) => resume(Effect.succeed(error === null)))
      })
