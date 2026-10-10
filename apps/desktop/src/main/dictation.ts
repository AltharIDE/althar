import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { PARAKEET, presence, sizeOf } from '../speech/model'

import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  session,
  shell,
  systemPreferences,
  type UtilityProcess,
  utilityProcess,
  type WebContents,
} from 'electron'

/*
 * Dictation, as the main process holds it (ADR-017). The window records and
 * shows; this asks the system for the microphone, opens the system's own
 * settings when it was refused, and starts the speech process that brings the
 * model down and turns speech into text, stopping it again once it has sat
 * idle. Every window hears how a download goes, since there is one model for
 * all of them. Nothing goes over the network but the model's download.
 *
 * It also holds the window's web permissions: the microphone, for audio
 * alone, and writing to the clipboard, for Althar's own windows, and nothing
 * else for anyone.
 */

/** Whether the system lets Althar use the microphone: yes, it would ask (macOS, the first time), or it said no. */
export type Microphone = 'granted' | 'ask' | 'denied'

/** Which of the system's settings to open: its microphone privacy, or its sound input. */
export type SettingsPane = 'privacy' | 'sound'

export interface DictationOptions {
  /** The speech process's script. */
  readonly script: string
  /** The folder models are kept in. */
  readonly models: () => string
  /** Whether a page is one of Althar's own windows, which alone may dictate. */
  readonly mine: (contents: WebContents) => boolean
  /** The end-to-end tests' stand-in model: it comes down at once and hears the same words every time. */
  readonly fakeModel: boolean
  /** The end-to-end tests' microphone, Chromium's own: the system is never asked about it. */
  readonly fakeMicrophone: boolean
}

/* The speech process goes after this long with nothing to do, and the model's memory with it. */
const IDLE = 10 * 60_000

/* The system's own settings, where it has a way to open them. */
const SETTINGS: Partial<Record<NodeJS.Platform, Record<SettingsPane, string>>> = {
  darwin: {
    privacy: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    sound: 'x-apple.systempreferences:com.apple.preference.sound?input',
  },
  win32: { privacy: 'ms-settings:privacy-microphone', sound: 'ms-settings:sound' },
}

/* What the speech process says: an answer by id, or how a download goes. */
interface SpeechMessage {
  readonly type?: string
  readonly id?: string
  readonly value?: unknown
  readonly error?: string
  readonly got?: number
  readonly size?: number
  readonly stop?: unknown
}

