import { describe, expect, it } from 'vite-plus/test'

import { makeFakeLinear } from '../src/testing/fakeLinear'
import { INSTALL_ID, MiB, type Sample, formOf, jpegBytes, logs, png, post, run, sampleReport, without } from './support'

/*
 * What the Worker turns away, and how: the route, the method, the content
 * type, the sizes, and every field of the report. Nothing turned away
 * reaches Linear.
 */

const rejected = async (request: Request) => {
  const linear = makeFakeLinear()
  const result = await run(request, { linear })
  expect(linear.calls).toEqual([])
  return result
}

describe('the route', () => {
  it('answers 404 for any other path', async () => {
    const { response, body } = await rejected(post(formOf(), {}, '/report'))
    expect(response.status).toBe(404)
    expect(body).toEqual({ ok: false, error: 'Not found.' })
  })

  it('answers 405 for another method, saying POST is allowed', async () => {
    const { response, body } = await rejected(new Request('https://report.test/reports'))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(body).toMatchObject({ ok: false })
  })

  it('answers 415 for a body that is not multipart/form-data', async () => {
    const { response, body } = await rejected(post(JSON.stringify(sampleReport()), { 'content-type': 'application/json' }))
    expect(response.status).toBe(415)
    expect(body).toEqual({ ok: false, error: 'Send the report as multipart/form-data.' })
  })

  it('answers 400 for a multipart body it cannot read', async () => {
    const { response, body } = await rejected(post('not a form', { 'content-type': 'multipart/form-data; boundary=x' }))
    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: "The form couldn't be read." })
  })
})

describe('the whole request', () => {
  it('answers 413 when Content-Length says more than 8 MB, before reading it', async () => {
    const { response, body } = await rejected(post(formOf(), { 'content-length': String(8 * MiB + 1) }))
    expect(response.status).toBe(413)
    expect(body).toEqual({ ok: false, error: 'The report is larger than 8 MB.' })
  })

  it('stops reading a body with no length once it passes 8 MB, and answers 413', async () => {
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1
        controller.enqueue(new Uint8Array(MiB))
      },
      cancel: () => {
        cancelled = true
      },
    })
    // Node needs `duplex` for a streamed body; the DOM types don't know it yet.
    const init: RequestInit & { readonly duplex: 'half' } = {
      method: 'POST',
      body: endless,
      duplex: 'half',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    }
    const request = new Request('https://report.test/reports', init)
    expect(request.headers.get('content-length')).toBeNull()
    const { response, body } = await rejected(request)
    expect(response.status).toBe(413)
    expect(body).toEqual({ ok: false, error: 'The report is larger than 8 MB.' })
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(12)
  })

  it('takes a body just under 8 MB with no length', async () => {
    const form = formOf({ screenshot: png(4 * MiB), logs: logs('x'.repeat(2 * MiB)) })
    const size = (await new Request('https://report.test', { method: 'POST', body: form }).arrayBuffer()).byteLength
    form.append('padding', 'x'.repeat(8 * MiB - size - 200))
    const request = post(form)
    expect(request.headers.get('content-length')).toBeNull()
    const { response } = await run(request)
    expect(response.status).toBe(201)
  })
})

describe('the report field', () => {
  it('must be there', async () => {
    const form = new FormData()
    form.append('logs', logs())
    const { response, body } = await rejected(post(form))
    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: 'The form has no report.' })
  })

  it('must be text, not a file', async () => {
    const form = new FormData()
    form.append('report', new File([JSON.stringify(sampleReport())], 'report.json', { type: 'application/json' }))
    const { response } = await rejected(post(form))
    expect(response.status).toBe(400)
  })

  it('must be one field', async () => {
    const form = formOf()
    form.append('report', JSON.stringify(sampleReport()))
    const { body } = await rejected(post(form))
    expect(body).toEqual({ ok: false, error: 'The form has more than one report.' })
  })

  it('must be valid JSON', async () => {
    const { response, body } = await rejected(post(formOf({ report: '{"version": 1,' })))
    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: "The report isn't valid JSON." })
  })

  it('answers 413 when it is longer than 256 KB', async () => {
    const { response } = await rejected(post(formOf({ report: `"${'x'.repeat(256 * 1024)}"` })))
    expect(response.status).toBe(413)
  })

  it('must be a JSON object', async () => {
    const { body } = await rejected(post(formOf({ report: '[1]' })))
    expect(body).toEqual({ ok: false, error: 'The report must be an object.' })
  })
})

