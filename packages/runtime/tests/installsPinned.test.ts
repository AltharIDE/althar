import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, agents } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { zipSync } from 'fflate'

import { Installs } from '../src/Installs'

/*
 * A pinned agent's download (Antigravity's server, here a stand-in) where
 * the installs tests don't take it: on Windows, kept behind a junction; and
 * a download that can't be kept, because its archive won't unpack or it
 * lacks the program it is for.
 */

const SERVER = '#!/bin/sh\necho server\n'
const HARNESS = '#!/bin/sh\necho harness\n'
const URL = 'https://dl.google.example/agy-acp-server.zip'
const text = (words: string) => new TextEncoder().encode(words)
const sum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Antigravity pinned to a zip for this computer, of the files it holds, each pinned as given. */
const pinnedTo = (target: string, zip: Uint8Array, files: Readonly<Record<string, string>>, version = '1.3.0') => {
  const download = agents.antigravity.cli?.download
  if (download === undefined || !('version' in download)) throw new Error('Antigravity has a pinned download')
  const agent: AgentDefinition = {
    ...agents.antigravity,
    cli: {
      name: 'agy_acp_server.par',
      download: { ...download, version, assets: { [target]: { url: URL, sha256: sum(zip), files } } },
    },
  }
  return { agent, fetch: async () => new Response(new Uint8Array(zip)) }
}

const install = (root: string, platform: NodeJS.Platform, pinned: ReturnType<typeof pinnedTo>) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.flatMap(Installs, (installs) => installs.install(pinned.agent)),
      Installs.layer({ root, platform, arch: 'x64', musl: false, fetch: pinned.fetch, search: { env: { PATH: '' }, dirs: [] } }),
    ),
  )

describe('a pinned download on Windows', () => {
  it('is kept behind a junction to its version, which the next version replaces', async () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const held = { 'agy_acp_server.par.exe': SERVER, localharness_external: HARNESS }
    const zip = zipSync(Object.fromEntries(Object.entries(held).map(([name, body]) => [name, text(body)])))
    const files = Object.fromEntries(Object.entries(held).map(([name, body]) => [name, sum(text(body))]))
    const home = join(root, 'antigravity')
    assert.isTrue(Exit.isSuccess(await install(root, 'win32', pinnedTo('win32-x64', zip, files, '1.3.0'))))
    // An absolute target, as a junction needs.
    assert.strictEqual(readlinkSync(join(home, 'current')), join(home, '1.3.0'))
    assert.isTrue(Exit.isSuccess(await install(root, 'win32', pinnedTo('win32-x64', zip, files, '1.4.0'))))
    assert.strictEqual(readlinkSync(join(home, 'current')), join(home, '1.4.0'))
    assert.deepStrictEqual(readdirSync(home).toSorted(), ['1.4.0', 'current'])
    assert.strictEqual(readFileSync(join(home, 'current', 'agy_acp_server.par.exe'), 'utf8'), SERVER)
  })
})

describe('a pinned download that can’t be kept', () => {
  const refused = async (zip: Uint8Array, files: Readonly<Record<string, string>>, says: string) => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const exit = await install(root, 'linux', pinnedTo('linux-x64', zip, files))
    assert.isTrue(Exit.isFailure(exit), says)
    assert.include(JSON.stringify(exit), says)
    assert.isFalse(existsSync(join(root, 'antigravity', 'current')), says)
  }

  it('keeps nothing that lacks the program it is for', async () => {
    const zip = zipSync({ localharness_external: text(HARNESS) })
    await refused(zip, { localharness_external: sum(text(HARNESS)) }, 'has no agy_acp_server.par in it')
  })

  it('keeps nothing of an archive whose files won’t unpack', async () => {
    const whole = zipSync({ 'agy_acp_server.par': text(SERVER.repeat(400)) }, { level: 9 })
    // Its compressed bytes spoiled after the header, though it is the very zip it was pinned by.
    const spoiled = whole.slice()
    for (let at = 60; at < 120; at += 1) spoiled[at] = 0xff
    await refused(spoiled, { 'agy_acp_server.par': sum(text(SERVER.repeat(400))) }, "couldn't be unpacked")
  })
})
