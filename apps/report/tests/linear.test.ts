import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { Fetch, SetupCache } from '../src/linear'
import { FAKE_TEAM_ID, FAKE_TRIAGE_STATE_ID, type FakeLinear, makeFakeLinear } from '../src/testing/fakeLinear'
import { isRecord } from '../src/values'
import {
  API_KEY,
  EMAIL,
  TEXT,
  envOf,
  formOf,
  jpeg,
  logs,
  operationsOf,
  png,
  pngBytes,
  post,
  run,
  sampleReport,
  variablesOf,
} from './support'

/*
 * A report through to Linear: where the issue lands, its label, the
 * uploads, the issue itself, what is kept between reports, and what a
 * failure at any step answers and logs.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

const inputOf = (linear: FakeLinear) => {
  const { input } = variablesOf(linear, 'ReportIssueCreate')
  if (!isRecord(input)) throw new Error('issueCreate had no input')
  return input
}

describe('a report', () => {
  it('becomes an issue in the team, in triage, with the label made on the way', async () => {
    const { response, body, linear } = await run(post(formOf()))
    expect(response.status).toBe(201)
    expect(body).toEqual({ ok: true })
    expect(operationsOf(linear)).toEqual(['ReportTeam', 'ReportLabel', 'ReportLabelCreate', 'ReportIssueCreate'])
    expect(variablesOf(linear, 'ReportTeam')).toEqual({ id: FAKE_TEAM_ID })
    expect(variablesOf(linear, 'ReportLabelCreate')).toEqual({ input: { name: 'From the app', teamId: FAKE_TEAM_ID } })
    const input = inputOf(linear)
    expect(input).toMatchObject({ teamId: FAKE_TEAM_ID, stateId: FAKE_TRIAGE_STATE_ID, labelIds: ['label-1'] })
    expect(input.title).toBe('The review step hangs after the first file')
  })

  it("lands in the team's default state when Triage is off", async () => {
    const { response, linear } = await run(post(formOf()), { linear: makeFakeLinear({ triage: false }) })
    expect(response.status).toBe(201)
    expect(inputOf(linear)).not.toHaveProperty('stateId')
  })

  it.each([
    ['the team', 'team', 'label-team'],
    ['the workspace', 'workspace', 'label-workspace'],
  ] as const)('uses the label when %s has it', async (_, where, id) => {
    const { linear } = await run(post(formOf()), { linear: makeFakeLinear({ label: where }) })
    expect(operationsOf(linear)).not.toContain('ReportLabelCreate')
    expect(inputOf(linear).labelIds).toEqual([id])
  })

  it("makes the label in the team when only another team's label has the name", async () => {
    const { linear } = await run(post(formOf()), { linear: makeFakeLinear({ label: 'other-team' }) })
    expect(operationsOf(linear)).toContain('ReportLabelCreate')
    expect(inputOf(linear).labelIds).not.toEqual(['label-other'])
  })

  it('uses the label LINEAR_LABEL names, and finds it whatever its case', async () => {
    const linear = makeFakeLinear({ label: 'team', labelName: 'Feedback' })
    await run(post(formOf()), { env: envOf({ LINEAR_LABEL: 'feedback' }), linear })
    expect(variablesOf(linear, 'ReportLabel')).toEqual({ name: 'feedback' })
    expect(inputOf(linear).labelIds).toEqual(['label-team'])
  })

  it('sends the API key as it is, with no Bearer, to the API only', async () => {
    const { linear } = await run(post(formOf({ screenshot: png() })))
    for (const call of linear.calls) {
      if (call.operation === null) expect(call.headers).not.toHaveProperty('authorization')
      else expect(call.headers.authorization).toBe(API_KEY)
    }
  })

  it('uploads each file once, with the headers Linear handed out, and links them from the description', async () => {
    const screenshot = png(1000)
    const { response, linear } = await run(post(formOf({ screenshot, logs: logs('first line\nsecond line\n') })))
    expect(response.status).toBe(201)
    expect(operationsOf(linear)).toEqual([
      'ReportTeam',
      'ReportLabel',
      'ReportLabelCreate',
      'ReportFileUpload',
      'PUT',
      'ReportFileUpload',
      'PUT',
      'ReportIssueCreate',
    ])
    const fileUploads = linear.calls.filter((call) => call.operation === 'ReportFileUpload').map((call) => call.variables)
    expect(fileUploads).toEqual([
      { contentType: 'image/png', filename: 'screenshot.png', size: 1000 },
      { contentType: 'text/plain', filename: 'logs.txt', size: 23 },
    ])
    const puts = linear.calls.filter((call) => call.method === 'PUT')
    expect(puts.map((call) => new URL(call.url).pathname)).toEqual(['/upload/1', '/upload/2'])
    expect(puts.map((call) => call.status)).toEqual([200, 200])
    expect(puts[0]?.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000',
      'content-disposition': 'attachment; filename="screenshot.png"',
      'x-goog-content-length-range': '0,1000',
    })
    expect(puts[0]?.bytes).toEqual(pngBytes(1000))
    expect(new TextDecoder().decode(puts[1]?.bytes ?? undefined)).toBe('first line\nsecond line\n')
    const description = String(inputOf(linear).description)
    expect(description).toContain('![Screenshot](https://uploads.linear.app/fake/1/screenshot.png)')
    expect(description).toContain('[logs.txt](https://uploads.linear.app/fake/2/logs.txt)')
  })

  it('names a JPEG screenshot as one', async () => {
    const { linear } = await run(post(formOf({ screenshot: jpeg() })))
    expect(variablesOf(linear, 'ReportFileUpload')).toMatchObject({ contentType: 'image/jpeg', filename: 'screenshot.jpg' })
  })

  it('has the text in full and the facts in the description, and no attachment it was not sent', async () => {
    const { linear } = await run(post(formOf()))
    const description = String(inputOf(linear).description)
    expect(description.startsWith(`${TEXT}\n\n---\n\n`)).toBe(true)
    expect(description).toContain('- App 0.4.2 on macOS 26.5 (arm64), Electron 44.5.0')
    expect(description).toContain('- Claude Code 2.1.263, adapter 0.88.0, signed in')
    expect(description).toContain(`- Reply to: ${EMAIL}`)
    expect(description).not.toContain('Screenshot')
    expect(description).not.toContain('logs.txt')
  })
})

describe('what is kept between reports', () => {
  it('asks for the triage state and the label once', async () => {
    const linear = makeFakeLinear()
    const cache: SetupCache = new Map()
    await run(post(formOf()), { linear, cache })
    await run(post(formOf()), { linear, cache })
    expect(operationsOf(linear)).toEqual(['ReportTeam', 'ReportLabel', 'ReportLabelCreate', 'ReportIssueCreate', 'ReportIssueCreate'])
  })

  it('is forgotten when issueCreate fails, so the next report asks again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const linear = makeFakeLinear({ label: 'team' })
    const cache: SetupCache = new Map()
    let failing = true
    const fetch: Fetch = async (input, init) =>
      failing && typeof init.body === 'string' && init.body.includes('ReportIssueCreate')
        ? Response.json({ errors: [{ message: 'Invalid state', extensions: { code: 'INVALID_INPUT' } }] }, { status: 400 })
        : linear.fetch(input, init)
    expect((await run(post(formOf()), { linear, cache, fetch })).response.status).toBe(502)
    failing = false
    expect((await run(post(formOf()), { linear, cache, fetch })).response.status).toBe(201)
    expect(operationsOf(linear)).toEqual(['ReportTeam', 'ReportLabel', 'ReportTeam', 'ReportLabel', 'ReportIssueCreate'])
  })
})

/** A fetch that answers `operation` (or the storage's PUT) with `answer`, and passes the rest to the fake. */
const failing =
  (linear: FakeLinear, operation: string, answer: () => Promise<Response>): Fetch =>
  async (input, init) => {
    const isTarget = operation === 'PUT' ? init.method === 'PUT' : typeof init.body === 'string' && init.body.includes(operation)
    return isTarget ? answer() : linear.fetch(input, init)
  }

