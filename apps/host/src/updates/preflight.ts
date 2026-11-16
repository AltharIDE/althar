import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { agents } from '@althar/provider-adapters'
import { Schema } from 'effect'

import metadata from '../../package.json'
import { readPrivate } from '../privateFiles'
import { updateError } from './store'

/** Runs only side-effect-free version probes in a fresh home with no inherited provider credentials. */
export const verifyBundledPrograms = async (entry: string) => {
  const require = createRequire(entry)
  const probe = await fs.mkdtemp(join(tmpdir(), 'althar-release-probe-'))
  try {
    for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const) {
      const bytes = await readPrivate(require.resolve(`${name}/package.json`), 65_536)
      const value = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
        JSON.parse(new TextDecoder().decode(bytes ?? Buffer.alloc(0))),
      )
      if (value.version !== metadata.dependencies[name])
        throw updateError('ReleaseRejected', 'The bundled adapter versions do not match this host release.')
    }
    for (const id of ['claude-code', 'codex'] as const) {
      const program = agents[id].cli?.bundled?.()
      if (program === undefined || program === null)
        throw updateError('UpdateFailed', 'The release is missing its native provider CLI for this platform.')
      await promisify(execFile)(program, ['--version'], {
        env: {
          HOME: probe,
          XDG_CONFIG_HOME: probe,
          XDG_DATA_HOME: probe,
          CODEX_HOME: probe,
          CLAUDE_CONFIG_DIR: probe,
          PATH: '/usr/bin:/bin',
          LANG: 'C.UTF-8',
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        timeout: 30_000,
        maxBuffer: 16_384,
      })
    }
  } finally {
    await fs.rm(probe, { recursive: true, force: true }).catch(() => undefined)
  }
}
