import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { PARAKEET } from '../src/speech/model'

/*
 * Removing the speech model, in the main process: the speech process is gone
 * before the folder is deleted (Windows can't delete files a process has
 * open), the model then reads as absent, and the next download starts a
 * speech process again.
 */

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: Array<unknown>) => Promise<unknown>>(),
  children: [] as Array<unknown>,
  models: '',
  /* Message types the fake speech process never answers. */
  silent: new Set<string>(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (name: string, handler: never) => void electron.handlers.set(name, handler) },
    session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } },
    shell: { openExternal: async () => {} },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    utilityProcess: {
      fork: () => {
        const child = Object.assign(new EventEmitter(), {
          killed: false,
          modelThere: undefined as boolean | undefined,
          postMessage: (message: { id: string; type: string }) =>
            !electron.silent.has(message.type) &&
            queueMicrotask(() => child.emit('message', { type: 'answer', id: message.id, value: undefined })),
          kill: () => {
            child.killed = true
            // It takes a moment to go, and the folder must still be whole until it has.
            setTimeout(() => {
              child.modelThere = existsSync(join(electron.models, PARAKEET.id))
              child.emit('exit', 0)
            }, 20)
            return true
          },
        })
        electron.children.push(child)
        return child
      },
    },
  }
})

const dir = mkdtempSync(join(tmpdir(), 'althar-dictation-'))
Object.assign(electron, { models: dir })

describe('removing the speech model', () => {
  it('waits for the speech process to go, deletes the folder, then downloads again on the next dictation', async () => {
    const { startDictation } = await import('../src/main/dictation')
    startDictation({ script: 'speech.js', models: () => dir, mine: () => true, fakeModel: true, fakeMicrophone: true })
    const call = (name: string, ...args: Array<unknown>) => electron.handlers.get(`althar:dictation-${name}`)?.({ sender: {} }, ...args)

    // The test may run again in the same process: count from where the speech processes stand now.
    const before = electron.children.length
    const folder = join(dir, PARAKEET.id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ready.json'), JSON.stringify({ id: PARAKEET.id }))
    expect(await call('state')).toMatchObject({ model: { ready: true, name: PARAKEET.name } })

    // The speech process is running, as it is once the model has been used.
    await call('prepare')
    expect(electron.children).toHaveLength(before + 1)

    await call('remove')
    const first = electron.children[before] as { killed: boolean; modelThere: boolean | undefined }
    expect(first.killed).toBe(true)
    // The folder was still there when the process exited, and gone once Remove returned.
    expect(first.modelThere).toBe(true)
    expect(existsSync(folder)).toBe(false)
    expect(await call('state')).toMatchObject({ model: { ready: false, got: 0, downloading: false } })

    // Dictating again brings the model down by starting a speech process again.
    await call('download')
    expect(electron.children).toHaveLength(before + 2)
    expect(await call('state')).toMatchObject({ model: { downloading: true } })
  })
})

describe('removing the speech model while it is in use', () => {
  const setup = async () => {
    const { startDictation } = await import('../src/main/dictation')
    startDictation({ script: 'speech.js', models: () => dir, mine: () => true, fakeModel: true, fakeMicrophone: true })
    return (name: string, ...args: Array<unknown>) => electron.handlers.get(`althar:dictation-${name}`)?.({ sender: {} }, ...args)
  }

  it('refuses while another window is writing down speech, and keeps the speech process', async () => {
    const call = await setup()
    const before = electron.children.length
    electron.silent.add('transcribe')
    const pending = call('transcribe', new Float32Array(1), 16_000)
    await Promise.resolve()
    await expect(call('remove')).rejects.toThrow(/writing down speech/)
    expect((electron.children[before] as { killed: boolean }).killed).toBe(false)
    electron.silent.delete('transcribe')
    void pending
  })

  it('holds a new speech request until the removal is done', async () => {
    const call = await setup()
    mkdirSync(join(dir, PARAKEET.id), { recursive: true })
    await call('prepare')
    const spawned = electron.children.length
    const removal = call('remove')
    const prepare = call('prepare')
    await new Promise((done) => setTimeout(done, 5))
    // The old process is still going: nothing has started a new one yet.
    expect(electron.children).toHaveLength(spawned)
    await removal
    await prepare
    expect(electron.children).toHaveLength(spawned + 1)
    expect(existsSync(join(dir, PARAKEET.id))).toBe(false)
  })
})