const graphqlError = (status: number, code: string, message: string) => async () =>
  Response.json({ errors: [{ message, extensions: { code } }] }, { status })

const data = (value: unknown) => async () => Response.json({ data: value })

/** Each row: the failure, the call it happens at, Linear's answer, and the step and detail logged. */
const failures: ReadonlyArray<readonly [string, string, () => Promise<Response>, string, string]> = [
  [
    'an error answer that is not JSON',
    'ReportTeam',
    async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    'team',
    'HTTP 502',
  ],
  [
    'GraphQL errors',
    'ReportTeam',
    graphqlError(200, 'INVALID_INPUT', 'Entity not found: Team'),
    'team',
    'HTTP 200, INVALID_INPUT: Entity not found: Team',
  ],
  ['an answer with no data', 'ReportTeam', data(null), 'team', 'unexpected answer: no data'],
  ['no team', 'ReportTeam', data({ team: null }), 'team', 'unexpected answer: no team'],
  [
    'Triage on with no triage state',
    'ReportTeam',
    data({ team: { triageEnabled: true, states: { nodes: [{ id: 's', type: 'backlog' }] } } }),
    'team',
    'unexpected answer: triage is on but the team has no triage state',
  ],
  [
    'a rate limit',
    'ReportLabel(',
    graphqlError(400, 'RATELIMITED', 'Rate limit exceeded'),
    'label',
    'HTTP 400, RATELIMITED: Rate limit exceeded',
  ],
  ['a label that was not made', 'ReportLabelCreate', data({ issueLabelCreate: { success: false } }), 'label', 'success: false'],
  [
    'a made label with no id',
    'ReportLabelCreate',
    data({ issueLabelCreate: { success: true, issueLabel: null } }),
    'label',
    'unexpected answer: no label id',
  ],
  [
    'an upload address that is not http',
    'ReportFileUpload',
    data({ fileUpload: { success: true, uploadFile: { uploadUrl: 'file:///etc/passwd', assetUrl: 'https://x.test/a', headers: [] } } }),
    'upload',
    'unexpected answer: no upload address',
  ],
  [
    'an upload header with no value',
    'ReportFileUpload',
    data({
      fileUpload: { success: true, uploadFile: { uploadUrl: 'https://x.test/u', assetUrl: 'https://x.test/a', headers: [{ key: 'x' }] } },
    }),
    'upload',
    'unexpected answer: a header without a key or value',
  ],
  [
    'an upload header no request can carry',
    'ReportFileUpload',
    data({
      fileUpload: {
        success: true,
        uploadFile: { uploadUrl: 'https://x.test/u', assetUrl: 'https://x.test/a', headers: [{ key: 'bad name', value: 'v' }] },
      },
    }),
    'upload',
    'unexpected answer: a header no request can carry',
  ],
  [
    'the storage turning the file away',
    'PUT',
    async () => new Response('SignatureDoesNotMatch', { status: 403 }),
    'upload',
    'storage answered HTTP 403',
  ],
  ['the storage out of reach', 'PUT', () => Promise.reject(new TypeError('fetch failed')), 'upload', 'storage request failed (TypeError)'],
  [
    'an issue error, without its words, which may quote the input',
    'ReportIssueCreate',
    graphqlError(400, 'GRAPHQL_VALIDATION_FAILED', `Variable "$input" got invalid value { description: "${TEXT} ${EMAIL}" }`),
    'issue',
    'HTTP 400, GRAPHQL_VALIDATION_FAILED',
  ],
  ['an issue that was not made', 'ReportIssueCreate', data({ issueCreate: { success: false } }), 'issue', 'success: false'],
  [
    'Linear out of reach',
    'ReportIssueCreate',
    () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    'issue',
    'request failed (TimeoutError)',
  ],
]

