import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, agents } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { zipSync } from 'fflate'

import { Installs } from '../src/Installs'

/*
 * A pinned agent's zip as Althar unpacks it, a piece at a time: a program
 * larger than a piece, kept whole; and a zip whose file is packed in a way
 * Althar doesn't unpack, kept nothing of.
 */

const URL = 'https://dl.google.example/agy-acp-server.zip'
const PROGRAM = 'agy_acp_server.par'
const sum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Antigravity pinned to a zip for Linux, of the files it holds, each pinned as given, installed under `root`. */
const install = (root: string, zip: Uint8Array, files: Readonly<Record<string, string>>) => {
  const download = agents.antigravity.cli?.download
  if (download === undefined || !('version' in download)) throw new Error('Antigravity has a pinned download')
  const agent: AgentDefinition = {
    ...agents.antigravity,
    cli: { name: PROGRAM, download: { ...download, version: '1.3.0', assets: { 'linux-x64': { url: URL, sha256: sum(zip), files } } } },
  }
  return Effect.runPromiseExit(
    Effect.provide(
      Effect.flatMap(Installs, (installs) => installs.install(agent)),
      Installs.layer({
        root,
        platform: 'linux',
        arch: 'x64',
        musl: false,
        fetch: async () => new Response(new Uint8Array(zip)),
        search: { env: { PATH: '' }, dirs: [] },
      }),
    ),
  )
}

describe('a pinned download’s zip', () => {
  it('keeps a program larger than a piece Althar reads at a time whole', async () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    // Bytes that don't compress, so the zip is as large as the program, read in several pieces.
    const program = new Uint8Array(randomBytes(2_500_000))
    const zip = zipSync({ [PROGRAM]: program })
    assert.isAbove(zip.length, 2 * (1 << 20))
    assert.isTrue(Exit.isSuccess(await install(root, zip, { [PROGRAM]: sum(program) })))
    assert.strictEqual(sum(new Uint8Array(readFileSync(join(root, 'antigravity', 'current', PROGRAM)))), sum(program))
  })

  it('keeps nothing of a file packed in a way Althar doesn’t unpack', async () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const program = new TextEncoder().encode('#!/bin/sh\necho server\n'.repeat(50))
    const zip = zipSync({ [PROGRAM]: program }, { level: 9 })
    // The file's header says bzip2 (method 12), in the zip it was pinned by.
    zip[8] = 12
    zip[9] = 0
    const exit = await install(root, zip, { [PROGRAM]: sum(program) })
    assert.isTrue(Exit.isFailure(exit))
    assert.include(JSON.stringify(exit), "couldn't be unpacked")
    assert.isFalse(existsSync(join(root, 'antigravity', 'current')))
  })
})