export function startDictation(options: DictationOptions) {
  let child: UtilityProcess | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let downloading = false
  /* How far the download had come, last it said: what a speech process that stopped mid-way leaves. */
  let got = 0
  const waiting = new Map<string, { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }>()

  const broadcast = (event: SpeechMessage) => {
    for (const window of BrowserWindow.getAllWindows())
      if (options.mine(window.webContents)) window.webContents.send('althar:dictation', event)
  }

  /* Rests once nothing is waiting and nothing is coming down. */
  const rest = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      if (!downloading && waiting.size === 0) child?.kill()
    }, IDLE)
  }

  const speech = () => {
    if (child !== undefined) return child
    const started = utilityProcess.fork(options.script, [], {
      serviceName: 'Althar speech',
      stdio: 'inherit',
      env: { ...process.env, ALTHAR_SPEECH: options.models(), ...(options.fakeModel ? { ALTHAR_FAKE_SPEECH: '1' } : {}) },
    })
    started.on('message', (message: SpeechMessage) => {
      if (message.type === 'answer' && message.id !== undefined) {
        const settle = waiting.get(message.id)
        waiting.delete(message.id)
        if (message.error === undefined) settle?.resolve(message.value)
        else settle?.reject(new Error(message.error))
        return rest()
      }
      if (message.type === 'progress' && typeof message.got === 'number') got = message.got
      if (message.type === 'downloaded' || message.type === 'stopped') {
        downloading = false
        // A download outlasts the idle timer: it starts again from when the download ends.
        rest()
      }
      broadcast(message)
    })
    started.once('exit', () => {
      if (child === started) child = undefined
      if (downloading) broadcast({ type: 'stopped', stop: { reason: 'network' }, got, size: sizeOf(PARAKEET) })
      downloading = false
      for (const [id, settle] of waiting) {
        waiting.delete(id)
        settle.reject(new Error('The speech process stopped.'))
      }
    })
    child = started
    return started
  }

  const ask = (type: string, extra: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      const id = randomUUID()
      waiting.set(id, { resolve, reject })
      speech().postMessage({ id, type, ...extra })
      rest()
    })

  const microphone = (): Microphone => {
    if (options.fakeMicrophone) return 'granted'
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      return status === 'granted' ? 'granted' : status === 'not-determined' ? 'ask' : 'denied'
    }
    // Windows says whether desktop apps may use it; Linux has no such setting.
    if (process.platform === 'win32') return systemPreferences.getMediaAccessStatus('microphone') === 'denied' ? 'denied' : 'granted'
    return 'granted'
  }

  // The window's web permissions: the microphone, for audio alone, and writing what the person copies to the clipboard (Copy, never
  // reading it), in Althar's own windows. Nothing else, for anyone.
  const audioOnly = (types: ReadonlyArray<string> | undefined) =>
    types !== undefined && types.length > 0 && types.every((type) => type === 'audio')
  const copying = (permission: string) => permission === 'clipboard-sanitized-write'
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) =>
    done(
      options.mine(contents) &&
        ((permission === 'media' && 'mediaTypes' in details && audioOnly(details.mediaTypes)) || copying(permission)),
    ),
  )
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      contents !== null && options.mine(contents) && ((permission === 'media' && details.mediaType === 'audio') || copying(permission)),
  )

  /** Only Althar's own windows dictate. */
  const from = (event: IpcMainInvokeEvent) => {
    if (!options.mine(event.sender)) throw new Error('Only Althar’s window dictates.')
  }

  ipcMain.handle('althar:dictation-state', async (event) => {
    from(event)
    const here = await presence(join(options.models(), PARAKEET.id), PARAKEET)
    return {
      platform: process.platform,
      microphone: microphone(),
      model: { ...here, ...(downloading ? { got: Math.max(here.got, got) } : {}), downloading },
      settings: SETTINGS[process.platform] !== undefined,
    }
  })
  // Asks the system where it asks (macOS, once); elsewhere says what it allows.
  ipcMain.handle('althar:dictation-allow', async (event) => {
    from(event)
    if (process.platform === 'darwin' && microphone() === 'ask') return systemPreferences.askForMediaAccess('microphone')
    return microphone() === 'granted'
  })
  ipcMain.handle('althar:dictation-download', async (event) => {
    from(event)
    downloading = true
    got = 0
    await ask('download')
  })
  ipcMain.handle('althar:dictation-cancel', async (event) => {
    from(event)
    downloading = false
    await ask('cancel')
    broadcast({ type: 'cancelled' })
  })
  ipcMain.handle('althar:dictation-prepare', async (event) => {
    from(event)
    await ask('prepare')
  })
  ipcMain.handle('althar:dictation-transcribe', async (event, samples: unknown, sampleRate: unknown) => {
    from(event)
    if (!(samples instanceof Float32Array) || typeof sampleRate !== 'number' || !Number.isFinite(sampleRate))
      throw new Error('Nothing to write down.')
    return ask('transcribe', { samples, sampleRate })
  })
  ipcMain.handle('althar:dictation-settings', async (event, pane: unknown) => {
    from(event)
    const url = pane === 'privacy' || pane === 'sound' ? SETTINGS[process.platform]?.[pane] : undefined
    if (url === undefined) return false
    await shell.openExternal(url)
    return true
  })

  return {
    /** Stops the speech process, as the app quits. */
    stop: () => {
      clearTimeout(idle)
      child?.kill()
    },
  }
}
