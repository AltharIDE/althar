import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, startTask, toConversation } from './support'

/*
 * The code an agent names, in a real window with the fake agents, which say
 * back what they are told: the coordinator's names, on main, peeked at and
 * opened beside its conversation, then beside the board; a lead's, in its
 * task's worktree, with what the task changed in it. The screenshots it
 * takes are this change's own evidence (test-results/code-*.png).
 */

test('opens the code an agent names: a peek at its lines, the file beside the conversation, what a task changed in it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const projects = join(home, 'Projects')
  mkdirSync(projects)
  const { electronApp, page } = await launch(home)
  try {
    await openFirstProject(electronApp, page, repository(projects))
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
    await page.waitForTimeout(400)
    await peek.screenshot({ path: 'test-results/code-peek.png', scale: 'css' })

    // Pressed, the whole file beside the conversation, on main.
    await named.click()
    const panel = page.getByRole('complementary', { name: 'README.md' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('main', { exact: true })).toBeVisible()
    await page.mouse.move(10, 400)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/code-coordinator.png', scale: 'css' })

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
    await page.getByRole('radio', { name: 'Both' }).click()
    await page.getByRole('button', { name: 'Open README.md:1' }).last().click()
    await expect(page.getByRole('complementary', { name: 'README.md' })).toBeVisible()
    await page.mouse.move(10, 400)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/code-beside-board.png', scale: 'css' })
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Conversation' }).click()

    // A lead's names, in its task's worktree: the file it committed, with what the task changed in it.
    await startTask(page, 'Add a retry to checkout', '[lead:finish] [lead:edit]')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)
    await say(page, 'Is `change.txt` the one you changed?')
    const changed = page.getByRole('button', { name: 'Open change.txt' }).last()
    await expect(changed).toBeVisible()
    await changed.click()
    const file = page.getByRole('complementary', { name: 'change.txt' })
    await expect(file).toBeVisible()
    await file.getByRole('radio', { name: /^Change/ }).click()
    await expect(file.getByRole('group', { name: 'change.txt' })).toBeVisible()
    await page.mouse.move(10, 400)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/code-task-change.png', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
