import { isRecord } from './values'

/*
 * What the app sends, read and checked. A report comes as a multipart form:
 * `report`, a JSON document (version 1 of the contract, below), and
 * optionally a `screenshot` and the `logs`. All of it is untrusted, since
 * anyone with the Worker's address can post: each field is checked for
 * type, length and shape here, and a report that fails is turned away with
 * a short message naming the field, so whoever built the request can tell
 * what was wrong. Fields the contract doesn't name are ignored, so a newer
 * app can add one without its reports being turned away; a field left out
 * where null is allowed counts as null.
 */

const KiB = 1024
const MiB = 1024 * KiB

/** The caps: bytes for the request and its files, characters for text. */
export const LIMITS = {
  request: 8 * MiB,
  screenshot: 4 * MiB,
  logs: 2 * MiB,
  report: 256 * KiB,
  text: 20_000,
  line: 64,
  about: 200,
  email: 254,
  agents: 10,
  errors: 50,
  error: 500,
  migrations: 100_000,
} as const

export type SignIn = 'signed_in' | 'signed_out' | 'unknown' | 'not_installed'
const SIGN_INS: ReadonlyArray<SignIn> = ['signed_in', 'signed_out', 'unknown', 'not_installed']

export interface Agent {
  readonly id: string
  readonly name: string
  readonly version: string | null
  readonly adapter: string | null
  readonly signIn: SignIn
}

export interface Report {
  readonly version: 1
  /** A random UUID v4 the app made once, lowercase. It names an install, never a person. */
  readonly installId: string
  /** What happened, in the person's words, trimmed. */
  readonly text: string
  readonly email: string | null
  readonly app: { readonly version: string; readonly os: string; readonly arch: string; readonly electron: string }
  readonly context: {
    readonly screen: string
    readonly projectId: string | null
    readonly taskId: string | null
    readonly threadId: string | null
    readonly about: string | null
  }
  readonly agents: ReadonlyArray<Agent>
  readonly migrations: { readonly count: number; readonly last: string | null }
  /** Log lines the app already masked. */
  readonly errors: ReadonlyArray<string>
}

/** A file to attach to the issue, under the name and type it will have there. */
export interface Attachment {
  readonly filename: string
  readonly contentType: string
  readonly file: Blob
}

export interface Submission {
  readonly report: Report
  readonly screenshot: Attachment | null
  readonly logs: Attachment | null
}

export type Status = 400 | 413
export type Outcome<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly status: Status; readonly error: string }

/** A request or a field turned away: 413 when it is too large, 400 otherwise. */
class Rejected extends Error {
  constructor(
    readonly status: Status,
    message: string,
  ) {
    super(message)
  }
}

const invalid = (message: string) => new Rejected(400, message)

const TOO_LARGE = { ok: false, status: 413, error: 'The report is larger than 8 MB.' } as const

