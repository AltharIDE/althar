import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, agents } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { zipSync } from 'fflate'

import { Installs, type InstallsOptions } from '../src/Installs'

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

describe('a pinned download that isn’t what it should hold', () => {
  const refused = async (zip: Uint8Array, files: Readonly<Record<string, string>>, says: string) => {
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const exit = await install(root, 'linux', pinnedTo('linux-x64', zip, files))
    assert.isTrue(Exit.isFailure(exit))
    assert.include(JSON.stringify(exit), says)
    assert.isFalse(existsSync(join(root, 'antigravity', 'current')))
  }

  it('keeps nothing of what isn’t a zip at all: it holds none of the files pinned', async () => {
    await refused(
      text('not a zip at all, though it is what was pinned'.repeat(20)),
      { 'agy_acp_server.par': sum(text(SERVER)) },
      "didn't hold what it was pinned with",
    )
  })

  it('stops at the first file it shouldn’t hold, whatever follows', async () => {
    const zip = zipSync({ 'planted.sh': text('echo one'), 'also.sh': text('echo two'), 'agy_acp_server.par': text(SERVER) })
    await refused(zip, { 'agy_acp_server.par': sum(text(SERVER)) }, "couldn't be unpacked")
  })
})

describe('where an agent’s command is', () => {
  const opencode = agents.opencode

  it('finds the program a level or two down in its release, as archives nest it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-release-'))
    mkdirSync(join(dir, 'release', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'release', 'README'), 'OpenCode\n')
    writeFileSync(join(dir, 'release', 'bin', 'opencode'), '#!/bin/sh\necho 9.9.9\n', { mode: 0o755 })
    const file = join(dir, 'opencode-linux-x64.tar.gz')
    execFileSync('tar', ['-czf', file, '-C', dir, 'release'])
    const bytes = readFileSync(file)
    const fetch = async (url: string) =>
      url.endsWith('/releases/latest')
        ? Response.json({
            tag_name: 'v1.18.35',
            assets: [
              {
                name: 'opencode-linux-x64.tar.gz',
                browser_download_url: 'https://github.example/download',
                digest: `sha256:${sum(bytes)}`,
              },
            ],
          })
        : new Response(new Uint8Array(bytes))
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const layer = Installs.layer({ root, platform: 'linux', arch: 'x64', musl: false, fetch, search: { env: { PATH: '' }, dirs: [] } })
    const done = await Effect.runPromiseExit(
      Effect.provide(
        Effect.flatMap(Installs, (installs) => installs.install(opencode)),
        layer,
      ),
    )
    assert.isTrue(Exit.isSuccess(done), JSON.stringify(done))
    assert.strictEqual(execFileSync(join(root, 'opencode', 'current', 'opencode'), { encoding: 'utf8' }).trim(), '9.9.9')
  })

  it('takes the build for this computer where there is no musl one, and keeps none with nowhere to keep it', async () => {
    const state = (options: Partial<InstallsOptions>) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(Installs, (installs) => installs.state(opencode)),
          Installs.layer({ platform: 'darwin', arch: 'x64', musl: true, search: { env: { PATH: '' }, dirs: [] }, ...options }),
        ),
      )
    assert.isTrue((await state({ root: mkdtempSync(join(tmpdir(), 'althar-agents-')) })).downloadable)
    const nowhere = await state({})
    assert.isFalse(nowhere.downloadable)
    assert.isNull(nowhere.located)
  })

  it('looks where the person’s own commands are where it isn’t told where to look', () =>
    Effect.runPromise(
      Effect.provide(
        Effect.map(Installs, (installs) =>
          installs.locate({ ...opencode, cli: { name: 'althar-no-such-command', guide: 'https://althar.test' } }),
        ),
        Installs.layer({}),
      ),
    ).then((located) => assert.isNull(located)))

  it('runs here an agent with nothing to download, where the device has none of its own', async () => {
    const onDevice = { reachable: true, where: () => null, run: () => ({ command: 'flatpak-spawn', args: [] }) }
    const located = await Effect.runPromise(
      Effect.provide(
        Effect.map(Installs, (installs) => installs.locate(agents['claude-code'])),
        Installs.layer({ onDevice, search: { env: { PATH: '' }, dirs: [] } }),
      ),
    )
    assert.strictEqual(located?.whose, 'bundled')
    assert.isUndefined(located?.out)
  })
})
