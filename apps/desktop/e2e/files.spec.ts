import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, startTask, toConversation } from './support'

/*
 * Files and folders added to a message, in a real window with the fake
 * agents (ADR-063): picked with Add files, dropped, or copied in the file
 * manager and pasted; shown as chips with their sizes before they go, sent
 * with what the person says, copied where the agent reads, and opened by the
 * agent from the link in its prompt (the fake opens each by its path, as an
 * agent does with its own tools, and says its first line or a folder's
 * files: `saw files: …`). The coordinator's composer takes them as a task's
 * does.
 */

const composer = (page: Page) => page.getByRole('textbox', { name: /^(Tell .* something|Add to the queue)/ })

/** The composer as a whole: what waits in its tray, its field and its buttons. */
const composerForm = (page: Page) => page.locator('form').filter({ has: composer(page) })

/** Picks files on disk with the composer's own picker, as Add files opens it. */
const pick = (page: Page, paths: ReadonlyArray<string>) =>
  composerForm(page)
    .locator('input[type="file"]')
    .setInputFiles([...paths])

/**
 * Drops files on disk on a part of the window, as from the Finder: files the
 * page holds by their paths, which a picker gives it, held over it and let go.
 */
const drop = async (page: Page, target: Locator, paths: ReadonlyArray<string>) => {
  const input = await page.evaluateHandle(() => {
    const element = document.createElement('input')
    element.type = 'file'
    element.multiple = true
    element.hidden = true
    document.body.append(element)
    return element
  })
  await input.setInputFiles([...paths])
  const dataTransfer = await page.evaluateHandle((element) => {
    const transfer = new DataTransfer()
    for (const file of element.files ?? []) transfer.items.add(file)
    element.remove()
    return transfer
  }, input)
  await target.dispatchEvent('dragenter', { dataTransfer })
  await expect(page.getByText('Drop to add to your message')).toBeVisible()
  await target.dispatchEvent('drop', { dataTransfer })
  await expect(page.getByText('Drop to add to your message')).toHaveCount(0)
}

test('sends a PDF, a log and a folder to the coordinator and to a lead, which open them from where Althar copied them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  // The person's own files, outside every folder an agent reads.
  const downloads = join(home, 'Downloads')
  mkdirSync(join(downloads, 'fixtures'), { recursive: true })
  writeFileSync(join(downloads, 'refund-spec.pdf'), '%PDF-1.4 Refunds share the partner budget.\n')
  writeFileSync(join(downloads, 'checkout-errors.log'), 'error: payment call timed out after 30 s\nretrying once\n')
  writeFileSync(join(downloads, 'fixtures', 'card-declined.json'), '{"status":402}')
  writeFileSync(join(downloads, 'fixtures', 'timeout.json'), '{"status":504}')
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()

    // The coordinator: a PDF picked with Add files, which its sandboxed reader opens from its own folder.
    await composer(page).click()
    await expect(composerForm(page).getByRole('button', { name: 'Add files' })).toBeVisible()
    await pick(page, [join(downloads, 'refund-spec.pdf')])
    await expect(page.getByRole('list', { name: '1 attachment to send' }).getByText('refund-spec.pdf')).toBeVisible()
    await startTask(page, 'Fix the refunds layout')
    await expect(
      page.getByText(/saw files: refund-spec\.pdf \(linked, application\/pdf, 43 B\): %PDF-1\.4 Refunds share/).first(),
    ).toBeVisible()
    await expect(page.getByRole('list', { name: /to send/ })).toHaveCount(0)

    // The task's lead: a log dropped, and a folder copied in the file manager and pasted.
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await expect(page.getByText(/Checkout retries once when the payment call fails/).first()).toBeVisible()
    await drop(page, composer(page), [join(downloads, 'checkout-errors.log')])
    await electronApp.evaluate(
      async ({ clipboard, ClipboardItem }, uri) => clipboard.write([new ClipboardItem({ 'text/uri-list': uri, 'text/plain': 'fixtures' })]),
      pathToFileURL(join(downloads, 'fixtures')).href,
    )
    await composer(page).evaluate((field) => {
      const transfer = new DataTransfer()
      // As a file manager's copy may hand the page: a picture of the file, with nothing behind it.
      transfer.items.add(new File(['icon'], 'fixtures.png', { type: 'image/png' }))
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    })
    const tray = page.getByRole('list', { name: '2 attachments to send' })
    await expect(tray.getByText('checkout-errors.log')).toBeVisible()
    await expect(tray.getByText('2 files · 28 B')).toBeVisible()
    await composer(page).fill('Why does checkout fail? The log and the fixtures it ran on.')
    await composerForm(page).screenshot({ path: 'test-results/files-tray.png', scale: 'css' })
    await composer(page).press('Enter')
    // What the lead was sent: a link to each copy, which it opened.
    await expect(
      page.getByText(/saw files: checkout-errors\.log \(linked, text\/plain, 55 B\): error: payment call timed out/),
    ).toBeVisible()
    await expect(page.getByText(/fixtures \(linked folder\): card-declined\.json, timeout\.json/)).toBeVisible()
    const sent = page.getByRole('article', { name: 'You' }).filter({ hasText: 'Why does checkout fail?' })
    await expect(sent.getByText('checkout-errors.log')).toBeVisible()
    await expect(sent.getByText('2 files · 28 B')).toBeVisible()
    await sent.screenshot({ path: 'test-results/files-sent.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