/** The media type without its parameters: `text/plain; charset=utf-8` is `text/plain`. */
export const essenceOf = (contentType: string | null): string => (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

/** Whether the request says, before it is read, that it is over the cap. A missing or unreadable length says nothing. */
export const declaredTooLarge = (request: Request): boolean => {
  const declared = request.headers.get('content-length')
  return declared !== null && /^\d+$/.test(declared) && Number(declared) > LIMITS.request
}

/** The body's bytes, read until they pass `cap`; null if they do. A missing length can't get a large body past it. */
const readCapped = async (body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array<ArrayBuffer> | null> => {
  const chunks: Array<Uint8Array> = []
  let size = 0
  if (body !== null) {
    const reader = body.getReader()
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength
      if (size > cap) {
        await reader.cancel()
        return null
      }
      chunks.push(read.value)
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** The request's form, read with the whole request held to 8 MB. */
export const readForm = async (request: Request): Promise<Outcome<FormData>> => {
  const bytes = await readCapped(request.body, LIMITS.request)
  if (bytes === null) return TOO_LARGE
  try {
    const form = await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()
    return { ok: true, value: form }
  } catch {
    return { ok: false, status: 400, error: "The form couldn't be read." }
  }
}

/** The form, checked into a submission. */
export const readSubmission = async (form: FormData): Promise<Outcome<Submission>> => {
  try {
    const report = readReport(parseReport(single(form, 'report')))
    const screenshot = await readScreenshot(single(form, 'screenshot'))
    const logs = readLogs(single(form, 'logs'))
    return { ok: true, value: { report, screenshot, logs } }
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, status: error.status, error: error.message }
    throw error
  }
}

const single = (form: FormData, name: string): FormDataEntryValue | null => {
  const all = form.getAll(name)
  if (all.length > 1) throw invalid(`The form has more than one ${name}.`)
  return all[0] ?? null
}

const parseReport = (value: FormDataEntryValue | null): unknown => {
  if (value === null) throw invalid('The form has no report.')
  if (typeof value !== 'string') throw invalid('The report must be a text field, not a file.')
  if (value.length > LIMITS.report) throw new Rejected(413, 'The report field is longer than 256 KB.')
  try {
    // JSON.parse's result is unknown until readReport has checked it.
    const parsed: unknown = JSON.parse(value)
    return parsed
  } catch {
    throw invalid("The report isn't valid JSON.")
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
const ARCH = /^[A-Za-z0-9_]{1,16}$/
// The WHATWG form of an address, with a dot required in the domain.
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const CONTROL = /\p{Cc}/u

const ID_WORDS = 'letters, digits, _ and - (at most 64)'

const objectAt = (value: unknown, path: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw invalid(`${path} must be an object.`)
  return value
}

const listAt = (value: unknown, path: string, max: number): ReadonlyArray<unknown> => {
  if (!Array.isArray(value) || value.length > max) throw invalid(`${path} must be a list of at most ${max}.`)
  return value
}

const isAbsent = (value: unknown): value is null | undefined => value === null || value === undefined

const idAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${path} must be ${ID_WORDS}.`)
  return value
}

const idOrNullAt = (value: unknown, path: string): string | null => {
  if (isAbsent(value)) return null
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${path} must be ${ID_WORDS}, or null.`)
  return value
}

const isLine = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !CONTROL.test(value)

/** One line of text, not blank. */
const lineAt = (value: unknown, path: string, max: number = LIMITS.line): string => {
  if (!isLine(value, max)) throw invalid(`${path} must be one line of at most ${max} characters.`)
  return value
}

const lineOrNullAt = (value: unknown, path: string, max: number = LIMITS.line): string | null => {
  if (isAbsent(value)) return null
  if (!isLine(value, max)) throw invalid(`${path} must be one line of at most ${max} characters, or null.`)
  return value
}

const readAgent = (value: unknown, path: string): Agent => {
  const agent = objectAt(value, path)
  const signIn = SIGN_INS.find((each) => each === agent.signIn)
  if (signIn === undefined) throw invalid(`${path}.signIn must be ${SIGN_INS.join(', ')}.`)
  return {
    id: idAt(agent.id, `${path}.id`),
    name: lineAt(agent.name, `${path}.name`),
    version: lineOrNullAt(agent.version, `${path}.version`),
    adapter: lineOrNullAt(agent.adapter, `${path}.adapter`),
    signIn,
  }
}

/** A parsed report, checked field by field. */
export const readReport = (value: unknown): Report => {
  const report = objectAt(value, 'The report')
  if (report.version !== 1) throw invalid('version must be 1, the only version this service reads.')
  if (typeof report.installId !== 'string' || !UUID_V4.test(report.installId)) throw invalid('installId must be a lowercase UUID v4.')
  const text = typeof report.text === 'string' ? report.text.trim() : ''
  if (text === '' || text.length > LIMITS.text)
    throw invalid(`text must be 1 to ${LIMITS.text} characters, not counting the space around it.`)
  let email: string | null = null
  if (!isAbsent(report.email)) {
    if (typeof report.email !== 'string' || report.email.length > LIMITS.email || !EMAIL.test(report.email))
      throw invalid(`email must be an email address of at most ${LIMITS.email} characters, or null.`)
    email = report.email
  }

  const app = objectAt(report.app, 'app')
  if (typeof app.arch !== 'string' || !ARCH.test(app.arch)) throw invalid('app.arch must be letters, digits and _ (at most 16).')
  const context = objectAt(report.context, 'context')
  const migrations = objectAt(report.migrations, 'migrations')
  const count = migrations.count
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > LIMITS.migrations)
    throw invalid(`migrations.count must be a whole number from 0 to ${LIMITS.migrations}.`)

  return {
    version: 1,
    installId: report.installId,
    text,
    email,
    app: {
      version: lineAt(app.version, 'app.version'),
      os: lineAt(app.os, 'app.os'),
      arch: app.arch,
      electron: lineAt(app.electron, 'app.electron'),
    },
    context: {
      screen: idAt(context.screen, 'context.screen'),
      projectId: idOrNullAt(context.projectId, 'context.projectId'),
      taskId: idOrNullAt(context.taskId, 'context.taskId'),
      threadId: idOrNullAt(context.threadId, 'context.threadId'),
      about: lineOrNullAt(context.about, 'context.about', LIMITS.about),
    },
    agents: listAt(report.agents, 'agents', LIMITS.agents).map((agent, index) => readAgent(agent, `agents[${index}]`)),
    migrations: { count, last: idOrNullAt(migrations.last, 'migrations.last') },
    errors: listAt(report.errors, 'errors', LIMITS.errors).map((line, index) => {
      if (typeof line !== 'string' || line.length > LIMITS.error)
        throw invalid(`errors[${index}] must be text of at most ${LIMITS.error} characters.`)
      return line
    }),
  }
}

const SIGNATURES = {
  png: { contentType: 'image/png', filename: 'screenshot.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  jpeg: { contentType: 'image/jpeg', filename: 'screenshot.jpg', bytes: [0xff, 0xd8, 0xff] },
} as const

/** The screenshot, if any: a PNG or JPEG by its type and by its first bytes, at most 4 MB. */
const readScreenshot = async (value: FormDataEntryValue | null): Promise<Attachment | null> => {
  if (value === null) return null
  const wrongType = invalid('The screenshot must be a PNG or JPEG image.')
  if (typeof value === 'string') throw wrongType
  const kind = Object.values(SIGNATURES).find((each) => each.contentType === essenceOf(value.type))
  if (kind === undefined) throw wrongType
  if (value.size > LIMITS.screenshot) throw new Rejected(413, 'The screenshot is larger than 4 MB.')
  const head = new Uint8Array(await value.slice(0, kind.bytes.length).arrayBuffer())
  if (head.length < kind.bytes.length || kind.bytes.some((byte, index) => head[index] !== byte)) throw wrongType
  return { filename: kind.filename, contentType: kind.contentType, file: value }
}

/** The logs, if any: plain text, at most 2 MB. An empty file is no logs. */
const readLogs = (value: FormDataEntryValue | null): Attachment | null => {
  if (value === null) return null
  if (typeof value === 'string' || essenceOf(value.type) !== 'text/plain') throw invalid('The logs must be a text/plain file.')
  if (value.size > LIMITS.logs) throw new Rejected(413, 'The logs are larger than 2 MB.')
  if (value.size === 0) return null
  return { filename: 'logs.txt', contentType: 'text/plain', file: value }
}
