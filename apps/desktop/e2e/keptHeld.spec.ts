import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { connectGitHub, launch, openFirstProject, say, showPanes, toConversation } from './support'

/*
 * Keep for later on a task whose work waits to be accepted, in a real window with the fake agent and the fake GitHub: a
 * prototype ends on its branch, a turn after it commits, and that commit waits for Ship. Kept for later from its card, it leaves Needs you and
 * stays in Kept, with no line saying something opened; opened from there, Ship is still in its header. The screenshots are
 * this change's evidence (test-results/kept-held-*.png).
 */

test('a task whose commits wait for Ship keeps for later, and Ship is there when it is opened', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  const remote = join(home, 'api.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.test/meridian/api.git'], { cwd: repo })
  execFileSync('git', ['push', '-q', remote, 'main'], { cwd: repo })
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_REMOTE: remote })
  const title = 'Prototype the lane heights'
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await expect(page.getByRole('heading', { name: 'meridian', level: 1 })).toBeVisible()
    await connectGitHub(page)
    await showPanes(page, { conversation: true, board: true })
    const work = page.getByRole('region', { name: 'The project’s work' })

    // A prototype, ending on its branch; then a turn that commits, which waits for Ship.
    await say(page, `${title}. [coordinator:plan] [coordinator:plan-prototype] [lead:finish] [lead:edit]`)
    await page.getByRole('button', { name: 'Start now' }).last().click()
    const card = work.getByRole('article').filter({ hasText: title })
    await expect(card.getByRole('button', { name: 'Keep for later' })).toBeVisible()
    await card.getByRole('button', { name: title }).click()
    await toConversation(page)
    await say(page, 'Make the lanes a little taller. [lead:commit]')
    const header = page.getByRole('banner', { name: title })
    await expect(header.getByRole('button', { name: /^Ship/ })).toBeVisible()
    await page.getByRole('button', { name: 'Back to meridian' }).click()

    // Kept for later from its card, beside Ship: out of Needs you, in Kept, and nothing says it opened meanwhile.
    await expect(card.getByRole('button', { name: /^Ship/ })).toBeVisible()
    await card.getByRole('button', { name: 'Keep for later' }).click()
    const settled = work.getByRole('region', { name: /^Settled/ })
    await settled.getByRole('button', { name: 'Kept 1' }).click()
    await expect(settled.getByText(title)).toBeVisible()
    await expect(work.getByRole('region', { name: /^Needs you/ }).getByText(title)).toHaveCount(0)
    // Read again after the runtime's answer, it stays: no line that it came back.
    await expect(settled.getByText('kept just now')).toBeVisible()
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
    await expect(settled.getByRole('alert')).toHaveCount(0)
    await expect(settled.getByText(/opened meanwhile|stays as it was/)).toHaveCount(0)
    await settled.screenshot({ path: 'test-results/kept-held-kept.png', animations: 'disabled', scale: 'css' })

    // Opened from Kept, its held commit waits as it did: Ship is in its header.
    await settled.getByRole('button', { name: title }).click()
    await expect(header.getByRole('button', { name: /^Ship/ })).toBeVisible()
    await header.screenshot({ path: 'test-results/kept-held-header.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})
