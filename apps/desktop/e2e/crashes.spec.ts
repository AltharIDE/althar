import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, still } from './support'

/*
 * Crash reports (ADR-046), from the app as it fails: the window's error, a
 * rejection in main, and the window's page crashing reach PostHog from the
 * main process as $exception events, masked, while their switch is on; the
 * page's crash, a native one, is said again on the next launch from its
 * minidump. Once the switch is off, nothing leaves. PostHog here is a
 * server on this computer (ALTHAR_FAKE_POSTHOG), which keeps every request.
 */

interface Sent {
  readonly event: string
  readonly properties: Readonly<Record<string, unknown>> & {
    readonly process?: string
    readonly where?: string
    readonly agent?: string
    readonly $exception_list?: ReadonlyArray<{ readonly type: string; readonly value: string }>
  }
}

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

/** The crash reports among what PostHog was sent, as which process and what type. */
const crashes = (events: ReadonlyArray<Sent>) =>
  events
    .filter((event) => event.event === '$exception')
    .map((event) => `${event.properties.process} ${event.properties.$exception_list?.[0]?.type}`)

test('sends crash reports, masked, while their switch is on, a native crash on the next launch, and nothing once it is off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  repository(projects)
  const fake = await posthog()
  mkdirSync('test-results', { recursive: true })
  let { electronApp, page } = await launch(home, { ALTHAR_FAKE_POSTHOG: fake.url })
  try {
    // Asked once, on the first screen, as one quiet line with its switch: on until it is turned off.
    const line = page.getByRole('switch', { name: 'Crash reports' })
    await expect(line).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Once the launch has played over the screen and the repositories are found.
    await expect(page.getByRole('list', { name: 'Repositories for the project' })).toBeVisible()
    await still(page)
    await line.locator('xpath=ancestor::section[1]').screenshot({
      path: 'test-results/crash-reports-first-screen.png',
      scale: 'css',
      animations: 'disabled',
    })

    // The window's own error, with a path under the home folder in it, and a rejection nobody handled in main.
    await page.evaluate((where) => {
      queueMicrotask(() => {
        throw new TypeError(`Couldn’t read ${where}/Projects/meridian/app.ts`)
      })
    }, home)
    await electronApp.evaluate(() => {
      queueMicrotask(() => void Promise.reject(new RangeError('Main went out of range')))
    })
    await expect.poll(() => crashes(fake.events)).toEqual(expect.arrayContaining(['window TypeError', 'main RangeError']))

    // The window's page crashing: said now as a process gone, and on the next launch from its minidump. A segfault, as a
    // real crash is: on a Mac, forcefullyCrashRenderer ends the page as killed, which isn't reported.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
      if (pid !== undefined) process.kill(pid, 'SIGSEGV')
    })
    await expect.poll(() => crashes(fake.events)).toContain('window Process gone')
    const sent = JSON.stringify(fake.events)
    expect(sent).not.toContain(home)
    expect(sent).toContain('Couldn’t read ~/…/app.ts')
    expect(sent).not.toMatch(/context_line|pre_context|post_context/)
    expect(fake.events.every((event) => event.properties.$process_person_profile === false)).toBe(true)
    writeFileSync('test-results/crash-reports.json', `${JSON.stringify(fake.events, null, 2)}\n`)
  } finally {
    await electronApp.close()
  }

  // Opened again: the native crash, once, with no minidump in it.
  ;({ electronApp, page } = await launch(home, { ALTHAR_FAKE_POSTHOG: fake.url }))
  try {
    await expect.poll(() => crashes(fake.events)).toContain('window Native crash')
    expect(crashes(fake.events).filter((crash) => crash === 'window Native crash')).toHaveLength(1)

    // Once there is a project, its name and its repository's are hidden too.
    await page
      .getByRole('list', { name: 'Repositories for the project' })
      .getByRole('checkbox', { name: /meridian/ })
      .click()
    await page.getByRole('button', { name: /Make the project/ }).click()
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await page.evaluate(() => {
      queueMicrotask(() => {
        throw new SyntaxError('meridian’s settings didn’t parse')
      })
    })
    await expect.poll(() => crashes(fake.events)).toContain('window SyntaxError')
    const named = fake.events.find((event) => event.properties.$exception_list?.[0]?.type === 'SyntaxError')
    expect(named?.properties.$exception_list?.[0]?.value).toMatch(/^\[(project|repository)-1\]’s settings didn’t parse$/)

    // Off in Settings, under About Althar, beside usage data: nothing more leaves. ⌘⇧, goes there once the bar is there.
    await expect(page.getByRole('button', { name: /^Althar settings/ })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+Comma')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'About Althar' }).click()
    const crashReports = page.getByRole('main').getByRole('switch', { name: 'Crash reports' })
    await expect(crashReports).toHaveAttribute('aria-checked', 'true')
    await crashReports.locator('xpath=ancestor::div[2]').screenshot({ path: 'test-results/crash-reports-settings.png', scale: 'css' })
    // What the app keeps, which it goes by from the moment it is kept: the window's switch moves before then.
    const kept = () => (JSON.parse(readFileSync(join(home, 'profile', 'desktop.json'), 'utf8')) as { crashReports?: boolean }).crashReports
    await crashReports.click()
    await expect(crashReports).toHaveAttribute('aria-checked', 'false')
    await expect.poll(kept).toBe(false)
    // Usage data has a switch of its own, and its events on their way may still go: only crash reports must not.
    const before = fake.events.length
    // Of two kinds, so neither is taken for the other: a report goes once a launch for each failure.
    const thrown = (message: string, kind: 'TypeError' | 'Error') =>
      page.evaluate(
        ([said, as]) => {
          queueMicrotask(() => {
            throw as === 'TypeError' ? new TypeError(said) : new Error(said)
          })
        },
        [message, kind] as const,
      )
    await thrown('After the switch went off', 'TypeError')
    // On again, the next one is sent: what was thrown while it was off would have come before it.
    await crashReports.click()
    await expect(crashReports).toHaveAttribute('aria-checked', 'true')
    await expect.poll(kept).toBe(true)
    await thrown('After the switch went on again', 'Error')
    const values = () =>
      fake.events.slice(before).flatMap((event) => (event.event === '$exception' ? [event.properties.$exception_list?.[0]?.value] : []))
    await expect.poll(values).toContain('After the switch went on again')
    expect(values()).toEqual(['After the switch went on again'])
  } finally {
    await electronApp.close()
    await fake.close()
  }
})

