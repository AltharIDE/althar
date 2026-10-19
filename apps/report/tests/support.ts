import { handle } from '../src/index'
import type { Fetch, SetupCache } from '../src/linear'
import { FAKE_TEAM_ID, type FakeLinear, makeFakeLinear } from '../src/testing/fakeLinear'

/*
 * What the tests share: a realistic report, the form and request the app
 * would send, an environment with fake rate limits, and a way to run one
 * request through the handler against a fake Linear.
 */

export const MiB = 1024 * 1024
export const API_KEY = 'lin_api_test_0123456789abcdefghij'
export const API_URL = 'https://api.linear.test/graphql'
export const INSTALL_ID = '0f6c2a8e-3b1d-4c5e-9a7f-2d4e6b8c1a3f'
export const IP = '203.0.113.7'
export const EMAIL = 'ada@example.com'
export const TEXT = 'The review step hangs after the first file\n\nIt sat on "Reviewing" for ten minutes, then nothing happened.'

export const sampleReport = () => ({
  version: 1,
  installId: INSTALL_ID,
  text: TEXT,
  email: EMAIL,
  app: { version: '0.4.2', os: 'macOS 26.5', arch: 'arm64', electron: '44.5.0' },
  context: { screen: 'task', projectId: 'proj_7Hq2', taskId: 'task_19xk', threadId: 'thr_a81', about: 'Stuck: Implement' },
  agents: [
    { id: 'claude-code', name: 'Claude Code', version: '2.1.263', adapter: '0.88.0', signIn: 'signed_in' },
    { id: 'codex', name: 'Codex', version: null, adapter: null, signIn: 'not_installed' },
  ],
  migrations: { count: 18, last: '0018_questions' },
  errors: ['2026-10-11T09:12:03Z error turn failed: ProviderTimeout after 600s'],
})

export type Sample = ReturnType<typeof sampleReport>

/** A copy of `record` without `key`, as the app would send a field it left out. */
export const without = <A extends object>(record: A, key: keyof A): Omit<A, typeof key> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key)) as Omit<A, typeof key> // Every other own field is kept as it was.

/** Bytes that start like a PNG, `size` long. */
export const pngBytes = (size = 256) => {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

export const jpegBytes = (size = 256) => {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return bytes
}

export const png = (size = 256) => new File([pngBytes(size)], 'shot.png', { type: 'image/png' })
export const jpeg = (size = 256) => new File([jpegBytes(size)], 'shot.jpg', { type: 'image/jpeg' })
export const logs = (text = 'one\ntwo\n') => new File([text], 'althar.log', { type: 'text/plain' })

export interface Parts {
  /** The report as JSON, or a string sent as it is. */
  readonly report?: unknown
  readonly screenshot?: Blob | string
  readonly logs?: Blob | string
}

export const formOf = ({ report = sampleReport(), screenshot, logs }: Parts = {}): FormData => {
  const form = new FormData()
  form.append('report', typeof report === 'string' ? report : JSON.stringify(report))
  if (screenshot !== undefined) form.append('screenshot', screenshot)
  if (logs !== undefined) form.append('logs', logs)
  return form
}

export const post = (body: FormData | string, headers: Record<string, string> = {}, path = '/reports') =>
  new Request(`https://report.test${path}`, { method: 'POST', body, headers: { 'cf-connecting-ip': IP, ...headers } })

export interface FakeLimit {
  readonly keys: Array<string>
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}

/** A Rate Limiting binding that allows, or doesn't, and remembers what it was asked about. */
export const fakeLimit = (success = true): FakeLimit => {
  const keys: Array<string> = []
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key)
      return { success }
    },
  }
}

export const envOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  LINEAR_API_KEY: API_KEY,
  LINEAR_TEAM_ID: FAKE_TEAM_ID,
  LINEAR_LABEL: 'From the app',
  LINEAR_API_URL: API_URL,
  REPORTS_PER_INSTALL: fakeLimit(),
  REPORTS_PER_IP: fakeLimit(),
  ...overrides,
})

export interface Run {
  readonly env?: Record<string, unknown>
  readonly linear?: FakeLinear
  /** In place of the fake's own fetch, such as one that fails some calls. */
  readonly fetch?: Fetch
  readonly cache?: SetupCache
}

/** One request through the handler, its answer read. */
export const run = async (request: Request, { env = envOf(), linear = makeFakeLinear(), fetch, cache = new Map() }: Run = {}) => {
  const response = await handle(request, env, { fetch: fetch ?? linear.fetch, cache })
  const text = await response.text()
  const body: unknown = JSON.parse(text)
  return { response, text, body, linear }
}

/** The GraphQL operations the fake Linear was asked for, in order, uploads as PUT. */
export const operationsOf = (linear: FakeLinear) => linear.calls.map((call) => call.operation ?? call.method)

/** The variables of the one call to `operation`. */
export const variablesOf = (linear: FakeLinear, operation: string) => {
  const found = linear.calls.filter((call) => call.operation === operation)
  if (found.length !== 1) throw new Error(`expected one ${operation}, got ${found.length}`)
  return found[0]?.variables ?? {}
}
