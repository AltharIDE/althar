import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { backToWork, launch, openFirstProject, projectSettings, still } from './support'

/*
 * A repository's setup changed in the project's settings, in a real window
 * (ADR-080): typed into Running's lines and kept as the person leaves them,
 * still there once the window reads the project afresh, and an edit the
 * runtime refuses said in a line and put back as it was. The screenshots are
 * this change's own evidence (test-results/setups-*.png).
 */

test('changes a repository’s setup in Running: kept, read back, and a refused edit put back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await projectSettings(page, 'Running')
    const group = page.getByRole('region', { name: 'Before each task starts' })
    const commands = page.getByRole('textbox', { name: /: commands$/ })
    const files = page.getByRole('textbox', { name: /: files copied from your checkout$/ })
    await expect(commands).toHaveAttribute('placeholder', 'The first task’s lead fills this in.')
    await group.scrollIntoViewIfNeeded()
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-empty.png', scale: 'css' })

    // Observe completion without reading the profile database, which the runtime holds exclusively.
    await page.evaluate(() => {
      const state = window as unknown as { setupsKept: number }
      state.setupsKept = 0
      const pending = new Set<string>()
      const watched = new WeakSet<MessagePort>()
      const packets = (value: unknown): Record<string, unknown>[] =>
        Array.isArray(value)
          ? value.flatMap(packets)
          : typeof value === 'object' && value !== null
            ? [value as Record<string, unknown>]
            : []
      // oxlint-disable-next-line typescript/unbound-method -- applied to the port it was called on
      const post = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (this: MessagePort, ...args: Parameters<MessagePort['postMessage']>) {
        for (const packet of packets(args[0])) {
          if (packet._tag !== 'Request' || packet.tag !== 'SetRepository') continue
          pending.add(String(packet.id))
          if (watched.has(this)) continue
          watched.add(this)
          const answered = (event: MessageEvent<unknown>) => {
            for (const reply of packets(event.data)) {
              if (reply._tag !== 'Exit' || !pending.delete(String(reply.requestId))) continue
              if ((reply.exit as { _tag?: string } | undefined)?._tag === 'Success') state.setupsKept += 1
              if (state.setupsKept === 2) {
                MessagePort.prototype.postMessage = post
                this.removeEventListener('message', answered)
              }
            }
          }
          this.addEventListener('message', answered)
        }
        post.apply(this, args)
      } as MessagePort['postMessage']
    })

    await commands.click()
    await page.keyboard.type('bun install --frozen-lockfile\nbunx playwright install chromium')
    await files.click()
    await page.keyboard.type('.env\n.env.local')
    await page.keyboard.press('Tab')

    // A reload follows both successful replies, rather than just their optimistic values in the window.
    await expect.poll(() => page.evaluate(() => (window as unknown as { setupsKept: number }).setupsKept)).toBe(2)

    // Away to the work and back, then read afresh: the window starts over and asks the runtime.
    await backToWork(page)
    await projectSettings(page, 'Running')
    await expect(commands).toHaveValue('bun install --frozen-lockfile\nbunx playwright install chromium')
    await expect(files).toHaveValue('.env\n.env.local')
    await page.reload()
    await projectSettings(page, 'Running')
    await expect(commands).toHaveValue('bun install --frozen-lockfile\nbunx playwright install chromium')
    await expect(files).toHaveValue('.env\n.env.local')
    await group.scrollIntoViewIfNeeded()
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-kept.png', scale: 'css' })

    // A file outside the repository is refused, said, and the lines go back to what was kept.
    await files.fill('.env\n.env.local\n../secrets.env')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(files).toHaveValue('.env\n.env.local')
    await still(page)
    await group.screenshot({ path: '../../test-results/setups-refused.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
