import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, still, toConversation } from './support'

/*
 * The code an agent names, in a real window with the fake agents, which say
 * back what they are told: the coordinator's names, on main, peeked at and
 * opened beside its conversation, then beside the board; a lead's, in its
 * task's worktree, with what the task changed in it; and each in the
 * person's editor, at its line. The screenshots it takes, and what the
 * editor was asked to open, are this change's own evidence
 * (test-results/code-*).
 */

/**
 * A stand-in for the person's editor, and for the Mac's `open`, which starts
 * one there: first on the app's PATH, each writes down what it was asked to
 * open, a line each, and opens nothing. Where no editor is installed, Linux
 * finds the stand-in as Cursor.
 */
const standIn = (home: string) => {
  const bin = join(home, 'bin')
  mkdirSync(bin)
  const log = join(home, 'opened.log')
  for (const name of ['open', 'cursor']) writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 })
  return { path: `${bin}:${process.env.PATH ?? ''}`, asked: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
}

/** The panel's button to the person's editor, or to the file manager where there is none; not the one to another editor. */
const IN_EDITOR = /^(Open in (?!another)|Show in )/

/** What the editor is to be asked for a file at its line: the file at the line; the file manager, which takes no line, the file. */
const askedFor = (label: string, file: string, line: number) => (label.startsWith('Show in') ? file : `${file}:${line}`)

test('opens the code an agent names: a peek at its lines, the file beside the conversation, what a task changed in it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const editor = standIn(home)
  const { electronApp, page } = await launch(home, { PATH: editor.path })
  try {
    const checkout = repository(projects)
    await openFirstProject(electronApp, page, checkout)
    await page.getByRole('radio', { name: 'Conversation' }).click()

    // The coordinator's names, read on main: a file and its line, a path that isn't there, and a command, which stays code.
    await say(page, 'The title is in `README.md:1`. The plan was `docs/plan.md`; `npm test` checks it.')
    const named = page.getByRole('button', { name: 'Open README.md:1' }).last()
    await expect(named).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open docs/plan.md' }).last()).toBeVisible()
    await expect(page.getByText('npm test', { exact: true }).last()).toBeVisible()

    // Pointed at, a peek at its lines.
    await named.hover()
    const peek = page.getByRole('dialog', { name: 'README.md:1' })
    await expect(peek).toBeVisible()
    await expect(peek.getByText('# meridian')).toBeVisible()
    await still(page)
    await peek.screenshot({ path: 'test-results/code-peek.png', scale: 'css' })

    // Pressed, the whole file beside the conversation, on main.
    await named.click()
    const panel = page.getByRole('complementary', { name: 'README.md' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('main', { exact: true })).toBeVisible()
    await page.mouse.move(10, 400)
    await still(page)
    await page.screenshot({ path: 'test-results/code-coordinator.png', scale: 'css' })

    // In the person's editor, from the person's own checkout, at its line.
    const inEditor = panel.getByRole('button', { name: IN_EDITOR })
    const label = (await inEditor.textContent()) ?? ''
    await inEditor.click()
    await expect.poll(editor.asked).toContain(askedFor(label, join(realpathSync(checkout), 'README.md'), 1))

    // Its edge drags it wider; the width stays.
    const edge = page.getByRole('separator', { name: 'Width of the panel' })
    const was = Number(await edge.getAttribute('aria-valuenow'))
    const box = await edge.boundingBox()
    if (box === null) throw new Error('No edge to drag')
    await page.mouse.move(box.x + box.width / 2, box.y + 200)
    await page.mouse.down()
    await page.mouse.move(box.x - 140, box.y + 200, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Number(await edge.getAttribute('aria-valuenow'))).toBeGreaterThan(was + 100)

    // A path that isn't there says so, with nothing to open.
    await page.getByRole('button', { name: 'Open docs/plan.md' }).last().click()
    await expect(page.getByRole('complementary', { name: 'plan.md' }).getByText('There’s no such file')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary')).toHaveCount(0)

    // Beside the board, where the conversation has no room to share, the file opens over the board against it.
    await page.getByRole('radio', { name: 'Home' }).click()
    await page.getByRole('button', { name: 'Open README.md:1' }).last().click()
    await expect(page.getByRole('complementary', { name: 'README.md' })).toBeVisible()
    await page.mouse.move(10, 400)
    await still(page)
    await page.screenshot({ path: 'test-results/code-beside-board.png', scale: 'css' })
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Conversation' }).click()

    // A lead's names, in its task's worktree: the file it committed, with what the task changed in it.
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(page, 'Is `change.txt:1` the one you changed?')
    const changed = page.getByRole('button', { name: 'Open change.txt:1' }).last()
    await expect(changed).toBeVisible()
    await changed.click()
    const file = page.getByRole('complementary', { name: 'change.txt' })
    await expect(file).toBeVisible()
    await file.getByRole('radio', { name: /^Change/ }).click()
    await expect(file.getByRole('group', { name: 'change.txt' })).toBeVisible()
    await page.mouse.move(10, 400)
    await still(page)
    await page.screenshot({ path: 'test-results/code-task-change.png', scale: 'css' })

    // In the editor, from the task's worktree, not the person's checkout, at its line.
    const before = editor.asked().length
    await file.getByRole('button', { name: IN_EDITOR }).click()
    await expect.poll(() => editor.asked().slice(before)).toContain(askedFor(label, '/change.txt', 1))
    const asked = editor.asked().slice(before)
    expect(asked).toContain(realpathSync(join(home, 'worktrees')))
    expect(asked).not.toContain(realpathSync(checkout))
    writeFileSync('test-results/code-opened.log', editor.asked())
  } finally {
    await electronApp.close()
  }
})
