import { randomUUID } from 'node:crypto'
import { homedir, hostname, release, userInfo } from 'node:os'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, net, shell, type WebContents } from 'electron'

import { masker } from '../../logs/mask'
import { tail } from '../../logs/logFile'
import { readPreferences, writePreference } from '../preferences'
import { assemble, type Gathered, type Opened, type Picture, preview, type ReportChoices, type ReportContext, type Sent } from './bundle'
import { mailto, NotDelivered, post, reportAddress, save } from './deliver'
import { factsIn, type RuntimeFacts } from './facts'
import { mainFacts } from './mainFacts'

/*
 * Report a problem, as the main process holds it (DEV-61). The window asks
 * to open one before it draws the dialog, so the screenshot is of the window
 * as the person saw it; gathering the rest (the runtime's facts, each log's
 * tail, this install's id) starts at once and goes on while they write.
 * "See what's sent" waits for it. Sending puts the report together as they
 * chose, masked, and posts it to the Worker, or, with no Worker in the
 * app's config, saves it in Downloads and opens a mail to send it with. The
 * email they give is kept for next time, in the profile's desktop.json.
 */

/** How much of each log goes: its last 96 KB. */
const TAIL = 96_000

/** The logs a report takes the tail of, as the processes write them. */
const LOGS = ['main', 'runtime', 'agents']

/** The largest PNG of the window that goes; a larger one goes as a JPEG. The Worker takes 4 MB. */
const LARGEST_PNG = 3_500_000

/** The widest the screenshot goes, and its preview, in pixels. */
const WIDEST = { sent: 1_600, preview: 720 }

/** How long the runtime has to say its facts; it answers at once when it can't. */
const WAIT_RUNTIME = 8_000

export interface ReportsOptions {
  readonly profile: () => string
  /** This install's id, usage data's own (usageData.ts's `installOf`), so there is one id per install. */
  readonly installId: () => Promise<string>
  /** The folder the logs are in. */
  readonly logs: string
  /** Asks the runtime for its facts about the thread, if any (runtime/facts.ts); what it answers, unchecked. */
  readonly askRuntime: (threadId: string | null) => Promise<unknown>
  /** Whether a page is one of Althar's own windows, which alone may report. */
  readonly mine: (contents: WebContents) => boolean
  /** The Worker's address, as the app's config gives it; none for the mail. */
  readonly address: string | undefined
  /** Where the mail goes. */
  readonly email: string
}

const ID = /^[A-Za-z0-9_-]{1,64}$/
const idOrNull = (value: unknown) => (typeof value === 'string' && ID.test(value) ? value : null)

/** Where the window says it was asked from, as far as it is what it should be. */
export const contextIn = (value: unknown): ReportContext => {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    screen: typeof given.screen === 'string' && /^[a-z-]{1,32}$/.test(given.screen) ? given.screen : 'unknown',
    projectId: idOrNull(given.projectId),
    taskId: idOrNull(given.taskId),
    threadId: idOrNull(given.threadId),
    about: typeof given.about === 'string' && given.about.trim() !== '' ? given.about.trim().slice(0, 480) : null,
  }
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/

/** What the person wrote and chose, as far as it is what it should be; a reason where it isn't. */
export const choicesIn = (value: unknown): ReportChoices | string => {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const text = typeof given.text === 'string' ? given.text.trim() : ''
  if (text === '') return 'Say what happened first.'
  if (text.length > 20_000) return 'That’s longer than a report takes: 20,000 characters.'
  const email = typeof given.email === 'string' ? given.email.trim() : ''
  if (email !== '' && (email.length > 254 || !EMAIL.test(email))) return 'That email address doesn’t look right.'
  return { text, email: email === '' ? null : email, screenshot: given.screenshot === true, logs: given.logs === true }
}

/** The system and its version, as people name it. */
const systemName = () => {
  const version = process.getSystemVersion()
  switch (process.platform) {
    case 'darwin':
      return `macOS ${version}`
    case 'win32':
      return `Windows ${version}`
    case 'linux':
      return `Linux ${release()}`
    default:
      return `${process.platform} ${release()}`
  }
}