const long = (length: number) => 'x'.repeat(length)

/** Each row: what is wrong, the report with it, and the field the error must name. */
const invalidReports: ReadonlyArray<readonly [string, (report: Sample) => unknown, string]> = [
  ['an unknown version', (r) => ({ ...r, version: 2 }), 'version must be 1'],
  ['no version', (r) => without(r, 'version'), 'version must be 1'],
  ['an install id that is not a UUID', (r) => ({ ...r, installId: 'install-1' }), 'installId'],
  ['an uppercase install id', (r) => ({ ...r, installId: INSTALL_ID.toUpperCase() }), 'installId'],
  ['a UUID that is not v4', (r) => ({ ...r, installId: '0f6c2a8e-3b1d-1c5e-9a7f-2d4e6b8c1a3f' }), 'installId'],
  ['empty text', (r) => ({ ...r, text: '' }), 'text must be 1 to 20000'],
  ['text that is only space', (r) => ({ ...r, text: ' \n\t ' }), 'text must be 1 to 20000'],
  ['text that is not a string', (r) => ({ ...r, text: 42 }), 'text must be'],
  ['text over 20000 characters', (r) => ({ ...r, text: long(20_001) }), 'text must be'],
  ['an address without a domain', (r) => ({ ...r, email: 'ada@' }), 'email'],
  ['an address with a space', (r) => ({ ...r, email: 'ada lovelace@example.com' }), 'email'],
  ['an address over 254 characters', (r) => ({ ...r, email: `${long(60)}@${long(200)}.com` }), 'email'],
  ['an empty address', (r) => ({ ...r, email: '' }), 'email'],
  ['no app', (r) => without(r, 'app'), 'app must be an object'],
  ['an app version that is not text', (r) => ({ ...r, app: { ...r.app, version: 1 } }), 'app.version'],
  ['an app version over 64 characters', (r) => ({ ...r, app: { ...r.app, version: long(65) } }), 'app.version'],
  ['an OS on two lines', (r) => ({ ...r, app: { ...r.app, os: 'macOS\n26.5' } }), 'app.os'],
  ['a blank OS', (r) => ({ ...r, app: { ...r.app, os: '  ' } }), 'app.os'],
  ['an arch with a space', (r) => ({ ...r, app: { ...r.app, arch: 'arm 64' } }), 'app.arch'],
  ['no Electron version', (r) => ({ ...r, app: without(r.app, 'electron') }), 'app.electron'],
  ['no context', (r) => without(r, 'context'), 'context must be an object'],
  ['a screen with a slash', (r) => ({ ...r, context: { ...r.context, screen: 'task/1' } }), 'context.screen'],
  ['a project id over 64 characters', (r) => ({ ...r, context: { ...r.context, projectId: long(65) } }), 'context.projectId'],
  ['a task id with a space', (r) => ({ ...r, context: { ...r.context, taskId: 'task 1' } }), 'context.taskId'],
  ['a thread id that is a number', (r) => ({ ...r, context: { ...r.context, threadId: 7 } }), 'context.threadId'],
  ['an about over 200 characters', (r) => ({ ...r, context: { ...r.context, about: long(201) } }), 'context.about'],
  ['agents that are not a list', (r) => ({ ...r, agents: {} }), 'agents must be a list'],
  ['more than 10 agents', (r) => ({ ...r, agents: Array.from({ length: 11 }, () => r.agents[0]) }), 'agents must be a list of at most 10'],
  ['an agent that is not an object', (r) => ({ ...r, agents: ['claude-code'] }), 'agents[0] must be an object'],
  ['an agent id with a dot', (r) => ({ ...r, agents: [{ ...r.agents[0], id: 'claude.code' }] }), 'agents[0].id'],
  [
    'an agent with no name',
    (r) => ({ ...r, agents: [{ id: 'claude-code', version: null, adapter: null, signIn: 'signed_in' }] }),
    'agents[0].name',
  ],
  ['an agent version on two lines', (r) => ({ ...r, agents: [{ ...r.agents[0], version: '2.1\n263' }] }), 'agents[0].version'],
  ['an unknown sign-in state', (r) => ({ ...r, agents: [r.agents[0], { ...r.agents[1], signIn: 'maybe' }] }), 'agents[1].signIn'],
  ['no migrations', (r) => without(r, 'migrations'), 'migrations must be an object'],
  ['a fractional migration count', (r) => ({ ...r, migrations: { ...r.migrations, count: 1.5 } }), 'migrations.count'],
  ['a negative migration count', (r) => ({ ...r, migrations: { ...r.migrations, count: -1 } }), 'migrations.count'],
  ['a last migration with a space', (r) => ({ ...r, migrations: { ...r.migrations, last: '0018 questions' } }), 'migrations.last'],
  ['errors that are not a list', (r) => ({ ...r, errors: 'boom' }), 'errors must be a list'],
  ['more than 50 errors', (r) => ({ ...r, errors: Array.from({ length: 51 }, () => 'boom') }), 'errors must be a list of at most 50'],
  ['an error over 500 characters', (r) => ({ ...r, errors: ['boom', long(501)] }), 'errors[1]'],
  ['an error that is not text', (r) => ({ ...r, errors: [{ message: 'boom' }] }), 'errors[0]'],
]

