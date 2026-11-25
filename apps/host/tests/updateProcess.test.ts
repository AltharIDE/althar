import { spawn, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Agents } from '@althar/runtime'
import { budget } from '@althar/testing/budget'
import { Effect, Layer } from 'effect'
import { c } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'

import { initializeHome } from '../src/home'
import { parseOptions } from '../src/options'
import { configureUpdates } from '../src/updates/setup'
import { applyStaged } from '../src/updates/controller'
import { stageUpdate } from '../src/updates/stage'
import { loadInstallation, readState } from '../src/updates/store'
import { digest, releaseIdentity, type ReleaseManifest } from '../src/updates/release'
import { releaseInfo } from '../src/updates/info'
import { copyHostAssets, type BundleSource } from '../src/updates/bundle'
import type { UpdateServices } from '../src/updates/execute'
import metadata from '../package.json'
import { temporary } from './support'

const bundle = fileURLToPath(new URL('../dist/althar-host.js', import.meta.url))
const children: ChildProcess[] = []
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          child.once('exit', () => resolve())
          child.kill('SIGKILL')
        }),
    ),
  )
})
const put = (path: string, bytes: string, executable = false) => {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(path, bytes, { mode: executable ? 0o700 : 0o600 })
}
// The real Node host, with inert version-only provider executables and no account credentials.
const assembleFixture = async (source: BundleSource, folder: string) => {
  mkdirSync(join(folder, 'node/bin'), { recursive: true, mode: 0o700 })
  copyFileSync(source.node, join(folder, 'node/bin/node'))
  chmodSync(join(folder, 'node/bin/node'), 0o700)
  put(join(folder, 'dist/althar-host.js'), readFileSync(source.entry, 'utf8'))
  await copyHostAssets(bundle, join(folder, 'dist'))
  put(join(folder, 'node/LICENSE'), 'Process fixture; not a distributed release')
  put(join(folder, 'package.json'), '{"type":"module"}')
  put(join(folder, 'LICENSE'), 'Fixture application license')
  put(join(folder, 'THIRD_PARTY_NOTICES.txt'), 'Fixture third-party notices')
  const module = (name: string, version: string, main = true) => {
    put(join(folder, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, ...(main ? { main: 'index.js' } : {}) }))
    if (main) put(join(folder, 'node_modules', name, 'index.js'), '')
  }
  // The release's preflight checks these against the host's own pins.
  for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const)
    module(name, metadata.dependencies[name])
  module('@anthropic-ai/claude-agent-sdk', '0.3.322')
  module(`@anthropic-ai/claude-agent-sdk-linux-${process.arch}`, '0.3.322', false)
  module('@openai/codex', '0.0.0')
  module(`@openai/codex-linux-${process.arch}`, '0.0.0', false)
  const version = '#!/bin/sh\necho "fixture version 1.0.0"\n'
  put(join(folder, 'node_modules', `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`, 'claude'), version, true)
  put(
    join(
      folder,
      'node_modules',
      `@openai/codex-linux-${process.arch}`,
      'vendor',
      process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl',
      'bin/codex',
    ),
    version,
    true,
  )
}
const alteredBundle = (folder: string, version: string, failStartup = false) => {
  let source = readFileSync(bundle, 'utf8')
  const pattern = /(name:\s*"@althar\/host",\s*version:\s*")0\.1\.0(")/
  if (!pattern.test(source)) throw new Error('Host metadata could not be versioned in the release fixture')
  source = source.replace(pattern, (_match: string, prefix: string, suffix: string) => `${prefix}${version}${suffix}`)
  if (failStartup) {
    const serve = 'case "serve":'
    const at = source.lastIndexOf(serve)
    if (at < 0) throw new Error('Missing host command in release fixture')
    source = source.slice(0, at) + source.slice(at).replace(serve, `${serve}\nthrow new Error("Fixture startup failure");`)
  }
  const path = join(folder, `host-${version}.js`)
  put(path, source)
  return path
}

