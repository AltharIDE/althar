import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { c } from 'tar'
import { describe, expect, it } from 'vitest'

import { installTool, installTools, satisfies, type ToolFetch, type ToolPlatform } from '../src/workerTools'
import { temporary } from './support'

/*
 * The tools a worker installs for a project itself (apps/host/src/workerTools.ts), from their makers' releases stood in
 * for: each checked against its published digest, unpacked into the worker's folder, and said by its folder of programs.
 */

const linux: ToolPlatform = { arch: 'x64', musl: false, avx2: true }

/** A .tar.gz holding these files under `top`. */
const archive = async (files: Readonly<Record<string, string>>, top: string) => {
  const at = temporary()
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(at, top, path, '..'), { recursive: true })
    writeFileSync(join(at, top, path), text, { mode: 0o755 })
  }
  const file = join(temporary(), 'archive.tgz')
  await c({ gzip: true, file, cwd: at, portable: true }, [top])
  return readFileSync(file)
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** A maker's servers: each address its answer; anything else, a 404. Asked addresses are kept. */
const servers = (answers: Readonly<Record<string, Buffer | string | { readonly location: string }>>) => {
  const asked: string[] = []
  const fetcher: ToolFetch = async (url) => {
    asked.push(url)
    const answer = answers[url]
    if (answer === undefined) return new Response('no', { status: 404 })
    if (typeof answer === 'object' && 'location' in answer)
      return new Response(null, { status: 302, headers: { location: answer.location } })
    return new Response(answer)
  }
  return { fetcher, asked }
}

const npm = (name: string, versions: Readonly<Record<string, Buffer>>, latest: string) =>
  JSON.stringify({
    'dist-tags': { latest },
    versions: Object.fromEntries(
      Object.entries(versions).map(([version, bytes]) => [
        version,
        { dist: { tarball: `https://registry.npmjs.org/${name}/-/${version}.tgz`, integrity: integrity(bytes) } },
      ]),
    ),
  })

describe('which version is asked', () => {
  it('takes the same version, or one of its major or minor', () => {
    expect(satisfies('24', '24.11.1')).toBe(true)
    expect(satisfies('v24', '24.11.1')).toBe(true)
    expect(satisfies('1.3', '1.3.5')).toBe(true)
    expect(satisfies('1.3.5', '1.3.5')).toBe(true)
    expect(satisfies('2', '24.0.0')).toBe(false)
  })
})