describe('the report', () => {
  it.each(invalidReports)('is turned away with %s', async (_, change, field) => {
    const { response, body } = await rejected(post(formOf({ report: change(sampleReport()) })))
    expect(response.status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: expect.stringContaining(field) })
  })

  it('takes a field left out where null is allowed as null, and ignores fields it does not know', async () => {
    const report = sampleReport()
    const changed = {
      ...without(report, 'email'),
      context: { screen: 'home' },
      agents: [{ id: 'claude-code', name: 'Claude Code', adapter: null, signIn: 'signed_in' }],
      migrations: { count: 0 },
      newer: 'a field from a later app',
    }
    const { response } = await run(post(formOf({ report: changed })))
    expect(response.status).toBe(201)
  })
})

describe('the screenshot', () => {
  it('must be a PNG or JPEG by its type', async () => {
    const gif = new File(['GIF89a'], 'shot.gif', { type: 'image/gif' })
    const { response, body } = await rejected(post(formOf({ screenshot: gif })))
    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: 'The screenshot must be a PNG or JPEG image.' })
  })

  it('must be what its type says by its first bytes', async () => {
    const lying = new File([jpegBytes()], 'shot.png', { type: 'image/png' })
    const { response } = await rejected(post(formOf({ screenshot: lying })))
    expect(response.status).toBe(400)
  })

  it('must be a file, not text', async () => {
    const { response } = await rejected(post(formOf({ screenshot: 'iVBORw0KGgo=' })))
    expect(response.status).toBe(400)
  })

  it('must be a single file', async () => {
    const form = formOf({ screenshot: png() })
    form.append('screenshot', png())
    const { body } = await rejected(post(form))
    expect(body).toEqual({ ok: false, error: 'The form has more than one screenshot.' })
  })

  it('answers 413 when it is over 4 MB', async () => {
    const { response, body } = await rejected(post(formOf({ screenshot: png(4 * MiB + 1) })))
    expect(response.status).toBe(413)
    expect(body).toEqual({ ok: false, error: 'The screenshot is larger than 4 MB.' })
  })

  it('may be exactly 4 MB', async () => {
    const { response } = await run(post(formOf({ screenshot: png(4 * MiB) })))
    expect(response.status).toBe(201)
  })
})

describe('the logs', () => {
  it('must be text/plain', async () => {
    const zipped = new File(['PK'], 'logs.zip', { type: 'application/zip' })
    const { response, body } = await rejected(post(formOf({ logs: zipped })))
    expect(response.status).toBe(400)
    expect(body).toEqual({ ok: false, error: 'The logs must be a text/plain file.' })
  })

  it('may say their charset', async () => {
    const withCharset = new File(['one\n'], 'logs.txt', { type: 'text/plain; charset=utf-8' })
    const { response } = await run(post(formOf({ logs: withCharset })))
    expect(response.status).toBe(201)
  })

  it('answers 413 when they are over 2 MB', async () => {
    const { response, body } = await rejected(post(formOf({ logs: logs('x'.repeat(2 * MiB + 1)) })))
    expect(response.status).toBe(413)
    expect(body).toEqual({ ok: false, error: 'The logs are larger than 2 MB.' })
  })

  it('are left out when the file is empty', async () => {
    const { response, linear } = await run(post(formOf({ logs: logs('') })))
    expect(response.status).toBe(201)
    expect(linear.calls.filter((call) => call.operation === 'ReportFileUpload')).toEqual([])
  })
})
