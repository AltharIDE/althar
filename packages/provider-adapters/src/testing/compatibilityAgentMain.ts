/** The compatibility protocol peer over real process stdio, for runtime integration tests. */
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { compatibilityPeer } from './compatibilityPeer'

compatibilityPeer(null).agent.app.connect(
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>),
)
