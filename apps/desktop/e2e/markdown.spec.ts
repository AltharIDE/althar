import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

import { expect, test } from '@playwright/test'

import { author, repository } from '../tests/repository'
import { launch, openFirstProject, say, sizeWindow, startTask, still, toConversation } from './support'

/*
 * A task's changed markdown file in a real window, with the fake agent: it
 * opens rendered from the task's change set, what changed marked, its picture
 * read from the task's own folder over the real transport, its source a click
 * or a key away; and from a file the lead names in the thread, in the panel
 * beside it. The screenshots are this change's own evidence (test-results/
 * markdown-*).
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...author } }).trim()

const write = (root: string, path: string, data: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), data)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (bytes: Buffer) => {
  let c = 0xffffffff
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([length, body, sum])
}

/** A flat-coloured picture, as a PNG. */
const picture = (width: number, height: number, [red, green, blue]: readonly [number, number, number]) => {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [red, green, blue]).flat())])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('a changed markdown file opens rendered from the change set and from the thread, its change marked, its source a key away', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  write(repo, 'README.md', '# meridian\n\nRefunds are paid by hand.\n')
  write(repo, 'docs/flow.png', picture(360, 70, [196, 214, 190]))
  write(repo, 'docs/guide.md', '# Guide\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Docs')
  const { electronApp, page } = await launch(home)
  try {
    await sizeWindow(electronApp, page, 1300, 900)
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Document refunds', '[lead:finish]')
    const worktree = git(repo, 'worktree', 'list', '--porcelain')
      .split('\n\n')
      .find((one) => /branch refs\/heads\/althar\/document-refunds/.test(one))
      ?.split('\n')[0]
      ?.slice('worktree '.length)
    if (worktree === undefined) throw new Error('No worktree for the task')
    write(
      worktree,
      'README.md',
      '# meridian\n\nRefunds share the partner budget, see [the guide](docs/guide.md).\n\n![Refund flow](docs/flow.png)\n',
    )
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'Document refunds')

    // From the task's change set: a page, its change marked, its picture read from the task's folder.
    await page
      .getByRole('button', { name: /Open task/ })
      .last()
      .click()
    await page
      .getByRole('radiogroup', { name: 'Face' })
      .getByRole('radio', { name: /Outputs/ })
      .click()
    await page.getByRole('button', { name: 'Open the diff of README.md' }).click()
    const changes = page.getByRole('dialog', { name: 'Changes' })
    await expect(changes.getByRole('radio', { name: /Rendered/ })).toBeChecked()
    await expect(changes.getByRole('heading', { name: 'meridian' })).toBeVisible()
    await expect(changes.getByRole('group', { name: 'Added' }).first()).toContainText('partner budget')
    await expect(changes.getByRole('group', { name: 'Removed' })).toContainText('Refunds are paid by hand.')
    await expect(changes.getByRole('img', { name: 'Refund flow' })).toHaveAttribute('src', /^data:image\/png;base64,/)
    await still(page)
    await page.screenshot({ path: 'test-results/markdown-changes.png', scale: 'css', animations: 'disabled' })

    // Source is its diff, a click away; M goes back to the page.
    await changes.getByRole('radio', { name: /Source/ }).click()
    await expect(changes.getByRole('heading', { name: 'meridian' })).toHaveCount(0)
    await expect(changes.getByRole('group', { name: 'README.md' })).toBeVisible()
    await page.keyboard.press('m')
    await expect(changes.getByRole('heading', { name: 'meridian' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(changes).toHaveCount(0)

    // From the thread: the file a lead names, in the panel beside it, as a page with its change marked.
    await toConversation(page)
    await say(page, 'The page is `README.md`.')
    await page.getByRole('button', { name: 'Open README.md' }).last().click()
    const panel = page.getByRole('complementary', { name: 'README.md' })
    await expect(panel.getByRole('radio', { name: 'Rendered' })).toBeChecked()
    await expect(panel.getByRole('group', { name: 'Added' }).first()).toContainText('partner budget')
    await expect(panel.getByRole('img', { name: 'Refund flow' })).toHaveAttribute('src', /^data:image\/png;base64,/)
    await page.mouse.move(10, 400)
    await still(page)
    await page.screenshot({ path: 'test-results/markdown-panel.png', scale: 'css', animations: 'disabled' })
    await panel.focus()
    await page.keyboard.press('m')
    await expect(panel.getByRole('radio', { name: 'Source' })).toBeChecked()
    await expect(panel.getByRole('heading', { name: 'meridian' })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
