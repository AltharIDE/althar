import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type ElectronApplication, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, planTask, say, still } from './support'

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

/** The agents' service: anything at all answers, while it listens; and how many times it was asked. */
const service = () => {
  let asked = 0
  const server: Server = createServer((_request, response) => {
    asked += 1
    response.end()
  })
  const listen = (port = 0) =>
    new Promise<number>((resolve) => server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  return { listen, stop, asked: () => asked }
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
    await expect(waiting).toBeVisible()
    // The computer says it's offline too: once, for the whole app.
    await online(electronApp, page, false)
    const offline = page.getByRole('status').filter({ hasText: /^Offline$/ })
    await expect(offline).toBeVisible()
    await page.screenshot({ path: 'test-results/connection-waiting.png', scale: 'css', animations: 'disabled' })

    // Anthropic answers again, but the computer still says it's offline: the step goes on waiting, never Stuck. A step looks
    // again when the computer's connection changes, or after half a minute, and no service is asked while it is offline; that
    // it waits out a while unreminded is the runtime's to show (connectionLost.test.ts), where no clock is raced.
    writeFileSync(connection, '')
    const before = anthropic.asked()
    await anthropic.listen(port)
    await expect(waiting).toBeVisible()
    await expect(page.getByText(/Stuck|stopped without saying/)).toHaveCount(0)

    // Back: the step asks its service, which answers, and carries on by itself, in the same session, and finishes.
    await online(electronApp, page, true)
    await expect(offline).toHaveCount(0)
    await expect.poll(anthropic.asked).toBeGreaterThan(before)
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByText(/Stuck|stopped without saying/)).toHaveCount(0)
    await page
      .getByRole('button', { name: /^Open task/ })
      .first()
      .click()
    await expect(page.getByText('The connection is back.')).toBeVisible()
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
    await expect(page.getByText("Claude Code couldn't answer.")).toBeVisible()
    const again = page.getByRole('button', { name: 'Try again' })
    await expect(again).toBeVisible()
    await still(page)
    await page
      .getByRole('article')
      .filter({ hasText: "Claude Code couldn't answer." })
      .last()
      .screenshot({ path: 'test-results/connection-coordinator-try-again.png', scale: 'css', animations: 'disabled' })
    // Back, Try again sends what the person said again, and it is answered.
    writeFileSync(connection, '')
    await again.click()
    // The fake answers with all it was told, its brief and then the person's words: the turn that failed is under it.
    await expect(page.getByText(/^echo: /)).toBeVisible()
    await expect(page.getByText('What is left on the checkout?', { exact: true })).toHaveCount(2)
    await expect(again).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('an idle worker loss leaves completed work alone and the next message starts a fresh session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const signal = join(home, 'connection')
  writeFileSync(signal, '')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTION: signal })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await say(page, 'hello')
    await expect(page.getByText(/^echo: /)).toBeVisible()
    await say(page, 'idle-loss')
    await expect(page.getByText('Committed and pushed.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Interrupt the lead' })).toHaveCount(0)
    writeFileSync(signal, 'lost')
    await expect.poll(() => existsSync(`${signal}.closed`)).toBe(true)
    await expect(page.getByText('The connection to Claude was lost.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await still(page)
    await page
      .getByRole('article')
      .filter({ hasText: 'Committed and pushed.' })
      .last()
      .screenshot({ path: 'test-results/connection-idle.png', scale: 'css', animations: 'disabled' })
    writeFileSync(signal, '')
    await say(page, 'Carry on with the checkout')
    const reply = page.getByRole('article').filter({ hasText: 'Carry on with the checkout' }).last()
    await expect(reply).toContainText('echo: You are the coordinator')
  } finally {
    await electronApp.close()
  }
})

test('a stale Try again explains its refusal in the window', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const signal = join(home, 'connection')
  writeFileSync(signal, 'offline')
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_CONNECTION: signal })
  try {
    await openFirstProject(electronApp, page, repository(home))
    await say(page, 'What is left on the checkout?')
    const again = page.getByRole('button', { name: 'Try again' })
    await expect(again).toBeVisible()
    // Hold just the retry request: the person sends a new message while this click is still on its way.
    await page.evaluate(() => {
      const delayed: Array<() => void> = []
      // oxlint-disable-next-line typescript/unbound-method -- applied to the same port
      const post = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
        if (JSON.stringify(args[0])?.includes('"tag":"TryAgain"')) delayed.push(() => post.apply(this, args))
        else post.apply(this, args)
      } as MessagePort['postMessage']
      Object.assign(window, {
        releaseRetry: () => {
          MessagePort.prototype.postMessage = post
          for (const send of delayed) send()
          return delayed.length
        },
      })
    })
    await again.click()
    writeFileSync(signal, '')
    await say(page, 'Carry on with the checkout')
    await expect(page.getByText(/^echo: /)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Interrupt the lead' })).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { releaseRetry: () => number }).releaseRetry())).toBe(1)
    const refusal = page.getByRole('alert').filter({ hasText: 'There is no failed turn or lost connection to try again.' })
    await expect(refusal).toBeVisible()
    await still(page)
    await refusal.screenshot({ path: 'test-results/connection-retry-refused.png', scale: 'css', animations: 'disabled' })
  } finally {
    await electronApp.close()
  }
})