describe.runIf(process.platform === 'linux')('managed host processes', () => {
  it(
    'activates a signed release through the stable launcher, preserves identity/key/data, and recovers a failed subsequent release',
    async () => {
      const root = temporary()
      const options = parseOptions(
        ['init', '--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master'), '--installation', join(root, 'program')],
        { XDG_CONFIG_HOME: join(root, 'config') },
        root,
      )
      const initialized = await Effect.runPromise(
        initializeHome(options, {
          agents: Layer.succeed(Agents, Agents.from([])),
          agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
        }),
      )
      const originalKey = readFileSync(options.keyFile)
      const pair = generateKeyPairSync('ed25519')
      const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      const keyFile = join(root, 'release.pub')
      put(keyFile, publicKey)
      let child: ChildProcess | undefined
      let current = ''
      const env = {
        HOME: root,
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'),
        PATH: '/usr/bin:/bin',
        LANG: 'C.UTF-8',
      }
      const services: UpdateServices = {
        active: async () => child !== undefined && child.exitCode === null && child.signalCode === null,
        stop: async () => {
          if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
          const exiting = new Promise<void>((resolve) => child?.once('exit', () => resolve()))
          child.kill('SIGTERM')
          await exiting
        },
        start: async () => {
          const running = spawn(
            '/bin/sh',
            [
              join(options.updateRoot, 'launcher'),
              'serve',
              '--installation',
              options.updateRoot,
              '--profile',
              options.profile,
              '--key-file',
              options.keyFile,
              '--json',
            ],
            { env, stdio: ['ignore', 'pipe', 'pipe'] },
          )
          children.push(running)
          child = running
          let diagnostics = ''
          let output = ''
          running.stderr?.on('data', (chunk: Buffer) => {
            diagnostics = (diagnostics + chunk.toString()).slice(-16_384)
          })
          await new Promise<void>((resolve, reject) => {
            running.once('error', reject)
            running.once('exit', (code) => reject(new Error(`Host startup exited ${code}: ${diagnostics}`)))
            running.stdout?.on('data', (chunk: Buffer) => {
              output += chunk.toString()
              for (const line of output.split('\n').slice(0, -1)) {
                try {
                  const value: unknown = JSON.parse(line)
                  if (
                    typeof value === 'object' &&
                    value !== null &&
                    'state' in value &&
                    value.state === 'ready' &&
                    'homeId' in value &&
                    value.homeId === initialized.homeId &&
                    'version' in value &&
                    typeof value.version === 'string'
                  ) {
                    current = value.version
                    resolve()
                  }
                } catch (error) {
                  reject(error)
                }
              }
            })
          })
        },
        kick: async () => {},
      }
      await configureUpdates(
        { ...options, releaseKeys: [keyFile] },
        { node: process.execPath, entry: bundle, path: '/usr/bin:/bin', run: async () => {} },
        { services, assemble: assembleFixture },
      )
      await services.start('fixture')
      expect(current).toBe('0.1.0')
      for (const [version, fails, sequence] of [
        ['0.1.1', false, 1],
        ['0.1.2', true, 2],
      ] as const) {
        const source = alteredBundle(root, version, fails)
        const tree = join(root, `release-${version}`)
        await assembleFixture({ entry: source, node: process.execPath, version }, tree)
        const files: string[] = []
        const walk = (folder: string) => {
          for (const entry of requireDirectory(folder)) {
            if (entry.directory) walk(entry.path)
            else files.push(entry.path)
          }
        }
        walk(tree)
        const archive = join(root, `${version}.tar.gz`)
        await c({ file: archive, cwd: tree, gzip: true, portable: true, noMtime: true }, [
          'dist',
          'node',
          'node_modules',
          'package.json',
          'LICENSE',
          'THIRD_PARTY_NOTICES.txt',
        ])
        const bytes = readFileSync(archive)
        const now = Date.now()
        const manifest: ReleaseManifest = {
          format: 1,
          version,
          sequence,
          publishedAt: new Date(now - 1000).toISOString(),
          expiresAt: new Date(now + 86_400_000).toISOString(),
          platform: 'linux',
          arch: releaseInfo().arch,
          updaterProtocol: 1,
          apiVersion: releaseInfo().apiVersion,
          storage: releaseInfo().storage,
          archive: { url: `https://updates.example/${version}.tar.gz`, bytes: bytes.length, sha256: digest(bytes) },
          files: files.length,
          unpackedBytes: files.reduce((sum, path) => sum + statSync(path).size, 0),
        }
        const payload = Buffer.from(JSON.stringify(manifest))
        const envelope = Buffer.from(
          JSON.stringify({
            format: 1,
            keyId: releaseIdentity(publicKey),
            payload: payload.toString('base64url'),
            signature: sign(null, payload, pair.privateKey).toString('base64url'),
          }),
        )
        const installation = await loadInstallation(options.updateRoot)
        await import('../src/updates/store').then(({ writeJSON }) =>
          writeJSON(join(options.updateRoot, 'updates.json'), {
            ...installation.config,
            feed: { kind: 'manifest', url: 'https://updates.example/feed' },
          }),
        )
        await stageUpdate(options.updateRoot, { fetch: async (url) => new Response(url.endsWith('/feed') ? envelope : bytes) })
        if (fails) await expect(applyStaged(options.updateRoot, false, { services })).rejects.toThrow()
        else await applyStaged(options.updateRoot, false, { services })
        expect(current).toBe('0.1.1')
        expect(readFileSync(options.keyFile)).toEqual(originalKey)
        expect((await loadInstallation(options.updateRoot)).config.homeId).toBe(initialized.homeId)
        expect((await readState(options.updateRoot)).transaction).toBeUndefined()
      }
      await services.stop('fixture')
    },
    budget.large,
  )
})

const requireDirectory = (folder: string) =>
  readdirSync(folder, { withFileTypes: true }).map((entry) => ({ path: join(folder, entry.name), directory: entry.isDirectory() }))
