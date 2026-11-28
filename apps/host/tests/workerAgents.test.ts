import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PINNED_PROGRAMS } from '@althar/provider-adapters'
import { describe, expect, it } from 'vitest'

import { bringProgram, programInRelease, WORKER_AGENTS, workerAgentsIn } from '../src/workerAgents'
import { temporary } from './support'

/*
 * The agents a worker runs (apps/host/src/workerAgents.ts), found as on any computer Althar runs on: the worker's own
 * install, a release from before agents came on first use that still carries Claude Code's or Codex's program, or the
 * copy Althar keeps under the worker's folder. Folders here are laid out as each leaves them.
 */

const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const TARGET = ARCH === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'

/** A file, its folders made, runnable. */
const file = (path: string, text = '#!/bin/sh\n') => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, { mode: 0o755 })
  return path
}

/** A release from before agents came on first use: Claude Code's and Codex's packages beside their adapters. */
const carrying = (release: string) => {
  const claude = join(release, 'node_modules', '@anthropic-ai', `claude-agent-sdk-linux-${ARCH}`)
  file(join(claude, 'claude'))
  writeFileSync(
    join(claude, 'package.json'),
    JSON.stringify({ name: `@anthropic-ai/claude-agent-sdk-linux-${ARCH}`, version: PINNED_PROGRAMS['claude-code'].version }),
  )
  const codex = join(release, 'node_modules', '@openai', `codex-linux-${ARCH}`)
  file(join(codex, 'vendor', TARGET, 'bin', 'codex'))
  file(join(codex, 'vendor', TARGET, 'codex-resources', 'voice', 'bin', 'codex-voice-host'))
  writeFileSync(
    join(codex, 'package.json'),
    JSON.stringify({ name: '@openai/codex', version: `${PINNED_PROGRAMS.codex.version}-linux-${ARCH}` }),
  )
  return { claude: join(claude, 'claude'), codex: join(codex, 'vendor', TARGET, 'bin', 'codex') }
}

describe('the agents a worker runs', () => {
  it('are every agent Althar runs as a program of its own, not Copilot’s loop that runs in Althar', () => {
    expect(WORKER_AGENTS).toEqual(
      expect.arrayContaining(['claude-code', 'codex', 'opencode', 'copilot', 'antigravity', 'junie', 'qwen-code']),
    )
    expect(WORKER_AGENTS).not.toContain('copilot-direct')
  })

  it('finds each where it is: the worker’s own, a release that carries it, or where Althar will keep it', () => {
    const folder = temporary()
    const release = temporary()
    const carried = carrying(release)
    // The worker's own OpenCode on its PATH; a Claude Code there too, whose version can't be read, so not one to drive.
    const bin = temporary()
    file(join(bin, 'opencode'))
    file(join(bin, 'claude'))
    const found = new Map(workerAgentsIn(folder, release, bin, []).map((agent) => [agent.id, agent]))
    expect([...found.keys()]).toEqual(WORKER_AGENTS)
    expect(found.get('opencode')?.located).toEqual({ command: 'opencode', whose: 'theirs' })
    expect(found.get('claude-code')?.located).toEqual({ command: carried.claude, whose: 'bundled' })
    expect(programInRelease(release, 'codex')).toBe(carried.codex)
    // Not there yet: Althar downloads Codex and OpenCode for Linux, and says where to get one it can't.
    const bare = new Map(workerAgentsIn(folder, temporary(), '', []).map((agent) => [agent.id, agent]))
    for (const id of ['claude-code', 'codex', 'opencode', 'copilot', 'antigravity'] as const) {
      expect(bare.get(id)?.located, id).toBeNull()
      expect(bare.get(id)?.downloadable, id).toBe(true)
    }
    expect(bare.get('junie')).toMatchObject({ located: null, downloadable: false, guide: expect.stringMatching(/^https:\/\//u) })
    // Its launch names where Althar will keep it, which its adapter is told to drive.
    const kept = join(folder, 'programs', 'codex', 'current', 'vendor', TARGET, 'bin', 'codex')
    expect(bare.get('codex')?.definition.launch('/node').env?.CODEX_PATH).toBe(kept)
    expect(bare.get('junie')?.definition.launch('/node').command).toBe('junie')
  })

  it('adopts Claude Code’s and Codex’s programs from a release that carries the ones pinned, linked, without their voice', async () => {
    const folder = temporary()
    const release = temporary()
    const carried = carrying(release)
    expect(await bringProgram(folder, '', 'codex', [temporary(), release])).toBe('adopted')
    const kept = join(folder, 'programs', 'codex', 'current')
    expect(statSync(join(kept, 'vendor', TARGET, 'bin', 'codex')).ino).toBe(statSync(carried.codex).ino)
    expect(existsSync(join(kept, 'vendor', TARGET, 'codex-resources', 'voice'))).toBe(false)
    expect(await bringProgram(folder, '', 'claude-code', [release])).toBe('adopted')
    // Found there from now on, as Althar's own.
    const found = workerAgentsIn(folder, temporary(), '', []).find((agent) => agent.id === 'codex')
    expect(found?.located).toEqual({ command: join(kept, 'vendor', TARGET, 'bin', 'codex'), whose: 'althar' })
  })

  it('downloads one no release here carries, and keeps nothing that isn’t the package pinned', async () => {
    const folder = temporary()
    const asked: string[] = []
    const npm = (async (url: string) => {
      asked.push(url)
      return new Response('not the package pinned')
    }) as unknown as typeof fetch
    await expect(bringProgram(folder, '', 'codex', [temporary()], undefined, npm)).rejects.toMatchObject({
      summary: expect.stringContaining("didn't match the one Althar pins"),
    })
    expect(asked).toEqual([PINNED_PROGRAMS.codex.assets[`linux-${ARCH}`]?.tarball])
    expect(existsSync(join(folder, 'programs', 'codex', 'current'))).toBe(false)
  })
})
