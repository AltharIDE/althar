import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, toConversation } from './support'

/*
 * Images dropped on a composer, in a real window with the fake agents: shown
 * small before they go, sent with what the person says, and read by the
 * agent as image blocks (the fake says what it was sent: `saw images: …`).
 * A picture wider than the window sends is drawn smaller first; a file with
 * nothing on disk behind it is refused with a word of why (files.spec.ts
 * sends files that are). The coordinator's composer
 * takes them as a task's does.
 */

/** A real PNG, a gradient, so the window's canvas draws it: the signature, its header, its rows deflated, and its end. */
const png = (width: number, height: number) => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // Eight bits a sample, in colour.
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) row.set([x % 256, (x >> 4) % 256, 160], 1 + x * 3)
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Holds files over a part of the window, then drops them there, as from the Finder. */
const drop = async (
  page: Page,
  target: Locator,
  files: ReadonlyArray<{ readonly name: string; readonly type: string; readonly bytes: Buffer }>,
) => {
  const dataTransfer = await page.evaluateHandle(
    (given) => {
      const transfer = new DataTransfer()
      for (const file of given)
        transfer.items.add(new File([Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))], file.name, { type: file.type }))
      return transfer
    },
    files.map((file) => ({ name: file.name, type: file.type, base64: file.bytes.toString('base64') })),
  )
  await target.dispatchEvent('dragenter', { dataTransfer })
  await expect(page.getByText('Drop to add to your message')).toBeVisible()
  await target.dispatchEvent('drop', { dataTransfer })
  await expect(page.getByText('Drop to add to your message')).toHaveCount(0)
}

const composer = (page: Page) => page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })

test('sends images dropped on a composer to the coordinator and to a lead, which read them as images', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The coordinator: a screenshot, and a file the window made, with nothing behind it to send as a file, refused with why.
    await composer(page).click()
    await drop(page, composer(page), [
      { name: 'refunds.png', type: 'image/png', bytes: png(640, 400) },
      { name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('Refunds share the partner budget.') },
    ])
    await expect(page.getByText('Althar couldn’t read notes.txt.')).toBeVisible()
    await expect(page.getByRole('list', { name: '1 attachment to send' }).getByRole('img', { name: 'refunds.png' })).toBeVisible()
    await page.screenshot({ path: 'test-results/images-coordinator-composer.png' })
    await startTask(page, 'Fix the refunds layout')
    await expect(page.getByText(/saw images: image\/png \d+ B/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'View refunds.png' })).toBeVisible()
    await expect(page.getByRole('list', { name: /to send/ })).toHaveCount(0)

    // The task's lead: a picture wider than the window sends, drawn smaller before it goes.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await expect(page.getByText(/Checkout retries once when the payment call fails/).first()).toBeVisible()
    await drop(page, composer(page), [{ name: 'wide.png', type: 'image/png', bytes: png(3000, 1500) }])
    await expect(page.getByRole('list', { name: '1 attachment to send' }).getByRole('img', { name: 'wide.png' })).toBeVisible()
    await page.screenshot({ path: 'test-results/images-task-composer.png' })
    await say(page, 'What is off here?')
    // What the lead was sent: the picture as drawn smaller, in its thread alone.
    await expect(page.getByText(/saw images: image\/png \d+ B/)).toBeVisible()
    // On the message, from the store, it opens full size, as wide as it was sent.
    await page.getByRole('button', { name: 'View wide.png' }).click()
    const dialog = page.getByRole('dialog')
    await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/images-sent.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
