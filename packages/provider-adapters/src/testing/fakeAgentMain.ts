/*
 * The fake agent as a process, speaking ACP over stdio, for tests of the
 * process transport. Run it with Bun, which runs TypeScript directly.
 */
import { Readable, Writable } from 'node:stream'

import * as acp from '@agentclientprotocol/sdk'

import { fakeAgent } from './FakeAgent'

fakeAgent({ exit: () => process.exit(3) }).connect(
  acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>),
)
