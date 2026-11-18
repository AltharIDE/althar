import { strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { toBinary } from '@bufbuild/protobuf'

import { HomeFrameSchema, MAX_HELLO_BYTES, negotiateWorkerHello } from '../src/index.ts'

const name = process.platform === 'win32' ? 'worker_hello.exe' : 'worker_hello'
const probe = fileURLToPath(new URL(`../../../target/debug/examples/${name}`, import.meta.url))

void test('Rust offers a session, TypeScript selects its version, and Rust accepts the home response', () => {
  const binding = {
    homeId: 'home_0123456789abcdef0123456789abcdef',
    workerId: 'wrk_0123456789abcdef0123456789abcdef',
    sessionId: 'wsn_0123456789abcdef0123456789abcdef',
  }
  const offer = execFileSync(probe, ['offer', binding.workerId], { maxBuffer: MAX_HELLO_BYTES, timeout: 5000 })
  const reply = toBinary(HomeFrameSchema, negotiateWorkerHello(offer, binding))
  const session = execFileSync(probe, ['accept', binding.homeId, binding.workerId], {
    input: reply,
    encoding: 'utf8',
    maxBuffer: MAX_HELLO_BYTES,
    timeout: 5000,
  })
  strictEqual(session.trim(), binding.sessionId)
})
