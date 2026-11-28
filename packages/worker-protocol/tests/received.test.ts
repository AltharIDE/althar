import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readBytes, receiveParts, sizeOfBytes, type ReceivedFile } from '../src/agentReceived.ts'
import { sendSizeWords } from '../src/agentCheckout.ts'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest()

/** Sends `bytes` as a worker does, in 2 KiB frames, waiting where the file asks it to. */
const send = async (parts: ReturnType<typeof receiveParts>, at: number, bytes: Uint8Array) => {
  for (let offset = 0; offset < bytes.byteLength; offset += 2_048) {
    const written = parts.write(at, bytes.subarray(offset, offset + 2_048))
    expect(written).not.toBe('invalid')
    if (written === 'wait') await parts.drained(at)
  }
}

describe('a worker’s checkpoint as the home receives it', () => {
  it('goes into private files as it arrives, larger than the old limits, and is let go after', async () => {
    // More than the 16 MiB patch an older home took.
    const patch = randomBytes(17 * 1024 * 1024)
    const commits = randomBytes(4096)
    const parts = receiveParts([
      { size: patch.byteLength, sha256: digest(patch) },
      { size: commits.byteLength, sha256: digest(commits) },
      { size: 0, sha256: digest(new Uint8Array()) },
    ])
    await send(parts, 0, patch)
    expect(parts.complete()).toBe(false)
    await send(parts, 1, commits)
    expect(parts.complete()).toBe(true)
    const [received, bundle, index] = await parts.finish()
    expect(sizeOfBytes(received!)).toBe(patch.byteLength)
    expect(readFileSync((received as ReceivedFile).file).equals(patch)).toBe(true)
    expect(readBytes(bundle!).equals(commits)).toBe(true)
    expect(sizeOfBytes(index!)).toBe(0)
    const folder = dirname((received as ReceivedFile).file)
    parts.discard()
    expect(existsSync(folder)).toBe(false)
  })

  it('refuses bytes past a part’s size, and a part whose digest is wrong', async () => {
    const bytes = randomBytes(100)
    const parts = receiveParts([{ size: bytes.byteLength, sha256: digest(randomBytes(100)) }])
    expect(parts.write(0, randomBytes(101))).toBe('invalid')
    expect(parts.write(1, bytes)).toBe('invalid')
    await send(parts, 0, bytes)
    await expect(parts.finish()).rejects.toThrow('wrong workspace transfer digest')
    parts.discard()
  })

  it('holds nothing where nothing came back', async () => {
    const empty = digest(new Uint8Array())
    const parts = receiveParts([
      { size: 0, sha256: empty },
      { size: 0, sha256: empty },
    ])
    expect(parts.complete()).toBe(true)
    expect((await parts.finish()).map(sizeOfBytes)).toEqual([0, 0])
    parts.discard()
  })

  it('says sizes as a person reads them', () => {
    expect(sendSizeWords(900)).toBe('900 bytes')
    expect(sendSizeWords(64 * 1024 * 1024)).toBe('64 MB')
    expect(sendSizeWords(2 ** 32 - 1)).toBe('4 GB')
  })
})