/** The runtime's facts, or null where it isn't there, doesn't answer in time, or answers with something else. */
const factsFrom = async (ask: () => Promise<unknown>): Promise<RuntimeFacts | null> => {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WAIT_RUNTIME)
  })
  try {
    const answer = await Promise.race([ask(), late])
    return answer === null ? null : factsIn(answer)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The runtime's answers to what the reports ask it, by request: asked over
 * its port, answered with a message of the same type, `facts` by default
 * (runtime/facts.ts), `names` for a crash report's names to hide, or `work` for what Quit would stop (runtime/atWork.ts).
 * Whatever is waiting when the runtime goes is answered with nothing.
 */
export const factsAsker = (type: 'facts' | 'names' | 'work' = 'facts') => {
  const waiting = new Map<string, (value: unknown) => void>()
  return {
    ask: (runtime: { postMessage: (message: unknown) => void } | undefined, threadId: string | null) =>
      new Promise<unknown>((resolve) => {
        if (runtime === undefined) return resolve(null)
        const requestId = randomUUID()
        waiting.set(requestId, resolve)
        runtime.postMessage({ type, requestId, ...(threadId === null ? {} : { threadId }) })
      }),
    answer: (message: { readonly requestId?: string; readonly value?: unknown }) => {
      if (message.requestId === undefined) return
      waiting.get(message.requestId)?.(message.value ?? null)
      waiting.delete(message.requestId)
    },
    gone: () => {
      for (const [requestId, settle] of waiting) {
        settle(null)
        waiting.delete(requestId)
      }
    },
  }
}

export const startReports = (options: ReportsOptions) => {
  const address = reportAddress(options.address)
  /*
   * Reports open, by id, with the window each is for. One a window at most:
   * a window reloaded, or its runtime restarted, while its dialog was open
   * never closes it, so the next one it opens takes its place, and a window
   * that goes takes its own with it.
   */
  const open = new Map<string, { readonly gathering: Promise<Gathered>; readonly from: number }>()
  const watched = new Set<number>()
  const closeFrom = (from: number) => {
    for (const [reportId, report] of open) if (report.from === from) open.delete(reportId)
  }

  const gather = async (context: ReportContext, screenshot: Picture | null): Promise<Gathered> => {
    const [id, asked] = await Promise.all([options.installId(), factsFrom(() => options.askRuntime(context.threadId))])
    // Without the runtime, as before it is up or when it can't open the store, the main process says what it can itself.
    const runtime = asked ?? (await mainFacts(options.profile()).catch(() => null))
    let user: string | undefined
    try {
      user = userInfo().username
    } catch {
      user = undefined
    }
    return {
      installId: id,
      app: { version: app.getVersion(), electron: process.versions.electron, os: systemName(), arch: process.arch },
      context,
      runtime,
      logs: LOGS.map((name) => ({ name, text: tail(options.logs, name, TAIL) })).filter((log) => log.text !== ''),
      screenshot,
      mask: masker({
        home: homedir(),
        ...(user === undefined ? {} : { user }),
        device: hostname(),
        names: { project: runtime?.projects ?? [], repository: runtime?.repositories ?? [] },
      }),
    }
  }

  ipcMain.handle('althar:report-open', async (event, context: unknown): Promise<Opened> => {
    if (!options.mine(event.sender)) throw new Error('Only Althar’s own windows report a problem.')
    // The window as it is now, before the dialog draws over it.
    const window = BrowserWindow.fromWebContents(event.sender)
    const picture = await window?.webContents.capturePage().catch(() => undefined)
    const shot = picture === undefined || picture.isEmpty() ? null : picture
    const sent = shot === null ? null : shot.getSize().width > WIDEST.sent ? shot.resize({ width: WIDEST.sent, quality: 'good' }) : shot
    const png = sent?.toPNG()
    // A PNG too large for the Worker goes as a JPEG instead.
    const goes: Picture | null =
      sent === null || png === undefined
        ? null
        : png.length <= LARGEST_PNG
          ? { bytes: new Uint8Array(png), type: 'image/png' }
          : { bytes: new Uint8Array(sent.toJPEG(85)), type: 'image/jpeg' }
    const reportId = randomUUID()
    const gathering = gather(contextIn(context), goes)
    // Nothing waits on it yet; a failure is said when something does.
    gathering.catch(() => undefined)
    const from = event.sender.id
    closeFrom(from)
    if (!watched.has(from)) {
      watched.add(from)
      event.sender.once('destroyed', () => {
        watched.delete(from)
        closeFrom(from)
      })
    }
    open.set(reportId, { gathering, from })
    const kept = (await readPreferences(options.profile())).reportEmail
    return {
      reportId,
      screenshot:
        shot === null ? null : shot.resize({ width: Math.min(WIDEST.preview, shot.getSize().width), quality: 'good' }).toDataURL(),
      email: typeof kept === 'string' && kept !== '' ? kept : null,
      via: address === null ? 'mail' : 'send',
    }
  })

  ipcMain.handle('althar:report-preview', async (_event, reportId: unknown) => {
    const gathering = typeof reportId === 'string' ? open.get(reportId)?.gathering : undefined
    if (gathering === undefined) throw new Error('That report isn’t open.')
    return preview(await gathering)
  })

  ipcMain.handle('althar:report-send', async (_event, reportId: unknown, given: unknown): Promise<Sent> => {
    const gathering = typeof reportId === 'string' ? open.get(reportId)?.gathering : undefined
    if (gathering === undefined) return { kind: 'failed', reason: 'That report isn’t open any more.' }
    const choices = choicesIn(given)
    if (typeof choices === 'string') return { kind: 'failed', reason: choices }
    try {
      const report = assemble(await gathering, choices)
      // Kept as given, cleared as cleared: the next report starts from it.
      await writePreference(options.profile(), 'reportEmail', choices.email ?? '')
      if (address !== null) return await post(address, report, (url, init) => net.fetch(url, init))
      const downloads = app.getPath('downloads')
      const file = await save(downloads, report)
      shell.showItemInFolder(join(downloads, file))
      // Without a mail app the zip is still there, shown, to send some other way.
      await shell.openExternal(mailto(options.email, report, file)).catch(() => undefined)
      return { kind: 'saved', file }
    } catch (error) {
      return { kind: 'failed', reason: error instanceof NotDelivered ? error.message : 'Althar couldn’t put the report together.' }
    }
  })

  ipcMain.on('althar:report-close', (_event, reportId: unknown) => {
    if (typeof reportId === 'string') open.delete(reportId)
  })
}
