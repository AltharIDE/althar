import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { removeTreeSync } from '@althar/testing'
import { budget } from '@althar/testing/budget'
import { afterEach, describe, expect, it } from 'vitest'

import metadata from '../package.json'

const bundle = fileURLToPath(new URL('../dist/althar-host.js', import.meta.url))
const children: ChildProcess[] = []
const roots: string[] = []
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
  for (const root of roots.splice(0)) removeTreeSync(root)
})

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-host-process-'))
  roots.push(root)
  const profile = join(root, 'profile')
  const keyFile = join(root, 'keys/master')
  const common = ['--profile', profile, '--key-file', keyFile, '--json']
  // No developer credentials, sign-ins or private provider configuration enter a process fixture.
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    TMPDIR: root,
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
  }
  return { root, profile, keyFile, common, env }
}
const command = (args: string[], env: NodeJS.ProcessEnv) =>
  promisify(execFile)(process.execPath, [bundle, ...args], { env, timeout: budget.medium, maxBuffer: 1_048_576 })
const launch = (args: string[], env: NodeJS.ProcessEnv) => {
  const child = spawn(process.execPath, [bundle, 'serve', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let diagnostics = ''
  child.stderr?.on('data', (part: Buffer) => {
    diagnostics = (diagnostics + part.toString()).slice(-65_536)
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  const ready = new Promise<{ homeId: string; pid: number }>((resolve, reject) => {
    let output = ''
    child.once('error', reject)
    child.once('exit', () => reject(new Error(`Host exited before readiness: ${diagnostics}`)))
    child.stdout?.on('data', (part: Buffer) => {
      output += part.toString()
      for (;;) {
        const end = output.indexOf('\n')
        if (end < 0) break
        const line = output.slice(0, end)
        output = output.slice(end + 1)
        try {
          const value: unknown = JSON.parse(line)
          if (
            typeof value === 'object' &&
            value !== null &&
            'state' in value &&
            value.state === 'ready' &&
            'homeId' in value &&
            typeof value.homeId === 'string' &&
            'pid' in value &&
            typeof value.pid === 'number'
          )
            resolve({ homeId: value.homeId, pid: value.pid })
        } catch {
          reject(new Error(`Invalid readiness output: ${line}`))
        }
      }
    })
  })
  return { child, ready, exited }
}

describe.runIf(process.platform === 'linux')('the built Node host', () => {
  it('initializes, serves without a terminal or GUI, checks health without the master key, and shuts down and restarts cleanly', async () => {
    const at = fixture()
    const initialized: unknown = JSON.parse((await command(['init', ...at.common], at.env)).stdout)
    if (typeof initialized !== 'object' || initialized === null || !('homeId' in initialized) || typeof initialized.homeId !== 'string')
      throw new Error('Missing initialized home identity')
    const host = launch(at.common, at.env)
    const first = await host.ready
    expect(first.homeId).toBe(initialized.homeId)
    renameSync(at.keyFile, `${at.keyFile}.offline`)
    const status: unknown = JSON.parse((await command(['status', ...at.common], at.env)).stdout)
    expect(status).toMatchObject({ state: 'ready', homeId: initialized.homeId })
    renameSync(`${at.keyFile}.offline`, at.keyFile)
    await expect(command(['serve', ...at.common], at.env)).rejects.toMatchObject({ code: 75 })
    host.child.kill('SIGTERM')
    expect(await host.exited).toEqual({ code: 0, signal: null })
    expect(existsSync(join(at.profile, 'api/endpoint.json'))).toBe(false)
    const restarted = launch(at.common, at.env)
    const second = await restarted.ready
    expect(second.homeId).toBe(first.homeId)
    expect(second.pid).not.toBe(first.pid)
    restarted.child.kill('SIGINT')
    expect(await restarted.exited).toEqual({ code: 0, signal: null })
    await expect(command(['status', ...at.common], at.env)).rejects.toMatchObject({ code: 75 })
  })

  it('does not create an encryption key when an uninitialized host is started', async () => {
    const at = fixture()
    await expect(command(['serve', ...at.common], at.env)).rejects.toMatchObject({ code: 78 })
    expect(existsSync(at.keyFile)).toBe(false)
    const version = await command(['--version'], at.env)
    expect(version.stdout.trim()).toBe(metadata.version)
  })
})
