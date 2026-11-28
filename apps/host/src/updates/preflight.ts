import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { agents } from '@althar/provider-adapters'
import { Schema } from 'effect'

import metadata from '../../package.json'
import { readPrivate } from '../privateFiles'
import { shippedSandbox } from '../workerCheck'
import { updateError } from './store'

/**
 * What a release runs its agents with: the adapters, at this release's versions, and for each agent whose own program
 * comes on first use (Claude Code's, Codex's), a pinned package for this system to download, as none ships in the
 * release (docs/plans/agents-on-first-use.md). A release that carries the worker carries what its agents' sandbox
 * needs: bubblewrap, ripgrep and socat, its own.
 */
export const verifyBundledPrograms = async (entry: string, system: { readonly platform: string; readonly arch: string } = process) => {
  const require = createRequire(entry)
  for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const) {
    const bytes = await readPrivate(require.resolve(`${name}/package.json`), 65_536)
    const value = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
      JSON.parse(new TextDecoder().decode(bytes ?? Buffer.alloc(0))),
    )
    if (value.version !== metadata.dependencies[name])
      throw updateError('ReleaseRejected', 'The bundled adapter versions do not match this host release.')
  }
  for (const id of ['claude-code', 'codex'] as const) {
    const download = agents[id].cli?.download
    if (download === undefined || !('npm' in download) || download.assets[`${system.platform}-${system.arch}`] === undefined)
      throw updateError('UpdateFailed', 'The release has no pinned provider CLI to download for this platform.')
  }
  const release = resolve(dirname(entry), '..')
  if (await executable(join(release, 'althar-worker'))) {
    const shipped = shippedSandbox(release, null)
    for (const name of ['bwrap', 'rg', 'socat'] as const) {
      const program = shipped[name]
      if (program === undefined || !(await executable(program)))
        throw updateError('UpdateFailed', `The release is missing ${name}, which its worker’s sandbox needs.`)
    }
  }
}

const executable = (path: string) =>
  fs.access(path, fs.constants.X_OK).then(
    () => true,
    () => false,
  )
