import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, startTask } from './support'

/*
 * Anonymous usage data (ADR-036), from the app as someone uses it: what the
 * runtime says happened reaches PostHog from the main process, named events
 * only, while the switch is on; once it is off, nothing leaves. PostHog here
 * is a server on this computer (ALTHAR_FAKE_POSTHOG), which keeps every
 * request it is sent.
 */

interface Sent {
  readonly event: string
  readonly distinct_id: string
  readonly properties: Readonly<Record<string, unknown>>
}

/** PostHog, as far as Althar can tell: every request it is sent, and the events in them. */
const posthog = async () => {
  const requests: Array<string> = []
  const events: Array<Sent> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const text = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body).toString() : body.toString()
      requests.push(`${request.method} ${request.url}`)
      try {
        const read = JSON.parse(text) as { batch?: ReadonlyArray<Sent> } & Sent
        events.push(...(read.batch ?? [read]))
      } catch {
        // Not an event: kept as a request all the same.
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":1}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests, events, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('sends usage data while its switch is on, named events only, and nothing once it is off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const repo = repository(projects)
  const fake = await posthog()
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_POSTHOG: fake.url })
  const names = () => fake.events.map((event) => event.event)
  try {
    // Althar opened; the switch is on the first screen, on, with what it sends.
    await expect.poll(names).toContain('app_opened')
    const usage = page.getByRole('region', { name: 'Privacy' }).getByRole('switch', { name: 'Usage data' })
    await expect(usage).toHaveAttribute('aria-checked', 'true')
    // Once the launch has played over it.
    await page.waitForTimeout(2500)
    await page.screenshot({ path: 'test-results/start-usage-data.png' })

    // The first project, of the repository found, and a task started on it.
    await page
      .getByRole('list', { name: 'Repositories for the project' })
      .getByRole('checkbox', { name: /meridian/ })
      .click()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await expect.poll(names).toEqual(expect.arrayContaining(['project_made', 'first_screen_done']))
    await startTask(page, 'Add a retry to the checkout call')
    await expect.poll(names, { timeout: 20_000 }).toContain('task_started')

    // Each as this install, anonymous, with the app's version and system; nothing names the project, its folder, the task or
    // what was said.
    const [first] = fake.events
    expect(new Set(fake.events.map((event) => event.distinct_id)).size).toBe(1)
    expect(first?.properties).toMatchObject({ $process_person_profile: false, $geoip_disable: true })
    expect(first?.properties.$app_version).toEqual(expect.any(String))
    const sent = JSON.stringify(fake.events)
    for (const named of ['meridian', 'retry', 'checkout', home, repo]) expect(sent.toLowerCase()).not.toContain(named.toLowerCase())
    expect(fake.events.find((event) => event.event === 'project_made')?.properties).toMatchObject({ repositories: 1 })
    // What went, to read.
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/usage-events.json', `${JSON.stringify(fake.events, null, 2)}\n`)

    // Off in Settings: nothing more leaves, whatever happens.
    await page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: /^Home/ }).click()
    // Home listens for ⌘, once it is on screen.
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeAttached()
    await page.keyboard.press('Meta+,')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Usage data' }).click()
    await settings.getByRole('switch', { name: 'Usage data' }).click()
    await expect(settings.getByRole('switch', { name: 'Usage data' })).toHaveAttribute('aria-checked', 'false')
    await page.screenshot({ path: 'test-results/settings-usage-data.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const before = fake.requests.length
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: /^meridian/ })
      .click()
    await startTask(page, 'Name the limits better')
    await expect(page.getByRole('button', { name: /Open task/ })).toHaveCount(2)
    await page.waitForTimeout(3_000)
    expect(fake.requests.slice(before)).toEqual([])
  } finally {
    await electronApp.close()
    await fake.close()
  }
})