describe('installing a tool', () => {
  it('installs Bun from npm, checked by its integrity, with bunx beside it, and uses it as it is the next time', async () => {
    const root = temporary()
    const old = await archive({ 'bin/bun': 'old' }, 'package')
    const bun = await archive({ 'bin/bun': '#!/bin/sh\necho bun\n', 'package.json': '{}' }, 'package')
    const { fetcher, asked } = servers({
      'https://registry.npmjs.org/@oven/bun-linux-x64': npm('@oven/bun-linux-x64', { '1.3.4': old, '1.3.5': bun }, '1.3.5'),
      'https://registry.npmjs.org/@oven/bun-linux-x64/-/1.3.5.tgz': bun,
    })
    const said: string[] = []
    await installTool(root, 'bun', '1.3', (text) => said.push(text), fetcher, linux)
    const bin = join(root, 'bun', '1.3.5', 'bin')
    expect(said).toEqual(['Installed Bun 1.3.5.\n', `path\t${bin}\n`])
    expect(readFileSync(join(bin, 'bun'), 'utf8')).toContain('echo bun')
    expect(readlinkSync(join(bin, 'bunx'))).toBe('bun')
    expect(existsSync(join(bin, 'package.json'))).toBe(false)
    asked.length = 0
    said.length = 0
    await installTool(root, 'bun', '1.3.5', (text) => said.push(text), fetcher, linux)
    expect(said).toEqual([`path\t${bin}\n`])
    expect(asked).toEqual([])
  })

  it('takes Bun’s baseline build on a processor without AVX2, and its musl build on musl', async () => {
    const { fetcher, asked } = servers({})
    await expect(
      installTool(temporary(), 'bun', 'latest', () => undefined, fetcher, { arch: 'x64', musl: true, avx2: false }),
    ).rejects.toThrow()
    expect(asked).toEqual(['https://registry.npmjs.org/@oven/bun-linux-x64-baseline-musl'])
  })

  it('installs Node’s own build of the newest release asked, checked by its SHASUMS256', async () => {
    const root = temporary()
    const node = await archive({ 'bin/node': 'node', 'bin/npm': 'npm' }, 'node-v24.11.1-linux-x64')
    const { fetcher } = servers({
      'https://nodejs.org/dist/index.json': JSON.stringify([
        { version: 'v25.1.0', lts: false },
        { version: 'v24.11.1', lts: 'Krypton' },
        { version: 'v24.10.0', lts: 'Krypton' },
      ]),
      'https://nodejs.org/dist/v24.11.1/SHASUMS256.txt': `${sha256(node)}  node-v24.11.1-linux-x64.tar.gz\n${'0'.repeat(64)}  node-v24.11.1-linux-arm64.tar.gz\n`,
      'https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.gz': node,
    })
    const said: string[] = []
    await installTool(root, 'node', 'lts', (text) => said.push(text), fetcher, linux)
    expect(said.at(-1)).toBe(`path\t${join(root, 'node', '24.11.1', 'bin')}\n`)
    expect(readFileSync(join(root, 'node', '24.11.1', 'bin', 'npm'), 'utf8')).toBe('npm')
  })

  it('runs pnpm’s own programs by the Node on the run’s PATH', async () => {
    const root = temporary()
    const pnpm = await archive(
      { 'package.json': JSON.stringify({ bin: { pnpm: 'bin/pnpm.cjs', pnpx: 'bin/pnpx.cjs', '../x': 'y' } }), 'bin/pnpm.cjs': '' },
      'package',
    )
    const { fetcher } = servers({
      'https://registry.npmjs.org/pnpm': npm('pnpm', { '10.4.1': pnpm }, '10.4.1'),
      'https://registry.npmjs.org/pnpm/-/10.4.1.tgz': pnpm,
    })
    await installTool(root, 'pnpm', '10', () => undefined, fetcher, linux)
    const folder = join(root, 'pnpm', '10.4.1')
    expect(readFileSync(join(folder, 'bin', 'pnpm'), 'utf8')).toBe(
      `#!/bin/sh\nexec node '${join(folder, 'package', 'bin', 'pnpm.cjs')}' "$@"\n`,
    )
    expect(existsSync(join(folder, 'bin', 'pnpx'))).toBe(true)
  })

  it('installs uv’s latest release, as GitHub says it, checked by the sha256 beside it', async () => {
    const root = temporary()
    const uv = await archive({ uv: 'uv', uvx: 'uvx' }, 'uv-x86_64-unknown-linux-gnu')
    const url = 'https://github.com/astral-sh/uv/releases/download/0.13.10/uv-x86_64-unknown-linux-gnu.tar.gz'
    const { fetcher } = servers({
      'https://github.com/astral-sh/uv/releases/latest': { location: 'https://github.com/astral-sh/uv/releases/tag/0.13.10' },
      [url]: uv,
      [`${url}.sha256`]: `${sha256(uv)}  uv-x86_64-unknown-linux-gnu.tar.gz\n`,
    })
    await installTool(root, 'uv', 'latest', () => undefined, fetcher, linux)
    expect(readFileSync(join(root, 'uv', '0.13.10', 'bin', 'uvx'), 'utf8')).toBe('uvx')
  })

  it('installs nothing that doesn’t match its digest', async () => {
    const root = temporary()
    const bun = await archive({ 'bin/bun': 'bun' }, 'package')
    const { fetcher } = servers({
      'https://registry.npmjs.org/@oven/bun-linux-x64': npm('@oven/bun-linux-x64', { '1.3.5': bun }, '1.3.5'),
      'https://registry.npmjs.org/@oven/bun-linux-x64/-/1.3.5.tgz': Buffer.concat([bun, Buffer.from('x')]),
    })
    await expect(installTool(root, 'bun', '1.3.5', () => undefined, fetcher, linux)).rejects.toThrow('didn’t match its digest')
    expect(existsSync(join(root, 'bun', '1.3.5'))).toBe(false)
  })

  it('stops at the first it can’t install, saying which and why', async () => {
    const { fetcher } = servers({})
    await expect(installTools(temporary(), ['node@99'], () => undefined, fetcher)).rejects.toThrow(/^Couldn’t install Node 99: /u)
    await expect(installTools(temporary(), ['node@1;x'], () => undefined, fetcher)).rejects.toThrow('isn’t a tool a worker installs')
  })
})
