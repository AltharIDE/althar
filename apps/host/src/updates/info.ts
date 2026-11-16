import { API_VERSION } from '@althar/contracts'
import { migrations } from '@althar/persistence-sqlite'
import { Schema } from 'effect'

import metadata from '../../package.json'
import { digest } from './release'

export const ReleaseInfo = Schema.Struct({
  version: Schema.String,
  updaterProtocol: Schema.Literal(1),
  apiVersion: Schema.Int,
  storage: Schema.String,
  platform: Schema.Literal('linux'),
  arch: Schema.Literals(['x64', 'arm64']),
})
export type ReleaseInfo = typeof ReleaseInfo.Type
/** Any migration or host file-format change moves the storage fingerprint automatically. */
export const releaseInfo = (arch: 'x64' | 'arm64' = process.arch === 'arm64' ? 'arm64' : 'x64'): ReleaseInfo => ({
  version: metadata.version,
  updaterProtocol: 1,
  apiVersion: API_VERSION,
  storage: digest(Buffer.from(JSON.stringify({ migrations, hostConfiguration: 1, vault: 1, maintenance: 1 }))),
  platform: 'linux',
  arch,
})