test('keeps an agent it couldn’t check to that agent, shows the others as they are, and reports it as handled', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  mkdirSync(join(home, 'Projects'))
  const fake = await posthog()
  // Codex's status command isn't there: its check fails, and nothing else's does.
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_POSTHOG: fake.url, ALTHAR_FAKE_UNCHECKED: 'codex' })
  try {
    const agents = page.getByRole('list', { name: /^Agents on / })
    await expect(agents.getByText('Claude Code')).toBeVisible()
    await expect(agents.getByText('Codex')).toBeVisible()
    await expect(page.getByText("Althar's runtime couldn't do that. Its log has the details.")).toHaveCount(0)
    await expect
      .poll(() =>
        fake.events
          .filter((event) => event.event === '$exception')
          .map((event) => {
            const [exception] = event.properties.$exception_list ?? []
            return `${event.properties.where} ${event.properties.agent} ${exception?.type}: ${exception?.value}`
          }),
      )
      .toContain('Status.account codex Error: Codex’s status command isn’t there')
    const handled = fake.events.find((event) => event.properties.where === 'Status.account')
    expect(handled?.properties).toMatchObject({ process: 'runtime', $exception_level: 'error' })
    expect(JSON.stringify(handled)).toContain('"handled":true')
  } finally {
    await electronApp.close()
    await fake.close()
  }
})
