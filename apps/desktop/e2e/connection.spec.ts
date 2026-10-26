import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type ElectronApplication, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say } from './support'

/*
 * A step that loses its connection, as the person sees it (ADR-060). The fake
 * agents' connection is the file ALTHAR_FAKE_CONNECTION names: `offline`, and
 * a prompt ends as Claude Code's did with the network gone. Their service is
 * this test's own server, ALTHAR_FAKE_SERVICE, which stops answering. The
 * computer goes offline as the main process reads it, `net.isOnline()`, and as
 * the window does. The step waits for the connection, never Stuck, and carries
 * on by itself once the computer is back and the service answers.
 * Shots: test-results/connection-*.png.
 */

/** The agents' service: anything at all answers, while it listens. */
const service = () => {
  const server: Server = createServer((_request, response) => response.end())
  const listen = (port = 0) =>
    new Promise<number>((resolve) => server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return { listen, stop }
}

/** The computer online or not: as the main process reads it, which it tells the runtime, and as the window hears it. */
const online = async (electronApp: ElectronApplication, page: Page, now: boolean) => {
  await electronApp.evaluate(({ net }, is) => {
    net.isOnline = () => is
  }, now)
  await page.context().setOffline(!now)
}

test('waits for the connection rather than go Stuck, and carries on by itself once it is back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const connection = join(home, 'connection')
  writeFileSync(connection, '')
  const anthropic = service()
  const port = await anthropic.listen()
  const { electronApp, page } = await launch(home, {
    ALTHAR_FAKE_CONNECTION: connection,
    ALTHAR_FAKE_SERVICE: `http://127.0.0.1:${port}`,
  })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // The coordinator plans while the connection is there.
    await planTask(page, 'Add a retry to the checkout call')
    const start = page.getByRole('button', { name: 'Start now' }).last()
    await expect(start).toBeVisible()

    // The connection goes as the step starts: its turn ends on it, and Anthropic can't be reached.
    writeFileSync(connection, 'offline')
    await anthropic.stop()
    await start.click()
    const waiting = page.getByText('Waiting for the connection').first()
    await expect(waiting).toBeVisible({ timeout: 15_000 })
    // The computer says it's offline too: once, for the whole app.
    await online(electronApp, page, false)
    const offline = page.getByRole('status').filter({ hasText: /^Offline$/ })
    await expect(offline).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/connection-waiting.png', scale: 'css', animations: 'disabled' })

    // Anthropic answers again, but the computer still says it's offline: the step goes on waiting, never Stuck.
    writeFileSync(connection, '')
    await anthropic.listen(port)
    await page.waitForTimeout(5_000)
    await expect(waiting).toBeVisible()
    await expect(page.getByText(/Stuck|stopped twice without saying/)).toHaveCount(0)

    // Back: the step carries on by itself, in the same session, and finishes.
    await online(electronApp, page, true)
    await expect(offline).toHaveCount(0)
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Stuck|stopped twice without saying/)).toHaveCount(0)
    await page
      .getByRole('button', { name: /^Open task/ })
      .first()
      .click()
    await expect(page.getByText('The connection is back; the step carried on from here.')).toBeVisible()
    await expect(page.getByText('Lost the connection to Anthropic', { exact: false }).first()).toBeVisible()
    // Said once, calmly: the step's thread has no error for it, as the coordinator's chat would.
    await expect(page.getByText("Claude Code couldn't answer.")).toHaveCount(0)
    await page.screenshot({ path: 'test-results/connection-carried-on.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
    await anthropic.stop().catch(() => undefined)
  }
})

test('offers Try again in the coordinator’s chat where its turn failed on the connection, and sends the words again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const connection = join(home, 'connection')
  writeFileSync(connection, '')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTION: connection })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    // The connection goes: the coordinator's turn ends in its error, as Claude Code's did.
    writeFileSync(connection, 'offline')
    await say(page, 'What is left on the checkout?')
    await expect(page.getByText("Claude Code couldn't answer.")).toBeVisible({ timeout: 15_000 })
    const again = page.getByRole('button', { name: 'Try again' })
    await expect(again).toBeVisible()
    await page.screenshot({ path: 'test-results/connection-coordinator-try-again.png', scale: 'css', animations: 'disabled' })
    // Back, Try again sends what the person said again, and it is answered.
    writeFileSync(connection, '')
    await again.click()
    // The fake answers with all it was told, its brief and then the person's words: the turn that failed is under it.
    await expect(page.getByText(/^echo: /)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('What is left on the checkout?', { exact: true })).toHaveCount(2)
    await expect(again).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
