import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * Logs on disk and Report a problem (DEV-61), as the person meets them: the
 * app writes its logs as it runs, a page's uncaught error among them; Help
 * → Report a problem opens the dialog over the project, with a picture of
 * the window and everything that goes listed; sent, a stand-in for the
 * reports Worker gets the report, the screenshot and the masked logs.
 */

interface Received {
  readonly report: Record<string, unknown>
  readonly screenshot: File | null
  readonly logs: string | null
}

/** A stand-in for the Worker in apps/report: takes the form, keeps it, and answers as the Worker does. */
const fakeWorker = async () => {
  const received: Array<Received> = []
  const body = (request: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Array<Buffer> = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => resolve(Buffer.concat(chunks)))
    })
  const server = createServer(async (request, response) => {
    const bytes = await body(request)
    const form = await new Request('http://worker.test', {
      method: 'POST',
      headers: { 'content-type': request.headers['content-type'] ?? '' },
      body: new Uint8Array(bytes),
    }).formData()
    const report = form.get('report')
    const screenshot = form.get('screenshot')
    const logs = form.get('logs')
    received.push({
      report: typeof report === 'string' ? (JSON.parse(report) as Record<string, unknown>) : {},
      screenshot: screenshot instanceof File ? screenshot : null,
      logs: logs instanceof File ? await logs.text() : null,
    })
    response.writeHead(request.url === '/reports' ? 201 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: request.url === '/reports' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, received, close: () => server.close() }
}

test('keeps logs, and reports a problem from the menu with the window, what goes listed, and the logs masked', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const worker = await fakeWorker()
  const { electronApp, page } = await launch(home, { ALTHAR_REPORT_URL: worker.url })
  const logs = join(home, 'profile', 'logs')
  try {
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The app's lifecycle and the runtime's are on disk, in the profile's own logs here.
    await expect.poll(() => readFileSync(join(logs, 'main.log'), 'utf8')).toContain('message="Runtime started"')
    await expect.poll(() => readFileSync(join(logs, 'runtime.log'), 'utf8')).toContain('message="Runtime ready"')
    // A page's error nobody caught goes to main's log.
    await page.evaluate(() => setTimeout(() => Promise.reject(new Error('An error the window left'))))
    await expect.poll(() => readFileSync(join(logs, 'main.log'), 'utf8')).toContain('An error the window left')

    // Help → Report a problem.
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('report')?.click())
    const dialog = page.getByRole('dialog', { name: 'Report a problem' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img', { name: 'Screenshot of this window' })).toBeVisible()
    await page.screenshot({ path: 'test-results/report-dialog.png', animations: 'disabled' })
    await dialog.getByRole('button', { name: 'See what’s sent' }).click()
    await expect(dialog.getByText('Install id')).toBeVisible()
    await expect(dialog.getByText('runtime.log')).toBeVisible()
    await page.screenshot({ path: 'test-results/report-what-is-sent.png', animations: 'disabled' })

    // Nothing written: it says so, and nothing goes.
    await dialog.getByRole('button', { name: /^Send/ }).click()
    await expect(dialog.getByText('Say what happened first')).toBeVisible()
    await page.screenshot({ path: 'test-results/report-empty.png', animations: 'disabled' })
    expect(worker.received).toHaveLength(0)

    await dialog.getByRole('textbox', { name: 'What happened?' }).fill('The project opened, then nothing moved\nIt sat there.')
    await dialog.getByRole('textbox', { name: 'Email, if you’d like a reply' }).fill('dana@example.com')
    await dialog.getByRole('button', { name: /^Send/ }).click()
    await expect(page.getByRole('heading', { name: 'Report sent' })).toBeVisible()
    await page.screenshot({ path: 'test-results/report-sent.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Report sent' })).toBeHidden()

    // What the Worker got: the report as its contract has it, the picture, and the logs with the home folder and the repository's name hidden.
    expect(worker.received).toHaveLength(1)
    const [got] = worker.received
    expect(got?.report).toMatchObject({
      version: 1,
      text: 'The project opened, then nothing moved\nIt sat there.',
      email: 'dana@example.com',
      context: { screen: 'project' },
      migrations: { count: expect.any(Number) },
    })
    expect(got?.report.installId).toMatch(/^[0-9a-f-]{36}$/)
    expect(got?.screenshot?.type).toBe('image/png')
    expect(got?.logs).toContain('===== runtime.log')
    expect(got?.logs).toContain('message="Runtime ready"')
    expect(got?.logs).not.toContain(homedir())
    expect(got?.logs).not.toMatch(/\bmeridian\b/)
    // The email is kept for the next report.
    await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('report')?.click())
    await expect(page.getByRole('textbox', { name: 'Email, if you’d like a reply' })).toHaveValue('dana@example.com')
  } finally {
    await electronApp.close()
    worker.close()
  }
})