describe('a failure at Linear', () => {
  it.each(failures)('answers 502 for %s, logging what failed and nothing private', async (_, operation, answer, step, detail) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const linear = makeFakeLinear()
    const { response, text } = await run(post(formOf({ screenshot: png() })), { linear, fetch: failing(linear, operation, answer) })
    expect(response.status).toBe(502)
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Linear didn't take the report. Try again later." })
    expect(text).not.toContain(API_KEY)
    expect(errors).toHaveBeenCalledWith('report: Linear failed', { step, detail })
    const logged = JSON.stringify(errors.mock.calls)
    for (const secret of [API_KEY, EMAIL, TEXT.slice(0, 30)]) expect(logged).not.toContain(secret)
  })

  it('stops before making the issue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const linear = makeFakeLinear()
    await run(post(formOf({ screenshot: png() })), {
      linear,
      fetch: failing(linear, 'PUT', async () => new Response(null, { status: 500 })),
    })
    expect(operationsOf(linear)).not.toContain('ReportIssueCreate')
  })

  it('never puts the report in the log, whatever the report says', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const linear = makeFakeLinear()
    const report = { ...sampleReport(), text: 'My key is lin_api_hunter2, please help' }
    await run(post(formOf({ report })), { linear, fetch: failing(linear, 'ReportIssueCreate', data({ issueCreate: null })) })
    expect(JSON.stringify(errors.mock.calls)).not.toContain('hunter2')
  })
})
