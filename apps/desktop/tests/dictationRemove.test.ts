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
          postMessage: (message: { id: string }) =>
            queueMicrotask(() => child.emit('message', { type: 'answer', id: message.id, value: undefined })),
          kill: () => {
            child.killed = true
            // It takes a moment to go, and the folder must still be whole until it has.
            setTimeout(() => {
              child.modelThere = existsSync(join(electron.models, PARAKEET.id))
              child.emit('exit', 0)
            }, 20)
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

    const folder = join(dir, PARAKEET.id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'ready.json'), JSON.stringify({ id: PARAKEET.id }))
    expect(await call('state')).toMatchObject({ model: { ready: true, name: PARAKEET.name } })

    // The speech process is running, as it is once the model has been used.
    await call('prepare')
    expect(electron.children).toHaveLength(1)

    await call('remove')
    const first = electron.children[0] as { killed: boolean; modelThere: boolean | undefined }
    expect(first.killed).toBe(true)
    // The folder was still there when the process exited, and gone once Remove returned.
    expect(first.modelThere).toBe(true)
    expect(existsSync(folder)).toBe(false)
    expect(await call('state')).toMatchObject({ model: { ready: false, got: 0, downloading: false } })

    // Dictating again brings the model down by starting a speech process again.
    await call('download')
    expect(electron.children).toHaveLength(2)
    expect(await call('state')).toMatchObject({ model: { downloading: true } })
  })
})
